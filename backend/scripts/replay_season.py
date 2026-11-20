"""CLI: replay a past season with each strategy and compare FPL points.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 replay_season.py --season 2025-26 --strength fpl
    python3 replay_season.py --season 2025-26 --coefficients candidate.json
    python3 replay_season.py --season 2025-26 --budget 102 --strategy xp --dry-run
    python3 replay_season.py --season 2025-26 --strength fpl --chips
    python3 replay_season.py --season current --strength fpl --flags

``--season current`` replays the season in progress from the cache table
(AWS credentials needed). ``--flags`` gives the xP strategies FPL's
injury flags from the change log that ``spikes/archive_flag_history.py``
writes; only the current season has one (#261).

Writes ``backtest_results/replay-<season>-<strength>-<date>.md``, with
``-budget<£m>`` before the date when the budget is not the default.
"""
from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import replace
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

from data import cache_table, load_bootstrap  # noqa: E402
from flag_history import DeadlineFlags, FlagTimeline, deadlines, read_change_log  # noqa: E402
from replay_accuracy import (  # noqa: E402
    DEFAULT_STRENGTH,
    FPL,
    NEUTRAL,
    STRENGTH_HELP,
    STRENGTH_NAMES,
    build_fixture_strength,
)
from replay_chips import (  # noqa: E402
    CHIP_WINDOWS_BY_SEASON,
    FIXTURE_LOOKAHEAD_GAMEWEEKS,
    HINDSIGHT_CHIPS,
    NO_CHIPS,
    SIMPLE_RULES,
    SimpleRules,
    best_chip_schedule,
    chip_gains,
    no_chips,
)
from replay_policies import AllowHits, Planner, UseBanked, one_a_week  # noqa: E402
from replay_strategies import (  # noqa: E402
    FORM,
    HINDSIGHT,
    OWNERSHIP,
    XP,
    XP_ALLOW_HITS,
    XP_NO_TRANSFERS,
    XP_PLANNER_LONG,
    XP_PLANNER_SHORT,
    XP_USE_BANKED,
    XpScorer,
    form_scorer,
    hindsight_scorer,
    ownership_scorer,
)
from season_archive import ARCHIVE_SEASONS, load_archive_season, load_current_season  # noqa: E402
from season_replay import STARTING_BUDGET_TENTHS, ReplayConfig, run_replay  # noqa: E402
from season_replay_report import ChipComparison, ChipRun, render_replay_report  # noqa: E402
from squad_optimizer import TENTHS_PER_MILLION  # noqa: E402
from transfer_planner import PlanSettings  # noqa: E402
from xp_v2 import load_coefficients, load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)

_BACKTEST_RESULTS_DIR = _THIS_DIR / "backtest_results"
_BUNDLED_COEFFICIENTS_LABEL = "bundled"
_STRATEGY_NAMES = (XP, XP_USE_BANKED, XP_ALLOW_HITS, XP_PLANNER_SHORT, XP_PLANNER_LONG,
                   XP_NO_TRANSFERS, FORM, OWNERSHIP, HINDSIGHT)
_PLANNER_HORIZON_BY_STRATEGY = {XP_PLANNER_SHORT: 3, XP_PLANNER_LONG: 5}
CURRENT_SEASON = "current"
# There are no odds downloads for the season in progress.
_CURRENT_SEASON_STRENGTHS = (NEUTRAL, FPL)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", required=True, choices=(*ARCHIVE_SEASONS, CURRENT_SEASON))
    parser.add_argument("--strength", choices=STRENGTH_NAMES, default=DEFAULT_STRENGTH,
                        help=STRENGTH_HELP)
    parser.add_argument("--coefficients", type=Path,
                        help="Coefficients JSON for xP (default: the bundled file).")
    parser.add_argument("--budget", type=float,
                        default=STARTING_BUDGET_TENTHS / TENTHS_PER_MILLION,
                        help="Starting budget in £m (default %(default)s).")
    parser.add_argument("--strategy", action="append", choices=_STRATEGY_NAMES,
                        help="Replay only this strategy; repeat for several (default: all).")
    parser.add_argument("--chips", action="store_true",
                        help=f"Add a Chips section: `{XP}` with each chip policy (about a "
                             "minute more).")
    parser.add_argument("--flags", action="store_true",
                        help="Give the xP strategies FPL's injury flags (current season only).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the report without writing it.")
    args = parser.parse_args(argv)
    is_current = args.season == CURRENT_SEASON
    if args.flags and not is_current:
        parser.error("--flags: only the current season has flag history")
    if is_current and args.strength not in _CURRENT_SEASON_STRENGTHS:
        parser.error(f"--strength: the current season supports {', '.join(_CURRENT_SEASON_STRENGTHS)}")
    if args.chips and args.season not in CHIP_WINDOWS_BY_SEASON:
        parser.error(f"--chips: no chip rules for {args.season}; "
                     f"known: {', '.join(CHIP_WINDOWS_BY_SEASON)}")

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    flags = None
    if is_current:
        table = cache_table()
        season = load_current_season(table)
        if args.flags:
            flags = DeadlineFlags(FlagTimeline.of(read_change_log()),
                                  deadlines(load_bootstrap(table)))
    else:
        season = load_archive_season(args.season)
    coefs = load_coefficients(args.coefficients) if args.coefficients else load_default_coefficients()
    xp_scorer = XpScorer(
        coefs=coefs, priors=load_default_priors(), window=FeatureWindow(),
        fixture_strength=build_fixture_strength(args.strength, season.season),
        flags=flags,
    )
    budget_tenths = round(args.budget * TENTHS_PER_MILLION)
    strategies = {
        XP: (xp_scorer, one_a_week),
        XP_USE_BANKED: (xp_scorer, UseBanked()),
        XP_ALLOW_HITS: (xp_scorer, AllowHits()),
        **{
            name: (xp_scorer, Planner(xp_scorer, PlanSettings(rules=ReplayConfig().rules),
                                      horizon=horizon))
            for name, horizon in _PLANNER_HORIZON_BY_STRATEGY.items()
        },
        XP_NO_TRANSFERS: (xp_scorer, None),
        FORM: (form_scorer, one_a_week),
        OWNERSHIP: (ownership_scorer, one_a_week),
        HINDSIGHT: (hindsight_scorer, one_a_week),
    }
    results = {}
    for name, (scorer, policy) in strategies.items():
        if args.strategy and name not in args.strategy:
            continue
        log.info("Replaying %s with %s", season.season, name)
        config = ReplayConfig(transfer_policy=policy, budget_tenths=budget_tenths)
        results[name] = run_replay(season, scorer, config)

    chips = None
    if args.chips:
        log.info("Replaying %s with chips", season.season)
        chip_config = ReplayConfig(transfer_policy=one_a_week, budget_tenths=budget_tenths,
                                   chip_windows=CHIP_WINDOWS_BY_SEASON[args.season])
        chip_results = {
            NO_CHIPS: run_replay(season, xp_scorer, replace(chip_config, chip_policy=no_chips)),
            SIMPLE_RULES: run_replay(season, xp_scorer,
                                     replace(chip_config, chip_policy=SimpleRules())),
            HINDSIGHT_CHIPS: best_chip_schedule(season, xp_scorer, chip_config)[1],
        }
        chips = ChipComparison(
            strategy=XP, baseline=NO_CHIPS, lookahead=FIXTURE_LOOKAHEAD_GAMEWEEKS,
            ceiling=HINDSIGHT_CHIPS,
            runs={
                name: ChipRun(result, chip_gains(season, xp_scorer, chip_config, result))
                for name, result in chip_results.items()
            },
        )

    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_replay_report(
        results=results,
        ceiling_name=HINDSIGHT,
        budget_tenths=budget_tenths,
        season=season.season,
        strength_name=args.strength,
        coefficients_label=str(args.coefficients) if args.coefficients else _BUNDLED_COEFFICIENTS_LABEL,
        run_date=run_date,
        chips=chips,
        injury_flags=flags is not None,
    )
    print(report)

    if args.dry_run:
        return 0
    _BACKTEST_RESULTS_DIR.mkdir(exist_ok=True)
    flags_label = "-flags" if flags is not None else ""
    budget_label = (
        "" if budget_tenths == STARTING_BUDGET_TENTHS
        else f"-budget{budget_tenths / TENTHS_PER_MILLION:g}"
    )
    report_path = (
        _BACKTEST_RESULTS_DIR
        / f"replay-{season.season}-{args.strength}{flags_label}{budget_label}-{run_date}.md"
    )
    report_path.write_text(report)
    log.info("Wrote %s", report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
