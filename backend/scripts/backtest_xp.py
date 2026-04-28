"""CLI entrypoint for the v1-vs-v2 backtest.

Reads every cached ``fpl#player_history#*`` row from DDB, computes both
v1 and v2 predictions for each (point-in-time via the Phase 2 feature
pipeline + the Phase 1 math), and compares them against actual
outcomes. Outputs a markdown report whose first section is the
PASS/FAIL verdict against the four criteria.

Pass criteria (v2 must beat v1)
-------------------------------
1. MAE overall: v2 strictly < v1
2. Spearman ρ overall: v2 ≥ v1
3. No position regresses >5% on MAE
4. Captain pick total (v2 top-ranked actual sum): v2 ≥ v1

A pass means v2 is safe to promote to the writer Lambda in Phase 5.
A fail means iterate on Phase 1 (math), Phase 2 (features), or
Phase 3 (fit) before retrying.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 backtest_xp.py --table-name <fpl-stats-cache-table>

``--dry-run`` prints the report without writing it. Default is to
write to ``backtest_results/<date>.md`` so the PR-attached run is
preserved alongside the coefficient state it ran against.
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

from backtest import (  # noqa: E402
    BacktestRow,
    captain_pick_actual_total,
    evaluate_pass_criteria,
    mae_by_position,
    mae_overall,
    spearman_overall,
)
from backtest_report import render_backtest_report  # noqa: E402
from data import load_bootstrap, scan_player_history  # noqa: E402
from fit import decompose_actual_xp  # noqa: E402
from schemas import Fixture  # noqa: E402
from v1_replay import predict_v1_for_row  # noqa: E402
from xp_v2 import (  # noqa: E402
    DEFAULT_RULES,
    FixtureContext,
    load_default_coefficients,
    xp_for_fixture,
)
from xp_v2_features import (  # noqa: E402
    FeatureWindow,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    load_default_priors,
    merge_team_xgc,
)

log = logging.getLogger(__name__)


_BACKTEST_RESULTS_DIR = _THIS_DIR / "backtest_results"
# Same neutral fixture context Phase 3 uses for the offline fit. See
# backend/scripts/data.py module docstring for why opp_strength is held
# constant on historical pairs (we don't have a per-row opp signal yet).
_NEUTRAL_OPP_STRENGTH = 0.5


def _load_fixtures(table) -> list[Fixture]:
    """Cached snapshot of fpl#fixtures, used to look up per-fixture
    difficulty during v1 replay."""
    item = table.get_item(Key={"pk": "fpl#fixtures", "sk": "latest"}).get("Item")
    if not item:
        raise RuntimeError("fpl#fixtures missing — has ingest_fpl run?")
    return [Fixture.model_validate(f) for f in item["data"]]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table-name", required=True,
                        help="DynamoDB cache table name (CacheTableName CFN output).")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the report without writing it to backtest_results/.")
    parser.add_argument("--min-round", type=int, default=1,
                        help="Only backtest rows with round >= this. Default 1 "
                             "(early-season rows are heavily smoothed but useful "
                             "for measuring cold-start behaviour). Set higher "
                             "to focus on mature-season behaviour.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)

    log.info("Loading bootstrap + fixtures + history rows from %s", args.table_name)
    bootstrap = load_bootstrap(table)
    fixtures = _load_fixtures(table)
    history_rows = scan_player_history(table)
    if not history_rows:
        log.error("No fpl#player_history#* rows found. Has ingest_player_history run?")
        return 1

    coefs = load_default_coefficients()
    priors = load_default_priors()
    window = FeatureWindow()

    player_team = {p.id: p.team for p in bootstrap.players}
    player_position = {p.id: p.element_type for p in bootstrap.players}

    rows_by_player: dict[int, list] = {}
    rows_by_team: dict[int, list] = {}
    for row in history_rows:
        rows_by_player.setdefault(row.element, []).append(row)
        team_id = player_team.get(row.element)
        if team_id is not None:
            rows_by_team.setdefault(team_id, []).append(row)

    backtest_rows: list[BacktestRow] = []
    skipped_did_not_play = 0
    skipped_unmapped = 0
    skipped_under_min_round = 0
    for row in history_rows:
        if row.minutes <= 0:
            skipped_did_not_play += 1
            continue
        if row.round < args.min_round:
            skipped_under_min_round += 1
            continue
        team_id = player_team.get(row.element)
        position = player_position.get(row.element)
        if team_id is None or position is None:
            skipped_unmapped += 1
            continue

        # v2 prediction via Phase 2 features + Phase 1 math.
        team_xgc = compute_team_xgc_at_gw(
            team_history_rows=rows_by_team[team_id],
            as_of_gw=row.round, priors=priors, window=window,
        )
        rates = compute_rates_at_gw(
            history=rows_by_player[row.element],
            position=position, as_of_gw=row.round,
            priors=priors, window=window,
        )
        rates = merge_team_xgc(rates, team_xgc)
        v2_components = xp_for_fixture(
            position=position,
            rates=rates,
            fixture=FixtureContext(home=row.was_home, opponent_strength=_NEUTRAL_OPP_STRENGTH),
            minutes_prob=1.0, p60=1.0 if row.minutes >= 60 else 0.0,
            coefs=coefs, rules=DEFAULT_RULES,
        )
        v2_pred = v2_components.total

        # v1 prediction via the inlined replay.
        v1_pred = predict_v1_for_row(
            target_row=row,
            player_history=rows_by_player[row.element],
            player_team=team_id,
            fixtures=fixtures,
        )

        actual = decompose_actual_xp(position=position, row=row)

        backtest_rows.append(BacktestRow(
            player_id=row.element, round=row.round, position=position,
            v1_pred=v1_pred, v2_pred=v2_pred, actual_total=actual.total,
        ))

    log.info(
        "Backtest population: %d rows scored / %d skipped (did_not_play=%d unmapped=%d under_min_round=%d)",
        len(backtest_rows),
        skipped_did_not_play + skipped_unmapped + skipped_under_min_round,
        skipped_did_not_play, skipped_unmapped, skipped_under_min_round,
    )
    if not backtest_rows:
        log.error("No scorable rows. Aborting.")
        return 1

    pass_criteria = evaluate_pass_criteria(
        mae_v1=mae_overall(backtest_rows, model="v1"),
        mae_v2=mae_overall(backtest_rows, model="v2"),
        spearman_v1=spearman_overall(backtest_rows, model="v1"),
        spearman_v2=spearman_overall(backtest_rows, model="v2"),
        mae_v1_by_pos=mae_by_position(backtest_rows, model="v1"),
        mae_v2_by_pos=mae_by_position(backtest_rows, model="v2"),
        captain_v1=captain_pick_actual_total(backtest_rows, model="v1"),
        captain_v2=captain_pick_actual_total(backtest_rows, model="v2"),
    )

    backtest_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_backtest_report(
        rows=backtest_rows,
        pass_criteria=pass_criteria,
        backtest_date=backtest_date,
        coefficients_model_version="bundled JSON (see xp_v2_coefficients.json)",
    )
    print(report)

    if args.dry_run:
        log.info("Dry run — not writing report.")
        return 0 if pass_criteria.ok else 1

    _BACKTEST_RESULTS_DIR.mkdir(exist_ok=True)
    report_path = _BACKTEST_RESULTS_DIR / f"{backtest_date}.md"
    report_path.write_text(report)
    log.info("Wrote backtest report → %s", report_path)

    json_path = _BACKTEST_RESULTS_DIR / f"{backtest_date}.json"
    json_path.write_text(json.dumps({
        "backtest_date": backtest_date,
        "rows": len(backtest_rows),
        "pass": pass_criteria.ok,
        "failures": pass_criteria.failures,
        "mae_overall": {
            "v1": mae_overall(backtest_rows, model="v1"),
            "v2": mae_overall(backtest_rows, model="v2"),
        },
        "spearman_overall": {
            "v1": spearman_overall(backtest_rows, model="v1"),
            "v2": spearman_overall(backtest_rows, model="v2"),
        },
        "captain_pick_total": {
            "v1": captain_pick_actual_total(backtest_rows, model="v1"),
            "v2": captain_pick_actual_total(backtest_rows, model="v2"),
        },
        "mae_by_position": {
            "v1": {str(k): v for k, v in mae_by_position(backtest_rows, model="v1").items()},
            "v2": {str(k): v for k, v in mae_by_position(backtest_rows, model="v2").items()},
        },
    }, indent=2))
    log.info("Wrote machine-readable summary → %s", json_path)

    # Exit code reflects pass/fail so a CI run could consume it later.
    return 0 if pass_criteria.ok else 1


if __name__ == "__main__":
    sys.exit(main())
