"""CLI entrypoint for the offline xp-v2 calibration.

Run manually ~4× per season (pre-season, GW5, GW15, GW25). The fit
reads every cached ``fpl#player_history#*`` row from DDB, builds
point-in-time training pairs via the Phase 2 feature pipeline, and
mean-matches per-component-per-position weights against the actual
outcomes on the training set.

Outputs (overwriting in-place):
- ``backend/layers/fpl_schemas/python/xp_v2_coefficients.json`` — new weights
- ``backend/scripts/fit_reports/<date>.md`` — human-readable diff + metrics

The reviewer reads the markdown report, eyeballs sanity checks, and
merges the coefficient diff. The bundled snapshot test in
``test_xp_v2.py`` will fail until updated, forcing an explicit
acknowledgement that the model's outputs have moved.

Usage
-----
    cd backend/scripts
    python3 fit_xp_v2.py --table-name <fpl-stats-cache-table>

The table name is from the CFN output ``CacheTableName``:

    aws cloudformation describe-stacks --stack-name FplStatsStack \\
        --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \\
        --output text

See README for the deferred Phase 3.x scope.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import boto3

# Layer's python/ on sys.path so we can import xp_v2 + xp_v2_features.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from data import build_pairs, load_bootstrap, scan_player_history  # noqa: E402
from fit import (  # noqa: E402
    fit_per_component_weights,
    mae_per_position,
    spearman_per_position,
    time_series_split,
)
from report import render_fit_report  # noqa: E402
from xp_v2 import V2Coefficients, load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)


_COEFFICIENTS_FILE = _LAYER_PY_DIR / "xp_v2_coefficients.json"
_FIT_REPORTS_DIR = _THIS_DIR / "fit_reports"
_DEFAULT_HOLDOUT_ROUNDS = 5


def write_coefficients_json(coefs: V2Coefficients, path: Path) -> None:
    """Write the V2Coefficients dataclass back to disk in the JSON shape
    expected by ``load_default_coefficients``. Preserves the leading
    ``_comment`` key so the file's docstring survives re-fits."""
    if path.exists():
        with path.open() as f:
            existing = json.load(f)
        comment = existing.get("_comment", "")
    else:
        comment = ""

    payload: dict = {}
    if comment:
        payload["_comment"] = comment

    def _str_keyed(d: dict[int, float]) -> dict[str, float]:
        return {str(k): v for k, v in sorted(d.items())}

    payload.update({
        "goals_w":   _str_keyed(coefs.goals_w),
        "assists_w": _str_keyed(coefs.assists_w),
        "cs_w":      _str_keyed(coefs.cs_w),
        "concede_w": _str_keyed(coefs.concede_w),
        "saves_w":   _str_keyed(coefs.saves_w),
        "defcon_w":  _str_keyed(coefs.defcon_w),
        "bonus_w":   _str_keyed(coefs.bonus_w),
        "home_advantage": coefs.home_advantage,
        "opp_strength_w_goals":   coefs.opp_strength_w_goals,
        "opp_strength_w_assists": coefs.opp_strength_w_assists,
        "opp_strength_w_cs":      coefs.opp_strength_w_cs,
        "opp_strength_w_concede": coefs.opp_strength_w_concede,
        "opp_strength_w_saves":   coefs.opp_strength_w_saves,
        "opp_strength_w_defcon":  coefs.opp_strength_w_defcon,
        "opp_strength_w_bonus":   coefs.opp_strength_w_bonus,
        "overall_scale": _str_keyed(coefs.overall_scale),
    })

    with path.open("w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table-name", required=True,
                        help="DynamoDB cache table name (CacheTableName CFN output).")
    parser.add_argument("--holdout-rounds", type=int, default=_DEFAULT_HOLDOUT_ROUNDS,
                        help="Last N rounds reserved for validation (default 5).")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute everything and print the report, but don't "
                             "overwrite the bundled coefficients JSON.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)

    log.info("Loading bootstrap + history rows from %s", args.table_name)
    bootstrap = load_bootstrap(table)
    history_rows = scan_player_history(table)
    if not history_rows:
        log.error("No fpl#player_history#* rows found in the cache. Has "
                  "ingest_player_history run yet?")
        return 1

    coefs_before = load_default_coefficients()
    priors = load_default_priors()
    window = FeatureWindow()

    log.info("Building training pairs (point-in-time features per row)")
    pairs = build_pairs(
        history_rows=history_rows,
        bootstrap=bootstrap,
        coefs=coefs_before,
        priors=priors,
        window=window,
    )
    log.info("Built %d (features, actuals) pairs", len(pairs))

    train, validation = time_series_split(
        pairs, holdout_last_n_rounds=args.holdout_rounds,
    )
    if not train:
        log.error("Time-series split left an empty training set "
                  "(holdout_last_n_rounds=%d covers all rounds). Aborting.",
                  args.holdout_rounds)
        return 1
    log.info("Train: %d pairs / Validation: %d pairs", len(train), len(validation))

    metrics_before = {
        "mae": mae_per_position(validation),
        "spearman": spearman_per_position(validation),
    }

    log.info("Fitting per-component weights via mean-matching on training set")
    coefs_after = fit_per_component_weights(pairs=train, coefs=coefs_before)

    # Re-build pairs with the new coefs to evaluate validation under the
    # fitted weights. Cheaper alternative would be to scale each cached
    # component by ``new_w / old_w`` per (component, position); rebuilding
    # is dumber but obviously correct, and at ~21k pairs the second pass
    # is a few seconds.
    log.info("Re-evaluating pairs under fitted coefficients")
    pairs_after = build_pairs(
        history_rows=history_rows,
        bootstrap=bootstrap,
        coefs=coefs_after,
        priors=priors,
        window=window,
    )
    _, validation_after = time_series_split(
        pairs_after, holdout_last_n_rounds=args.holdout_rounds,
    )
    metrics_after = {
        "mae": mae_per_position(validation_after),
        "spearman": spearman_per_position(validation_after),
    }

    fit_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_fit_report(
        train=train,
        validation=validation,
        coefs_before=coefs_before,
        coefs_after=coefs_after,
        metrics_before=metrics_before,
        metrics_after=metrics_after,
        fit_date=fit_date,
    )

    print(report)

    if args.dry_run:
        log.info("Dry run — not writing coefficients or report.")
        return 0

    _FIT_REPORTS_DIR.mkdir(exist_ok=True)
    report_path = _FIT_REPORTS_DIR / f"{fit_date}.md"
    report_path.write_text(report)
    log.info("Wrote fit report → %s", report_path)

    write_coefficients_json(coefs_after, _COEFFICIENTS_FILE)
    log.info("Wrote new coefficients → %s", _COEFFICIENTS_FILE)
    log.info(
        "Update the snapshot test in test_xp_v2.py to acknowledge the "
        "new outputs, then commit both the JSON and the report together."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
