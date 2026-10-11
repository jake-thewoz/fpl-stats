from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import (  # noqa: E402
    BOOTSTRAP_KEY,
    FIXTURES_KEY,
    UPCOMING_GAMEWEEK_COUNT,
    lambda_handler,
)
from schemas import SCHEMA_VERSION  # noqa: E402


# GW n's deadline is n weeks after SEASON_START. The default clock sits an
# hour after GW2's deadline: GW2 is live, so the window starts at GW3.
SEASON_START = datetime(2025, 8, 1, 17, 30, tzinfo=timezone.utc)
SEASON_GAMEWEEKS = 6


def _deadline(gw_id: int) -> datetime:
    return SEASON_START + timedelta(weeks=gw_id)


DURING_GW2 = _deadline(2) + timedelta(hours=1)


@pytest.fixture(autouse=True)
def pinned_clock():
    with patch("handler.utc_now", return_value=DURING_GW2) as clock:
        yield clock


def _gameweek(gw_id: int) -> dict:
    return {
        "id": gw_id,
        "name": f"Gameweek {gw_id}",
        "deadline_time": _deadline(gw_id).isoformat().replace("+00:00", "Z"),
        "is_current": False,
        "is_next": False,
        "finished": False,
    }


# boto3 hands back every DynamoDB number as a Decimal; the fixtures here
# do the same so parsing is exercised the way production sees it.
def _fixture(fx_id: int, *, event: int | None, team_h: int, team_a: int,
             kickoff: str = "2025-08-23T14:00:00Z",
             home_difficulty: int = 2, away_difficulty: int = 4) -> dict:
    return {
        "id": Decimal(fx_id),
        "event": None if event is None else Decimal(event),
        "kickoff_time": kickoff,
        "team_h": Decimal(team_h),
        "team_a": Decimal(team_a),
        "team_h_score": None,
        "team_a_score": None,
        "finished": False,
        "started": False,
        "team_h_difficulty": Decimal(home_difficulty),
        "team_a_difficulty": Decimal(away_difficulty),
    }


ARSENAL, VILLA, BRENTFORD = 1, 2, 3
TEAMS = [
    {"id": BRENTFORD, "name": "Brentford", "short_name": "BRE", "code": 94},
    {"id": ARSENAL, "name": "Arsenal", "short_name": "ARS", "code": 3},
    {"id": VILLA, "name": "Aston Villa", "short_name": "AVL", "code": 7},
]


def _bootstrap_item(gameweek_count: int = SEASON_GAMEWEEKS,
                    schema_version: int = SCHEMA_VERSION) -> dict:
    return {
        "pk": "fpl#bootstrap",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": "2026-04-22T00:00:00+00:00",
        "data": {
            "teams": TEAMS,
            "positions": [],
            "players": [],
            "gameweeks": [_gameweek(gw) for gw in range(1, gameweek_count + 1)],
        },
    }


def _fixtures_item(fixtures: list[dict], schema_version: int = SCHEMA_VERSION) -> dict:
    return {
        "pk": "fpl#fixtures",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": "2026-04-22T00:00:00+00:00",
        "data": fixtures,
    }


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _wire_get_item(table: MagicMock, bootstrap: dict | None, fixtures: dict | None):
    def side_effect(*, Key: dict):
        if Key == BOOTSTRAP_KEY:
            return {"Item": bootstrap} if bootstrap is not None else {}
        if Key == FIXTURES_KEY:
            return {"Item": fixtures} if fixtures is not None else {}
        raise AssertionError(f"Unexpected key: {Key}")
    table.get_item.side_effect = side_effect


def _body(table: MagicMock, fixtures: list[dict], **bootstrap_kwargs) -> dict:
    _wire_get_item(table, _bootstrap_item(**bootstrap_kwargs), _fixtures_item(fixtures))
    result = lambda_handler({}, None)
    assert result["statusCode"] == 200
    return json.loads(result["body"])


def _team(body: dict, short_name: str) -> dict:
    return next(t for t in body["teams"] if t["short_name"] == short_name)


def test_window_starts_after_the_live_gameweek(mock_table):
    body = _body(mock_table, [])

    assert body["schema_version"] == SCHEMA_VERSION
    assert body["gameweeks"] == [3, 4, 5]
    assert len(body["gameweeks"]) == UPCOMING_GAMEWEEK_COUNT


def test_each_side_sees_its_own_opponent_venue_and_difficulty(mock_table):
    body = _body(mock_table, [
        _fixture(300, event=3, team_h=ARSENAL, team_a=VILLA,
                 home_difficulty=2, away_difficulty=5),
    ])

    assert _team(body, "ARS")["fixtures"][0] == [{
        "opponent": "AVL",
        "is_home": True,
        "difficulty": 2,
        "kickoff_time": "2025-08-23T14:00:00Z",
    }]
    assert _team(body, "AVL")["fixtures"][0] == [{
        "opponent": "ARS",
        "is_home": False,
        "difficulty": 5,
        "kickoff_time": "2025-08-23T14:00:00Z",
    }]


def test_blank_gameweek_is_an_empty_list_and_double_is_two_by_kickoff(mock_table):
    body = _body(mock_table, [
        _fixture(301, event=3, team_h=BRENTFORD, team_a=ARSENAL,
                 kickoff="2025-08-27T19:00:00Z"),
        _fixture(300, event=3, team_h=ARSENAL, team_a=VILLA,
                 kickoff="2025-08-23T14:00:00Z"),
        _fixture(400, event=4, team_h=VILLA, team_a=BRENTFORD),
    ])

    arsenal = _team(body, "ARS")["fixtures"]
    assert [f["opponent"] for f in arsenal[0]] == ["AVL", "BRE"]
    assert arsenal[1] == []
    assert arsenal[2] == []


def test_fixtures_outside_the_window_are_left_out(mock_table):
    body = _body(mock_table, [
        _fixture(200, event=2, team_h=ARSENAL, team_a=VILLA),
        _fixture(600, event=6, team_h=ARSENAL, team_a=VILLA),
        _fixture(900, event=None, team_h=ARSENAL, team_a=VILLA),
    ])

    assert _team(body, "ARS")["fixtures"] == [[], [], []]


def test_teams_carry_ids_and_are_sorted_by_short_name(mock_table):
    body = _body(mock_table, [])

    assert [(t["id"], t["short_name"]) for t in body["teams"]] == [
        (ARSENAL, "ARS"), (VILLA, "AVL"), (BRENTFORD, "BRE"),
    ]


def test_window_shrinks_at_the_end_of_the_season(mock_table):
    body = _body(mock_table, [], gameweek_count=3)

    assert body["gameweeks"] == [3]
    assert _team(body, "ARS")["fixtures"] == [[]]


def test_cache_not_ready_returns_503(mock_table):
    _wire_get_item(mock_table, _bootstrap_item(), None)

    result = lambda_handler({}, None)

    assert result["statusCode"] == 503
    assert json.loads(result["body"]) == {"error": "cache not ready"}


def test_schema_mismatch_returns_503(mock_table):
    stale_version = SCHEMA_VERSION + 1
    _wire_get_item(
        mock_table,
        _bootstrap_item(),
        _fixtures_item([], schema_version=stale_version),
    )

    result = lambda_handler({}, None)

    assert result["statusCode"] == 503
    assert json.loads(result["body"])["stored"] == stale_version
