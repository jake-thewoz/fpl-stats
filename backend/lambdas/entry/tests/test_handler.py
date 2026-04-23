from __future__ import annotations

import json
import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402
from schemas import SCHEMA_VERSION  # noqa: E402


def _as_ddb(value):
    """Recursively wrap numbers in Decimal to match what boto3's resource
    API actually returns from DynamoDB. Booleans are left alone because
    ``isinstance(True, int)`` is True in Python."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _as_ddb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_as_ddb(v) for v in value]
    return value


TEAM_ID = 1234567

RAW_ENTRY = {
    "id": TEAM_ID,
    "name": "Test FC",
    "player_first_name": "Alex",
    "player_last_name": "Manager",
    "started_event": 1,
    "favourite_team": 3,
    "summary_overall_points": 1800,
    "summary_overall_rank": 210_000,
    "summary_event_points": 60,
    "summary_event_rank": 42_000,
    "current_event": 30,
    "last_deadline_value": 1010,
    "last_deadline_bank": 5,
    "last_deadline_total_transfers": 18,
    # Extra fields FPL returns — pydantic ignores these by default.
    "leagues": {"classic": [], "h2h": []},
    "joined_time": "2023-08-01T12:00:00Z",
}


def _event(team_id: str | None = str(TEAM_ID)) -> dict:
    if team_id is None:
        return {"pathParameters": None}
    return {"pathParameters": {"teamId": team_id}}


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def patch_fetch():
    with patch.object(handler, "_fetch_entry") as m:
        yield m


@pytest.fixture
def frozen_time():
    with patch.object(handler.time, "time", return_value=1_000_000.0):
        yield 1_000_000.0


def _cached_item(expires_at: float, schema_version: int = SCHEMA_VERSION) -> dict:
    # Mirror what boto3's DynamoDB resource returns: every number comes back
    # as decimal.Decimal, not int/float. Keeping the mock realistic is what
    # lets this test actually cover the freshness + JSON-serialization paths.
    return _as_ddb({
        "pk": f"entry#{TEAM_ID}",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": int(expires_at) - 100,
        "expires_at": expires_at,
        "ttl": int(expires_at),
        "data": {k: v for k, v in RAW_ENTRY.items() if k in {
            "id", "name", "player_first_name", "player_last_name",
            "started_event", "favourite_team",
            "summary_overall_points", "summary_overall_rank",
            "summary_event_points", "summary_event_rank",
            "current_event",
            "last_deadline_value", "last_deadline_bank", "last_deadline_total_transfers",
        }},
    })


# ---- Miss -> fetch + cache ---------------------------------------------------


def test_miss_fetches_and_caches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_ENTRY

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["entry"]["id"] == TEAM_ID
    assert body["entry"]["name"] == "Test FC"
    assert body["cache"] == "miss"

    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["pk"] == f"entry#{TEAM_ID}"
    assert item["sk"] == "latest"
    assert item["schema_version"] == SCHEMA_VERSION
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
    assert item["ttl"] == item["expires_at"]


# ---- Hit (fresh) -> no fetch -------------------------------------------------


def test_hit_fresh_returns_cached_without_fetch(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time + 60),
    }

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "hit"
    assert body["entry"]["id"] == TEAM_ID
    patch_fetch.assert_not_called()
    mock_table.put_item.assert_not_called()


# ---- Hit (expired) -> refetch ------------------------------------------------


def test_hit_expired_refetches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time - 1),
    }
    patch_fetch.return_value = RAW_ENTRY

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "miss"
    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()


# ---- Schema mismatch -> refetch ---------------------------------------------


def test_schema_mismatch_refetches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(
            expires_at=frozen_time + 60,
            schema_version=SCHEMA_VERSION + 1,
        ),
    }
    patch_fetch.return_value = RAW_ENTRY

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()


# ---- FPL 404 -----------------------------------------------------------------


def test_404_from_fpl_returns_404(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.side_effect = handler.EntryNotFound(TEAM_ID)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 404
    body = json.loads(result["body"])
    assert body["error"] == "team not found"
    assert body["team_id"] == TEAM_ID
    mock_table.put_item.assert_not_called()


# ---- Invalid team id ---------------------------------------------------------


@pytest.mark.parametrize("raw_id", [None, "", "abc", "-3", "0", "12.5"])
def test_invalid_team_id_returns_400(mock_table, patch_fetch, raw_id):
    result = lambda_handler(_event(raw_id), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert body["error"] == "invalid team id"
    mock_table.get_item.assert_not_called()
    patch_fetch.assert_not_called()


def test_missing_path_parameters_returns_400(mock_table, patch_fetch):
    result = lambda_handler({"pathParameters": None}, None)
    assert result["statusCode"] == 400
    patch_fetch.assert_not_called()


# ---- Env-var TTL -------------------------------------------------------------


def test_env_var_ttl_is_respected(mock_table, patch_fetch, frozen_time, monkeypatch):
    monkeypatch.setenv("ENTRY_TTL_SECONDS", "60")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_ENTRY

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + 60


def test_invalid_env_var_falls_back_to_default(
    mock_table, patch_fetch, frozen_time, monkeypatch,
):
    monkeypatch.setenv("ENTRY_TTL_SECONDS", "not-a-number")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_ENTRY

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
