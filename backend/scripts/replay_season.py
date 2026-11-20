"""CLI: replay a past season with each strategy and compare FPL points.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 replay_season.py --season 2025-26 --strength fpl
    python3 replay_season.py --season 2025-26 --coefficients candidate.json
    python3 replay_season.py --season 2025-26 --budget 102 --strategy xp --dry-run

Writes ``backtest_results/replay-<season>-<strength>-<date>.md``, with
``-budget<£m>`` before the date when the budget is not the default.
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Layer's python/ and the transfer suggester on sys.path, so the replay
# uses production's xP and transfer search rather than copies.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
_TRANSFER_LAMBDA_DIR = _THIS_DIR.parent / "lambdas" / "analyze_transfer_suggestions"
sys.path.insert(0, str(_TRANSFER_LAMBDA_DIR))
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from replay_accuracy import DEFAULT_STRENGTH, STRENGTH_BY_NAME  # noqa: E402
from replay_policies import AllowHits, UseBanked, one_a_week  # noqa: E402
from replay_strategies import (  # noqa: E402
    FORM,
    HINDSIGHT,
    OWNERSHIP,
    XP,
    XP_ALLOW_HITS,
    XP_NO_TRANSFERS,
    XP_USE_BANKED,
    XpScorer,
    form_scorer,
    hindsight_scorer,
    ownership_scorer,
)
from season_archive import ARCHIVE_SEASONS, load_archive_season  # noqa: E402
from season_replay import STARTING_BUDGET_TENTHS, ReplayConfig, run_replay  # noqa: E402
from season_replay_report import render_replay_report  # noqa: E402
from squad_optimizer import TENTHS_PER_MILLION  # noqa: E402
from xp_v2 import load_coefficients, load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)

_BACKTEST_RESULTS_DIR = _THIS_DIR / "backtest_results"
_BUNDLED_COEFFICIENTS_LABEL = "bundled"
_STRATEGY_NAMES = (XP, XP_USE_BANKED, XP_ALLOW_HITS, XP_NO_TRANSFERS, FORM, OWNERSHIP, HINDSIGHT)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", required=True, choices=ARCHIVE_SEASONS)
    parser.add_argument("--strength", choices=sorted(STRENGTH_BY_NAME), default=DEFAULT_STRENGTH,
                        help=f"Opponent strength source for xP (default {DEFAULT_STRENGTH}).")
    parser.add_argument("--coefficients", type=Path,
                        help="Coefficients JSON for xP (default: the bundled file).")
    parser.add_argument("--budget", type=float,
                        default=STARTING_BUDGET_TENTHS / TENTHS_PER_MILLION,
                        help="Starting budget in £m (default %(default)s).")
    parser.add_argument("--strategy", action="append", choices=_STRATEGY_NAMES,
                        help="Replay only this strategy; repeat for several (default: all).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the report without writing it.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    season = load_archive_season(args.season)
    coefs = load_coefficients(args.coefficients) if args.coefficients else load_default_coefficients()
    xp_scorer = XpScorer(
        coefs=coefs, priors=load_default_priors(), window=FeatureWindow(),
        fixture_strength=STRENGTH_BY_NAME[args.strength],
    )
    budget_tenths = round(args.budget * TENTHS_PER_MILLION)
    strategies = {
        XP: (xp_scorer, one_a_week),
        XP_USE_BANKED: (xp_scorer, UseBanked()),
        XP_ALLOW_HITS: (xp_scorer, AllowHits()),
        XP_NO_TRANSFERS: (xp_scorer, None),
        FORM: (form_scorer, one_a_week),
        OWNERSHIP: (ownership_scorer, one_a_week),
        HINDSIGHT: (hindsight_scorer, one_a_week),
    }
    results = {}
    for name, (scorer, policy) in strategies.items():
        if args.strategy and name not in args.strategy:
            continue
        log.info("Replaying %s with %s", args.season, name)
        config = ReplayConfig(transfer_policy=policy, budget_tenths=budget_tenths)
        results[name] = run_replay(season, scorer, config)

    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_replay_report(
        results=results,
        ceiling_name=HINDSIGHT,
        budget_tenths=budget_tenths,
        season=args.season,
        strength_name=args.strength,
        coefficients_label=str(args.coefficients) if args.coefficients else _BUNDLED_COEFFICIENTS_LABEL,
        run_date=run_date,
    )
    print(report)

    if args.dry_run:
        return 0
    _BACKTEST_RESULTS_DIR.mkdir(exist_ok=True)
    budget_label = (
        "" if budget_tenths == STARTING_BUDGET_TENTHS
        else f"-budget{budget_tenths / TENTHS_PER_MILLION:g}"
    )
    report_path = (
        _BACKTEST_RESULTS_DIR
        / f"replay-{args.season}-{args.strength}{budget_label}-{run_date}.md"
    )
    report_path.write_text(report)
    log.info("Wrote %s", report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
