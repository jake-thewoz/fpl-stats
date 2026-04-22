from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import BOOTSTRAP_KEY, FIXTURES_KEY, lambda_handler  # noqa: E402
from schemas import SCHEMA_VERSION  # noqa: E402


def _gameweek(gw_id: int, *, is_current: bool = False, is_next: bool = False,
              finished: bool = False) -> dict:
    return {
        "id": gw_id,
        "name": f"Gameweek {gw_id}",
        "deadline_time": "2025-08-15T17:30:00Z",
        "is_current": is_current,
        "is_next": is_next,
        "finished": finished,
    }


def _fixture(fx_id: int, *, event: int | None, team_h: int = 1,
             team_a: int = 2) -> dict:
    return {
        "id": fx_id,
        "event": event,
        "kickoff_time": "2025-08-15T19:00:00Z",
        "team_h": team_h,
        "team_a": team_a,
        "team_h_score": None,
        "team_a_score": None,
        "finished": False,
        "started": False,
    }


def _bootstrap_item(gameweeks: list[dict], schema_version: int = SCHEMA_VERSION) -> dict:
    return {
        "pk": "fpl#bootstrap",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": "2026-04-22T00:00:00+00:00",
        "data": {
            "teams": [],
            "positions": [],
            "players": [],
            "gameweeks": gameweeks,
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
    """Make table.get_item return the right Item based on the requested key."""
    def side_effect(*, Key: dict):
        if Key == BOOTSTRAP_KEY:
            return {"Item": bootstrap} if bootstrap is not None else {}
        if Key == FIXTURES_KEY:
            return {"Item": fixtures} if fixtures is not None else {}
        raise AssertionError(f"Unexpected key: {Key}")
    table.get_item.side_effect = side_effect


def test_happy_path_returns_current_gameweek_and_its_fixtures(mock_table):
    _wire_get_item(
        mock_table,
        bootstrap=_bootstrap_item([
            _gameweek(1, finished=True),
            _gameweek(2, is_current=True),
            _gameweek(3, is_next=True),
        ]),
        fixtures=_fixtures_item([
            _fixture(100, event=1),
            _fixture(200, event=2),
            _fixture(201, event=2),
            _fixture(300, event=3),
            _fixture(400, event=None),
        ]),
    )

    result = lambda_handler({}, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["gameweek"]["id"] == 2
    assert body["gameweek"]["is_current"] is True
    fixture_ids = [f["id"] for f in body["fixtures"]]
    assert fixture_ids == [200, 201]


def test_pre_season_returns_null_gameweek_and_empty_fixtures(mock_table):
    _wire_get_item(
        mock_table,
        bootstrap=_bootstrap_item([
            _gameweek(1),
            _gameweek(2, is_next=True),
        ]),
        fixtures=_fixtures_item([_fixture(100, event=1)]),
    )

    result = lambda_handler({}, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["gameweek"] is None
    assert body["fixtures"] == []


def test_missing_cache_returns_503(mock_table):
    _wire_get_item(mock_table, bootstrap=None, fixtures=None)

    result = lambda_handler({}, None)

    assert result["statusCode"] == 503
    assert json.loads(result["body"])["error"] == "cache not ready"


def test_schema_mismatch_returns_503(mock_table):
    _wire_get_item(
        mock_table,
        bootstrap=_bootstrap_item([_gameweek(1, is_current=True)], schema_version=999),
        fixtures=_fixtures_item([_fixture(100, event=1)]),
    )

    result = lambda_handler({}, None)

    assert result["statusCode"] == 503
    body = json.loads(result["body"])
    assert body["error"] == "schema version mismatch"
    assert body["expected"] == SCHEMA_VERSION
    assert body["stored"] == 999
