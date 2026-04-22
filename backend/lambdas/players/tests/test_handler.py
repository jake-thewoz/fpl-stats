from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import BOOTSTRAP_KEY, lambda_handler  # noqa: E402
from schemas import SCHEMA_VERSION  # noqa: E402


TEAMS = [
    {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3},
    {"id": 2, "name": "Aston Villa", "short_name": "AVL", "code": 7},
]

POSITIONS = [
    {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
    {"id": 2, "singular_name": "Defender", "singular_name_short": "DEF"},
    {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
    {"id": 4, "singular_name": "Forward", "singular_name_short": "FWD"},
]

PLAYERS_RAW = [
    {"id": 10, "first_name": "Bukayo", "second_name": "Saka", "web_name": "Saka",
     "team": 1, "element_type": 3, "total_points": 120, "form": "5.2", "now_cost": 90},
    {"id": 11, "first_name": "David", "second_name": "Raya", "web_name": "Raya",
     "team": 1, "element_type": 1, "total_points": 90, "form": "3.1", "now_cost": 55},
    {"id": 20, "first_name": "Ollie", "second_name": "Watkins", "web_name": "Watkins",
     "team": 2, "element_type": 4, "total_points": 110, "form": "4.0", "now_cost": 85},
]


def _bootstrap_item(schema_version: int = SCHEMA_VERSION) -> dict:
    return {
        "pk": "fpl#bootstrap",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": "2026-04-22T00:00:00+00:00",
        "data": {
            "teams": TEAMS,
            "positions": POSITIONS,
            "players": PLAYERS_RAW,
            "gameweeks": [],
        },
    }


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _wire_bootstrap(table: MagicMock, item: dict | None):
    def side_effect(*, Key: dict):
        if Key == BOOTSTRAP_KEY:
            return {"Item": item} if item is not None else {}
        raise AssertionError(f"Unexpected key: {Key}")
    table.get_item.side_effect = side_effect


def _event(query: dict | None = None) -> dict:
    return {"queryStringParameters": query}


def test_no_filter_returns_all_players(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["count"] == 3
    ids = [p["id"] for p in body["players"]]
    assert ids == [10, 11, 20]


def test_row_shape_is_flat_with_price_converted(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event(), None)
    body = json.loads(result["body"])
    row = next(p for p in body["players"] if p["id"] == 10)

    assert row == {
        "id": 10,
        "name": "Saka",
        "team": "ARS",
        "position": "MID",
        "total_points": 120,
        "form": "5.2",
        "price": 9.0,
    }


def test_team_filter_narrows_list(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"team": "ARS"}), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["count"] == 2
    assert {p["id"] for p in body["players"]} == {10, 11}


def test_position_filter_narrows_list(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"position": "FWD"}), None)

    body = json.loads(result["body"])
    assert body["count"] == 1
    assert body["players"][0]["id"] == 20


def test_team_and_position_filters_are_anded(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"team": "ARS", "position": "MID"}), None)

    body = json.loads(result["body"])
    assert body["count"] == 1
    assert body["players"][0]["id"] == 10


def test_filter_is_case_insensitive(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"team": "ars", "position": "mid"}), None)

    body = json.loads(result["body"])
    assert body["count"] == 1
    assert body["players"][0]["id"] == 10


def test_unknown_team_returns_400(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"team": "XYZ"}), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert body["error"] == "unknown team"
    assert body["value"] == "XYZ"
    assert set(body["valid"]) == {"ARS", "AVL"}


def test_unknown_position_returns_400(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item())

    result = lambda_handler(_event({"position": "ZZZ"}), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert body["error"] == "unknown position"


def test_cache_not_ready_returns_503(mock_table):
    _wire_bootstrap(mock_table, None)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 503
    assert json.loads(result["body"])["error"] == "cache not ready"


def test_schema_mismatch_returns_503(mock_table):
    _wire_bootstrap(mock_table, _bootstrap_item(schema_version=999))

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 503
    body = json.loads(result["body"])
    assert body["error"] == "schema version mismatch"
    assert body["stored"] == 999
