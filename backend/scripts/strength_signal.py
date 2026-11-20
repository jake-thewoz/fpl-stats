"""CLI: how well does each opponent-strength source predict goals
conceded and clean sheets, match by match? (#244)

Every finished fixture counts twice, once from each side. Spearman ρ
between opponent strength and goals conceded (higher is better), and
between opponent strength and keeping a clean sheet (more negative is
better). Odds here cover every week, with no time limit.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 strength_signal.py --season 2023-24 --season 2024-25 --season 2025-26
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from fit import spearman  # noqa: E402
from odds import strength_and_goals_conceded  # noqa: E402
from replay_accuracy import FPL, ODDS, ODDS_CLOSING, build_fixture_strength  # noqa: E402
from season_archive import ARCHIVE_SEASONS, load_archive_season  # noqa: E402

SOURCES = (FPL, ODDS, ODDS_CLOSING)
CLEAN_SHEET_GOALS = 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", action="append", required=True, choices=ARCHIVE_SEASONS)
    args = parser.parse_args(argv)

    print("| season | source | ρ goals conceded | ρ clean sheet |")
    print("|---|---|---|---|")
    for season_name in args.season:
        season = load_archive_season(season_name)
        for source in SOURCES:
            pairs = strength_and_goals_conceded(season, build_fixture_strength(source, season_name))
            clean_sheets = [(strength, int(conceded == CLEAN_SHEET_GOALS))
                            for strength, conceded in pairs]
            print(f"| {season_name} | {source} | {spearman(pairs):.3f} | "
                  f"{spearman(clean_sheets):.3f} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
