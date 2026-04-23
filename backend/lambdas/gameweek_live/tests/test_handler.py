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


GW = 30

# FPL's raw shape: a list of elements, each with a nested `stats` dict and a
# verbose `explain` breakdown. The handler flattens this on the miss path.
RAW_LIVE = {
    "elements": [
        {
            "id": 100,
            "stats": {
                "minutes": 90, "goals_scored": 1, "assists": 0,
                "total_points": 6, "bonus": 1, "bps": 21,
            },
            "explain": [{"fixture": 1, "stats": []}],
        },
        {
            "id": 101,
            "stats": {"minutes": 60, "total_points": 2},
            "explain": [],
        },
        {
            "id": 102,
            # Player didn't play — zeros everywhere.
            "stats": {"minutes": 0, "total_points": 0},
            "explain": [],
        },
    ],
}

# What our handler's flatten produces (what ends up in DDB's `data` column).
FLATTENED = {
    "elements": [
        {"id": 100, "total_points": 6, "minutes": 90},
        {"id": 101, "total_points": 2, "minutes": 60},
        {"id": 102, "total_points": 0, "minutes": 0},
    ],
}


def _event(gw: str | None = str(GW)) -> dict:
    if gw is None:
        return {"pathParameters": None}
    return {"pathParameters": {"gw": gw}}


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def patch_fetch():
    with patch.object(handler, "_fetch_live") as m:
        yield m


@pytest.fixture
def frozen_time():
    with patch.object(handler.time, "time", return_value=1_000_000.0):
        yield 1_000_000.0


def _cached_item(expires_at: float, schema_version: int = SCHEMA_VERSION) -> dict:
    return _as_ddb({
        "pk": f"gameweek#{GW}#live",
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
    patch_fetch.return_value = RAW_LIVE

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "miss"
    assert body["gameweek"] == GW
    assert body["schema_version"] == SCHEMA_VERSION

    # Flattened shape — id + total_points + minutes only; no nested stats.
    assert body["elements"] == [
        {"id": 100, "total_points": 6, "minutes": 90},
        {"id": 101, "total_points": 2, "minutes": 60},
        {"id": 102, "total_points": 0, "minutes": 0},
    ]

    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["pk"] == f"gameweek#{GW}#live"
    assert item["sk"] == "latest"
    assert item["schema_version"] == SCHEMA_VERSION
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
    assert item["ttl"] == item["expires_at"]
    # Cached `data` is the flat shape too.
    assert item["data"]["elements"][0] == {
        "id": 100, "total_points": 6, "minutes": 90,
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
    assert body["elements"][0]["id"] == 100
    assert body["elements"][0]["total_points"] == 6
    patch_fetch.assert_not_called()
    mock_table.put_item.assert_not_called()


# ---- Hit (expired) -> refetch ------------------------------------------------


def test_hit_expired_refetches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time - 1),
    }
    patch_fetch.return_value = RAW_LIVE

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
    patch_fetch.return_value = RAW_LIVE

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()


# ---- FPL 404 -----------------------------------------------------------------


def test_404_from_fpl_returns_404(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.side_effect = handler.GameweekLiveNotFound(GW)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 404
    body = json.loads(result["body"])
    assert body["error"] == "gameweek not found"
    assert body["gameweek"] == GW
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


@pytest.mark.parametrize("raw_gw", [None, "", "abc", "-3", "0", "12.5"])
def test_invalid_gw_returns_400(mock_table, patch_fetch, raw_gw):
    result = lambda_handler(_event(raw_gw), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "invalid gameweek" in body["error"]
    mock_table.get_item.assert_not_called()
    patch_fetch.assert_not_called()


def test_missing_path_parameters_returns_400(mock_table, patch_fetch):
    result = lambda_handler({"pathParameters": None}, None)
    assert result["statusCode"] == 400
    patch_fetch.assert_not_called()


# ---- Flatten edge cases ------------------------------------------------------


def test_missing_stats_dict_flattens_to_zeros(mock_table, patch_fetch, frozen_time):
    """Defensive — if FPL ever omits `stats`, we shouldn't KeyError."""
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = {
        "elements": [{"id": 200, "explain": []}],  # no `stats` key at all
    }

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["elements"] == [{"id": 200, "total_points": 0, "minutes": 0}]


def test_null_stats_values_flatten_to_zeros(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = {
        "elements": [
            {"id": 201, "stats": {"total_points": None, "minutes": None}},
        ],
    }

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["elements"] == [{"id": 201, "total_points": 0, "minutes": 0}]


# ---- Env-var TTL -------------------------------------------------------------


def test_env_var_ttl_is_respected(mock_table, patch_fetch, frozen_time, monkeypatch):
    monkeypatch.setenv("GAMEWEEK_LIVE_TTL_SECONDS", "60")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_LIVE

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + 60


def test_invalid_env_var_falls_back_to_default(
    mock_table, patch_fetch, frozen_time, monkeypatch,
):
    monkeypatch.setenv("GAMEWEEK_LIVE_TTL_SECONDS", "not-a-number")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_LIVE

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS
