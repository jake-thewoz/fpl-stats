"""CLI: honest single-gameweek accuracy of xP on a past season.

For every gameweek from 5 to the last, predicts that gameweek for every
player (standing just before it) and compares with actual FPL points.
These numbers include players who did not play, so they are worse than
``backtest_xp.py``'s; they are the baseline later changes are judged by.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 replay_accuracy.py --season 2025-26 --strength neutral
    python3 replay_accuracy.py --season 2025-26 --strength fpl
    python3 replay_accuracy.py --season 2025-26 --strength odds

Writes ``backtest_results/replay-accuracy-<season>-<strength>-<date>.md``.
"""
from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

# Layer's python/ on sys.path so we can import xp_v2 + xp_v2_features.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from replay_accuracy_report import (  # noqa: E402
    DEFAULT_FIRST_SCORED_GAMEWEEK,
    render_accuracy_report,
    single_gameweek_rows,
)
from odds import (  # noqa: E402
    OddsStrength,
    average_home_share,
    home_share_by_team_ids,
    parse_odds_csv,
)
from replay_predictions import FixtureStrength, FplDifficultyStrength, NeutralStrength  # noqa: E402
from season_archive import (  # noqa: E402
    ARCHIVE_SEASONS,
    load_archive_season,
    load_odds_csv,
    load_team_ids,
    previous_season,
)
from xp_v2 import load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)

_BACKTEST_RESULTS_DIR = _THIS_DIR / "backtest_results"
NEUTRAL = "neutral"
FPL = "fpl"
ODDS = "odds"
ODDS_CLOSING = "odds_closing"
ODDS_ALL_WEEKS = "odds_all_weeks"
STRENGTH_NAMES = (NEUTRAL, FPL, ODDS, ODDS_CLOSING, ODDS_ALL_WEEKS)
DEFAULT_STRENGTH = NEUTRAL
STRENGTH_HELP = (
    f"Opponent strength source: {NEUTRAL} (everyone mid-table), {FPL} (FPL's 1-5 "
    f"difficulty), {ODDS} (pre-match bookmaker odds for the next gameweek, FPL difficulty "
    f"after), {ODDS_CLOSING} (closing odds: an upper bound), {ODDS_ALL_WEEKS} (pre-match "
    "odds for every week ahead: a leak, for comparison only)."
)


def build_fixture_strength(name: str, season: str) -> FixtureStrength:
    """The strength source ``name`` for ``season``; odds sources download
    that season's odds and the season before's (for the home baseline)."""
    if name == NEUTRAL:
        return NeutralStrength()
    if name == FPL:
        return FplDifficultyStrength()
    matches = parse_odds_csv(load_odds_csv(season), closing=name == ODDS_CLOSING)
    baseline = average_home_share(parse_odds_csv(load_odds_csv(previous_season(season)),
                                                 closing=False))
    strength = OddsStrength(
        home_share_by_clubs=home_share_by_team_ids(matches, load_team_ids(season)),
        baseline_home_share=baseline,
        fallback=FplDifficultyStrength(),
    )
    if name == ODDS_ALL_WEEKS:
        return replace(strength, available_gameweeks=None)
    return strength


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", required=True, choices=ARCHIVE_SEASONS)
    parser.add_argument("--strength", choices=STRENGTH_NAMES, default=DEFAULT_STRENGTH,
                        help=STRENGTH_HELP)
    parser.add_argument("--first-gameweek", type=int, default=DEFAULT_FIRST_SCORED_GAMEWEEK,
                        help=f"First gameweek scored (default {DEFAULT_FIRST_SCORED_GAMEWEEK}).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the report without writing it.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    season = load_archive_season(args.season)
    rows = single_gameweek_rows(
        season=season,
        first_gameweek=args.first_gameweek,
        coefs=load_default_coefficients(),
        priors=load_default_priors(),
        window=FeatureWindow(),
        fixture_strength=build_fixture_strength(args.strength, args.season),
    )
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report = render_accuracy_report(
        rows=rows, season=args.season, strength_name=args.strength, run_date=run_date,
    )
    print(report)

    if args.dry_run:
        return 0
    _BACKTEST_RESULTS_DIR.mkdir(exist_ok=True)
    report_path = (
        _BACKTEST_RESULTS_DIR / f"replay-accuracy-{args.season}-{args.strength}-{run_date}.md"
    )
    report_path.write_text(report)
    log.info("Wrote %s", report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
