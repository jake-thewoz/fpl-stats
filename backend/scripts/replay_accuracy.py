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

Writes ``backtest_results/replay-accuracy-<season>-<strength>-<date>.md``.
"""
from __future__ import annotations

import argparse
import logging
import sys
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
from replay_predictions import FplDifficultyStrength, NeutralStrength  # noqa: E402
from season_archive import ARCHIVE_SEASONS, load_archive_season  # noqa: E402
from xp_v2 import load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors  # noqa: E402

log = logging.getLogger(__name__)

_BACKTEST_RESULTS_DIR = _THIS_DIR / "backtest_results"
STRENGTH_BY_NAME = {
    "neutral": NeutralStrength(),
    "fpl": FplDifficultyStrength(),
}
DEFAULT_STRENGTH = "neutral"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", required=True, choices=ARCHIVE_SEASONS)
    parser.add_argument("--strength", choices=sorted(STRENGTH_BY_NAME), default=DEFAULT_STRENGTH,
                        help="Opponent strength source (default neutral).")
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
        fixture_strength=STRENGTH_BY_NAME[args.strength],
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
