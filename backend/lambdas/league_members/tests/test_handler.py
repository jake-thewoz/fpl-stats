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


LEAGUE_ID = 123456

# FPL's raw shape for /leagues-classic/{id}/standings/. We keep a few extra
# fields (new_entries, last_updated_data) to prove the flatten drops them.
RAW_STANDINGS = {
    "league": {
        "id": LEAGUE_ID,
        "name": "My League",
        "created": "2023-08-01T12:00:00Z",
        "closed": False,
    },
    "new_entries": {"has_next": False, "page": 1, "results": []},
    "last_updated_data": "2026-04-23T12:00:00Z",
    "standings": {
        "has_next": False,
        "page": 1,
        "results": [
            {
                "id": 1,
                "event_total": 65,
                "player_name": "Alex Manager",
                "rank": 1,
                "last_rank": 2,
                "rank_sort": 1,
                "total": 1950,
                "entry": 1234567,
                "entry_name": "Team One",
            },
            {
                "id": 2,
                "event_total": 58,
                "player_name": "Bob Manager",
                "rank": 2,
                "last_rank": 1,
                "rank_sort": 2,
                "total": 1910,
                "entry": 2345678,
                "entry_name": "Team Two",
            },
            {
                "id": 3,
                "event_total": 50,
                "player_name": "Claire Manager",
                "rank": 3,
                "last_rank": 4,
                "rank_sort": 3,
                "total": 1880,
                "entry": 3456789,
                "entry_name": "Team Three",
            },
        ],
    },
}

# What our handler's flatten produces (what ends up in DDB's `data` column).
FLATTENED = {
    "league": {"id": LEAGUE_ID, "name": "My League"},
    "members": [
        {"entry": 1234567, "entry_name": "Team One",
         "player_name": "Alex Manager", "rank": 1, "total": 1950},
        {"entry": 2345678, "entry_name": "Team Two",
         "player_name": "Bob Manager", "rank": 2, "total": 1910},
        {"entry": 3456789, "entry_name": "Team Three",
         "player_name": "Claire Manager", "rank": 3, "total": 1880},
    ],
    "has_more": False,
}


def _event(league_id: str | None = str(LEAGUE_ID)) -> dict:
    if league_id is None:
        return {"pathParameters": None}
    return {"pathParameters": {"leagueId": league_id}}


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def patch_fetch():
    with patch.object(handler, "_fetch_standings") as m:
        yield m


@pytest.fixture
def frozen_time():
    with patch.object(handler.time, "time", return_value=1_000_000.0):
        yield 1_000_000.0


def _cached_item(expires_at: float, schema_version: int = SCHEMA_VERSION) -> dict:
    return _as_ddb({
        "pk": f"league#{LEAGUE_ID}",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": int(expires_at) - 100,
        "expires_at": expires_at,
        "ttl": int(expires_at),
        "data": FLATTENED,
    })


# ---- Miss -> fetch + flatten + cache -----------------------------------------


def test_miss_fetches_flattens_and_caches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_STANDINGS

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "miss"
    assert body["schema_version"] == SCHEMA_VERSION
    assert body["league"] == {"id": LEAGUE_ID, "name": "My League"}
    assert body["has_more"] is False
    assert len(body["members"]) == 3

    # Flattened shape — only the fields we need, in the order of rank.
    first = body["members"][0]
    assert first == {
        "entry": 1234567,
        "entry_name": "Team One",
        "player_name": "Alex Manager",
        "rank": 1,
        "total": 1950,
    }

    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["pk"] == f"league#{LEAGUE_ID}"
    assert item["sk"] == "latest"
    assert item["schema_version"] == SCHEMA_VERSION
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
    assert item["ttl"] == item["expires_at"]
    # Cached `data` is the flat shape too — no stray new_entries /
    # last_updated_data / per-row id / event_total / last_rank.
    assert "new_entries" not in item["data"]
    assert "last_updated_data" not in item["data"]
    assert set(item["data"]["members"][0].keys()) == {
        "entry", "entry_name", "player_name", "rank", "total",
    }


# ---- Hit (fresh) -> no fetch -------------------------------------------------


def test_hit_fresh_returns_cached_without_fetch(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time + 60),
    }

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "hit"
    # Proves the response was JSON-serialized successfully despite the
    # Decimal-wrapped mock — would raise TypeError without _json_default.
    assert body["league"]["id"] == LEAGUE_ID
    assert len(body["members"]) == 3
    assert body["members"][0]["total"] == 1950
    patch_fetch.assert_not_called()
    mock_table.put_item.assert_not_called()


# ---- Hit (expired) -> refetch ------------------------------------------------


def test_hit_expired_refetches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time - 1),
    }
    patch_fetch.return_value = RAW_STANDINGS

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
    patch_fetch.return_value = RAW_STANDINGS

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()


# ---- FPL 404 -----------------------------------------------------------------


def test_404_from_fpl_returns_404(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.side_effect = handler.LeagueNotFound(LEAGUE_ID)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 404
    body = json.loads(result["body"])
    assert body["error"] == "league not found"
    assert body["league_id"] == LEAGUE_ID
    mock_table.put_item.assert_not_called()


# ---- Upstream failure --------------------------------------------------------


def test_upstream_failure_returns_502(mock_table, patch_fetch, frozen_time):
    import requests as _requests
    mock_table.get_item.return_value = {}
    patch_fetch.side_effect = _requests.ConnectionError("boom")

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 502
    body = json.loads(result["body"])
    assert body["error"] == "upstream error"
    mock_table.put_item.assert_not_called()


# ---- Invalid path params -----------------------------------------------------


@pytest.mark.parametrize("raw_id", [None, "", "abc", "-3", "0", "12.5"])
def test_invalid_league_id_returns_400(mock_table, patch_fetch, raw_id):
    result = lambda_handler(_event(raw_id), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "invalid league id" in body["error"]
    mock_table.get_item.assert_not_called()
    patch_fetch.assert_not_called()


def test_missing_path_parameters_returns_400(mock_table, patch_fetch):
    result = lambda_handler({"pathParameters": None}, None)
    assert result["statusCode"] == 400
    patch_fetch.assert_not_called()


# ---- Flatten edge cases ------------------------------------------------------


def test_has_more_flag_surfaced(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = {
        **RAW_STANDINGS,
        "standings": {
            **RAW_STANDINGS["standings"],
            "has_next": True,
        },
    }

    result = lambda_handler(_event(), None)
    body = json.loads(result["body"])
    assert body["has_more"] is True


def test_missing_standings_returns_empty_list(mock_table, patch_fetch, frozen_time):
    """Defensive — if FPL omits standings entirely, don't KeyError."""
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = {"league": {"id": LEAGUE_ID, "name": "Empty League"}}

    result = lambda_handler(_event(), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["members"] == []
    assert body["league"]["name"] == "Empty League"


def test_results_missing_entry_id_are_skipped(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = {
        "league": {"id": LEAGUE_ID, "name": "Partial"},
        "standings": {
            "results": [
                {"entry": 1, "entry_name": "Real", "player_name": "R",
                 "rank": 1, "total": 100},
                {"entry": None, "entry_name": "Broken", "player_name": "B",
                 "rank": 2, "total": 90},
            ],
        },
    }

    result = lambda_handler(_event(), None)
    body = json.loads(result["body"])
    assert [m["entry"] for m in body["members"]] == [1]


# ---- Env-var TTL -------------------------------------------------------------


def test_env_var_ttl_is_respected(mock_table, patch_fetch, frozen_time, monkeypatch):
    monkeypatch.setenv("LEAGUE_TTL_SECONDS", "60")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_STANDINGS

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + 60


def test_invalid_env_var_falls_back_to_default(
    mock_table, patch_fetch, frozen_time, monkeypatch,
):
    monkeypatch.setenv("LEAGUE_TTL_SECONDS", "not-a-number")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_STANDINGS

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
