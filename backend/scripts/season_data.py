"""One FPL season of per-match data, in the shape the fit and replay use.

Pure parsing only: the archive download and the DynamoDB reads live in
``season_archive.py``. Archive rows come from the public
``vaastav/Fantasy-Premier-League`` repository, whose ``merged_gw.csv``
columns match FPL's ``/element-summary/`` history.

Player ids are only meaningful inside one season, so nothing here joins
players across seasons.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Iterable

from schemas import Fixture, PlayerHistoryRow

POSITION_ID_BY_ARCHIVE_CODE: dict[str, int] = {
    "GK": 1,
    "DEF": 2,
    "MID": 3,
    "FWD": 4,
}
# 2024-25 listed assistant managers as a fifth "position"; they are not players.
ASSISTANT_MANAGER_POSITION = "AM"

# The archive's own pre-computed xP is built with post-match information.
LEAKY_ARCHIVE_COLUMNS = frozenset({"xP"})

PLAYER_ID_COLUMN = "element"
FIXTURE_ID_COLUMN = "fixture"
ROUND_COLUMN = "round"
NAME_COLUMN = "name"
POSITION_COLUMN = "position"
TEAM_NAME_COLUMN = "team"
TEAM_ID_COLUMN = "id"


@dataclass(frozen=True)
class SeasonData:
    season: str
    rows: list[PlayerHistoryRow]
    position_by_player: dict[int, int]
    team_by_player_round: dict[tuple[int, int], int]
    value_by_player_round: dict[tuple[int, int], int]
    selected_by_player_round: dict[tuple[int, int], int]
    name_by_player: dict[int, str]
    fixtures: list[Fixture]


def parse_archive_season(
    season: str,
    merged_gw_csv_text: str,
    teams_csv_text: str,
    fixtures_csv_text: str,
) -> SeasonData:
    team_id_by_name = {
        record[NAME_COLUMN]: int(record[TEAM_ID_COLUMN])
        for record in _read_csv(teams_csv_text)
    }
    fixtures = [Fixture.model_validate(record) for record in _read_csv(fixtures_csv_text)]

    latest_record_by_match: dict[tuple[int, int], dict[str, str | None]] = {}
    for record in _read_csv(merged_gw_csv_text):
        if record[POSITION_COLUMN] == ASSISTANT_MANAGER_POSITION:
            continue
        match_key = (int(record[PLAYER_ID_COLUMN]), int(record[FIXTURE_ID_COLUMN]))
        # Pop first so a later duplicate also takes the later position in order.
        latest_record_by_match.pop(match_key, None)
        latest_record_by_match[match_key] = record

    rows: list[PlayerHistoryRow] = []
    position_by_player: dict[int, int] = {}
    team_by_player_round: dict[tuple[int, int], int] = {}
    value_by_player_round: dict[tuple[int, int], int] = {}
    selected_by_player_round: dict[tuple[int, int], int] = {}
    name_by_player: dict[int, str] = {}
    for record in latest_record_by_match.values():
        row = PlayerHistoryRow.model_validate(record)
        rows.append(row)
        player_round = (row.element, row.round)
        position_by_player[row.element] = _position_id(record[POSITION_COLUMN])
        team_by_player_round[player_round] = team_id_by_name[record[TEAM_NAME_COLUMN]]
        name_by_player[row.element] = record[NAME_COLUMN]
        if row.value is not None:
            value_by_player_round[player_round] = row.value
        if row.selected is not None:
            selected_by_player_round[player_round] = row.selected

    return SeasonData(
        season=season,
        rows=rows,
        position_by_player=position_by_player,
        team_by_player_round=team_by_player_round,
        value_by_player_round=value_by_player_round,
        selected_by_player_round=selected_by_player_round,
        name_by_player=name_by_player,
        fixtures=fixtures,
    )


def _read_csv(text: str) -> Iterable[dict[str, str | None]]:
    """Rows as dicts, with blank cells as None so optional schema fields
    parse, and leaky columns removed before anything can read them."""
    for record in csv.DictReader(io.StringIO(text)):
        yield {
            column: (cell if cell != "" else None)
            for column, cell in record.items()
            if column not in LEAKY_ARCHIVE_COLUMNS
        }


def _position_id(archive_code: str | None) -> int:
    try:
        return POSITION_ID_BY_ARCHIVE_CODE[archive_code]
    except KeyError:
        raise ValueError(f"Unknown archive position {archive_code!r}") from None
