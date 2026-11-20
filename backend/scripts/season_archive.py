"""Load ``SeasonData`` from the public archive (past seasons) or from our
DynamoDB cache (the current season).

The archive is ``vaastav/Fantasy-Premier-League`` on GitHub. It is only
refreshed a few times a year, which is why the current season comes from
DynamoDB instead. Downloads are cached under ``.season_cache/<season>/``
and read from there afterwards.
"""
from __future__ import annotations

import csv
import io
import logging
import sys
import urllib.request
from pathlib import Path
from typing import Any

# Layer's python/ on sys.path so we can import schemas.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from data import load_bootstrap, scan_player_history  # noqa: E402
from schemas import Fixture  # noqa: E402
from season_data import SeasonData, parse_archive_season  # noqa: E402

log = logging.getLogger(__name__)

# Expected-goals fields start in 2022-23, so earlier seasons can't feed the model.
ARCHIVE_SEASONS: tuple[str, ...] = ("2022-23", "2023-24", "2024-25", "2025-26")

ARCHIVE_BASE_URL = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
MERGED_GW_PATH = "gws/merged_gw.csv"
TEAMS_PATH = "teams.csv"
FIXTURES_PATH = "fixtures.csv"
SEASON_CACHE_DIR = _THIS_DIR / ".season_cache"
DOWNLOAD_TIMEOUT_SECONDS = 60
ARCHIVE_TEXT_ENCODING = "utf-8"

FIXTURES_KEY = {"pk": "fpl#fixtures", "sk": "latest"}
# football-data.co.uk's Premier League match results and odds, one file
# a season under a four-digit code ("2025-26" -> "2526").
ODDS_BASE_URL = "https://football-data.co.uk/mmz4281"
ODDS_FILE_NAME = "E0.csv"
ODDS_CACHE_SUBDIR = "odds"
ODDS_TEXT_ENCODING = "utf-8-sig"
_SEASON_CODE_DIGITS = 2
TEAM_NAME_COLUMN = "name"
TEAM_ID_COLUMN = "id"


def load_archive_season(season: str) -> SeasonData:
    """Parse one past season (e.g. ``"2024-25"``), downloading it on first use."""
    return parse_archive_season(
        season,
        merged_gw_csv_text=_cached_archive_file(season, MERGED_GW_PATH),
        teams_csv_text=_cached_archive_file(season, TEAMS_PATH),
        fixtures_csv_text=_cached_archive_file(season, FIXTURES_PATH),
    )


def load_current_season(table: Any) -> SeasonData:
    """The in-progress season from the cache table.

    The bootstrap only knows each player's club today, so every round maps
    to that club. Rows for players no longer in the bootstrap get no
    position or club and are skipped downstream.
    """
    bootstrap = load_bootstrap(table)
    rows = scan_player_history(table)
    fixtures = load_fixtures(table)
    player_by_id = {player.id: player for player in bootstrap.players}

    team_by_player_round: dict[tuple[int, int], int] = {}
    value_by_player_round: dict[tuple[int, int], int] = {}
    selected_by_player_round: dict[tuple[int, int], int] = {}
    rounds_priced_from_bootstrap = 0
    for row in rows:
        player = player_by_id.get(row.element)
        if player is None:
            continue
        player_round = (row.element, row.round)
        team_by_player_round[player_round] = player.team
        if row.value is not None:
            value_by_player_round[player_round] = row.value
        else:
            value_by_player_round[player_round] = player.now_cost
            rounds_priced_from_bootstrap += 1
        if row.selected is not None:
            selected_by_player_round[player_round] = row.selected

    if rounds_priced_from_bootstrap:
        log.warning(
            "%d of %d history rows have no stored price or ownership (cached "
            "before ingest stored them). Using today's now_cost as their price "
            "and leaving their ownership unknown.",
            rounds_priced_from_bootstrap, len(rows),
        )

    return SeasonData(
        season=_season_name(fixtures),
        rows=rows,
        position_by_player={player.id: player.element_type for player in bootstrap.players},
        team_by_player_round=team_by_player_round,
        value_by_player_round=value_by_player_round,
        selected_by_player_round=selected_by_player_round,
        name_by_player={player.id: player.web_name for player in bootstrap.players},
        fixtures=fixtures,
    )


def load_fixtures(table: Any) -> list[Fixture]:
    item = table.get_item(Key=FIXTURES_KEY).get("Item")
    if not item:
        raise RuntimeError("fpl#fixtures missing — has ingest_fpl run?")
    return [Fixture.model_validate(fixture) for fixture in item["data"]]


def load_odds_csv(season: str) -> str:
    """football-data.co.uk's odds file for ``season``, downloaded on first use."""
    start_year, end_year = season.split("-")
    code = start_year[-_SEASON_CODE_DIGITS:] + end_year[-_SEASON_CODE_DIGITS:]
    cached_path = SEASON_CACHE_DIR / ODDS_CACHE_SUBDIR / f"{code}-{ODDS_FILE_NAME}"
    if not cached_path.exists():
        url = f"{ODDS_BASE_URL}/{code}/{ODDS_FILE_NAME}"
        log.info("Downloading %s", url)
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            body = response.read()
        cached_path.parent.mkdir(parents=True, exist_ok=True)
        cached_path.write_bytes(body)
    return cached_path.read_text(encoding=ODDS_TEXT_ENCODING)


def load_team_ids(season: str) -> dict[str, int]:
    """FPL club name -> team id for a past season."""
    reader = csv.DictReader(io.StringIO(_cached_archive_file(season, TEAMS_PATH)))
    return {row[TEAM_NAME_COLUMN]: int(row[TEAM_ID_COLUMN]) for row in reader}


def previous_season(season: str) -> str:
    start_year, end_year = (int(part) for part in season.split("-"))
    width = len(season.split("-")[1])
    return f"{start_year - 1}-{str(end_year - 1).zfill(width)}"


def _cached_archive_file(season: str, relative_path: str) -> str:
    cached_path = SEASON_CACHE_DIR / season / relative_path
    if not cached_path.exists():
        url = f"{ARCHIVE_BASE_URL}/{season}/{relative_path}"
        log.info("Downloading %s", url)
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            body = response.read()
        cached_path.parent.mkdir(parents=True, exist_ok=True)
        cached_path.write_bytes(body)
    return cached_path.read_text(encoding=ARCHIVE_TEXT_ENCODING)


def _season_name(fixtures: list[Fixture]) -> str:
    """``"2026-27"`` style name, from the year of the earliest kickoff."""
    kickoffs = sorted(fixture.kickoff_time for fixture in fixtures if fixture.kickoff_time)
    if not kickoffs:
        raise RuntimeError("No fixture has a kickoff time, so the season can't be named.")
    start_year = int(kickoffs[0][:4])
    return f"{start_year}-{(start_year + 1) % 100:02d}"
