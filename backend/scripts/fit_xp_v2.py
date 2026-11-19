"""CLI entrypoint for the offline xp-v2 calibration.

Trains on four archive seasons plus the current season (from DDB) minus
its last ``--holdout-rounds`` rounds, and validates on those last rounds.
Pairs are built one season at a time through the Phase 2 feature
pipeline, then per-component-per-position weights are mean-matched
against actual outcomes on the training set.

A ship gate compares old and new weights on validation (see
``fit_gate.py``). The coefficients are written only if it passes, or
with ``--force``.

Outputs (overwriting in-place, never with ``--dry-run``):
- ``backend/scripts/fit_reports/<date>.md`` — human-readable diff + metrics
- ``backend/layers/fpl_schemas/python/xp_v2_coefficients.json`` — new
  weights, only when the gate passes

The reviewer reads the markdown report and merges the coefficient diff. The bundled snapshot test in
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

See README for cadence and the procedure after a run.
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

from data import build_pairs  # noqa: E402
from fit import (  # noqa: E402
    capped_holdout_rounds,
    fit_per_component_weights,
    multi_season_split,
    time_series_split,
)
from fit_gate import (  # noqa: E402
    evaluate_ship_gate,
    sanity_checks,
    validation_metrics,
)
from report import render_fit_report  # noqa: E402
from season_archive import (  # noqa: E402
    ARCHIVE_SEASONS,
    load_archive_season,
    load_current_season,
)
from xp_v2 import V2Coefficients, load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)


_COEFFICIENTS_FILE = _LAYER_PY_DIR / "xp_v2_coefficients.json"
_FIT_REPORTS_DIR = _THIS_DIR / "fit_reports"
_DEFAULT_HOLDOUT_ROUNDS = 3
_DEFAULT_MIN_TRAIN_ROUND = 5


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
                        help="Last N rounds of the current season reserved for "
                             f"validation (default {_DEFAULT_HOLDOUT_ROUNDS}).")
    parser.add_argument("--min-train-round", type=int, default=_DEFAULT_MIN_TRAIN_ROUND,
                        help="Drop training pairs from rounds below this (default "
                             f"{_DEFAULT_MIN_TRAIN_ROUND}). Validation is not filtered.")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute everything and print the report, but write nothing.")
    parser.add_argument("--force", action="store_true",
                        help="Write the coefficients even if the ship gate fails.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)

    log.info("Loading the current season from %s", args.table_name)
    current_season = load_current_season(table)
    if not current_season.rows:
        log.error("No fpl#player_history#* rows found in the cache. Has "
                  "ingest_player_history run yet?")
        return 1
    archive_seasons = [load_archive_season(season) for season in ARCHIVE_SEASONS]
    rows_loaded_by_season = {
        season.season: len(season.rows) for season in (*archive_seasons, current_season)
    }

    coefs_before = load_default_coefficients()
    priors = load_default_priors()
    window = FeatureWindow()

    def pairs_for(season, coefs):
        log.info("Building pairs for %s (point-in-time features per row)", season.season)
        return build_pairs(season=season, coefs=coefs, priors=priors, window=window)

    # One season at a time: player ids are only meaningful inside a season.
    archive_pairs = [
        pair for season in archive_seasons for pair in pairs_for(season, coefs_before)
    ]
    current_pairs = pairs_for(current_season, coefs_before)

    holdout_rounds = capped_holdout_rounds(current_pairs, args.holdout_rounds)
    if holdout_rounds < 1:
        log.error("The current season spans a single round, so there is "
                  "nothing to validate on. Aborting.")
        return 1
    if holdout_rounds < args.holdout_rounds:
        log.warning("The current season is too short for a %d-round holdout; "
                    "using %d.", args.holdout_rounds, holdout_rounds)

    train, validation = multi_season_split(
        archive_pairs=archive_pairs,
        current_pairs=current_pairs,
        holdout_rounds=holdout_rounds,
        min_train_round=args.min_train_round,
    )
    log.info("Train: %d pairs / Validation: %d pairs", len(train), len(validation))

    log.info("Fitting per-component weights via mean-matching on training set")
    weight_fit = fit_per_component_weights(pairs=train, coefs=coefs_before)
    coefs_after = weight_fit.coefs

    # Validation is the current season only, so only it needs rebuilding
    # under the fitted weights.
    _, validation_after = time_series_split(
        pairs_for(current_season, coefs_after), holdout_last_n_rounds=holdout_rounds,
    )
    metrics_before = validation_metrics(validation)
    metrics_after = validation_metrics(validation_after)
    checks = sanity_checks(coefs_before, coefs_after)
    gate = evaluate_ship_gate(before=metrics_before, after=metrics_after, checks=checks)

    fit_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_fit_report(
        train=train,
        validation=validation,
        rows_loaded_by_season=rows_loaded_by_season,
        coefs_before=coefs_before,
        coefs_after=coefs_after,
        kept=weight_fit.kept,
        metrics_before=metrics_before,
        metrics_after=metrics_after,
        checks=checks,
        gate=gate,
        fit_date=fit_date,
    )
    print(report)

    for failure in gate.failures:
        log.warning("Ship gate: %s", failure)

    if args.dry_run:
        log.info("Dry run — not writing coefficients or report.")
        return 0 if gate.ok else 1

    _FIT_REPORTS_DIR.mkdir(exist_ok=True)
    report_path = _FIT_REPORTS_DIR / f"{fit_date}.md"
    report_path.write_text(report)
    log.info("Wrote fit report → %s", report_path)

    if not gate.ok and not args.force:
        log.error("Ship gate failed; coefficients left unchanged. "
                  "Pass --force to write them anyway.")
        return 1

    write_coefficients_json(coefs_after, _COEFFICIENTS_FILE)
    log.info("Wrote new coefficients → %s", _COEFFICIENTS_FILE)
    log.info(
        "Update the snapshot test in test_xp_v2.py to acknowledge the "
        "new outputs, then commit both the JSON and the report together."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
