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
GW = 30

RAW_PICKS = {
    "active_chip": None,
    "automatic_subs": [],  # extra field pydantic will ignore
    "entry_history": {
        "event": GW,
        "points": 65,
        "total_points": 1850,
        "rank": 120_000,
        "overall_rank": 210_000,
        "bank": 5,
        "value": 1010,
        "event_transfers": 1,
        "event_transfers_cost": 0,
        "points_on_bench": 12,
    },
    "picks": [
        {"element": 100 + i, "position": i + 1, "multiplier": 1,
         "is_captain": i == 0, "is_vice_captain": i == 1}
        for i in range(11)
    ] + [
        {"element": 120 + i, "position": 12 + i, "multiplier": 0,
         "is_captain": False, "is_vice_captain": False}
        for i in range(4)
    ],
}


def _event(
    team_id: str | None = str(TEAM_ID),
    gw: str | None = str(GW),
) -> dict:
    if team_id is None and gw is None:
        return {"pathParameters": None}
    params: dict[str, str] = {}
    if team_id is not None:
        params["teamId"] = team_id
    if gw is not None:
        params["gw"] = gw
    return {"pathParameters": params}


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def patch_fetch():
    with patch.object(handler, "_fetch_picks") as m:
        yield m


@pytest.fixture
def frozen_time():
    with patch.object(handler.time, "time", return_value=1_000_000.0):
        yield 1_000_000.0


def _cached_item(expires_at: float, schema_version: int = SCHEMA_VERSION) -> dict:
    # Mirror what boto3's DynamoDB resource actually returns: every number
    # comes back as decimal.Decimal. Keeping the mock realistic is what
    # exercises the freshness + JSON-serialization paths end-to-end.
    data = {
        "active_chip": RAW_PICKS["active_chip"],
        "picks": RAW_PICKS["picks"],
        "entry_history": RAW_PICKS["entry_history"],
    }
    return _as_ddb({
        "pk": f"entry#{TEAM_ID}#gw#{GW}",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": int(expires_at) - 100,
        "expires_at": expires_at,
        "ttl": int(expires_at),
        "data": data,
    })


# ---- Miss -> fetch + cache ---------------------------------------------------


def test_miss_fetches_and_caches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_PICKS

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["cache"] == "miss"
    assert body["schema_version"] == SCHEMA_VERSION

    entry = body["entry"]
    assert entry["team_id"] == TEAM_ID
    assert entry["gameweek"] == GW
    assert entry["points"] == 65
    assert entry["total_points"] == 1850
    assert entry["bank"] == 5
    assert entry["value"] == 1010
    assert entry["event_transfers"] == 1
    assert entry["event_transfers_cost"] == 0
    assert entry["points_on_bench"] == 12
    assert entry["active_chip"] is None
    assert entry["captain"] == 100  # i==0 of the 11 starters
    assert entry["vice_captain"] == 101  # i==1
    assert len(entry["squad"]) == 15

    patch_fetch.assert_called_once_with(patch_fetch.call_args.args[0], TEAM_ID, GW)
    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["pk"] == f"entry#{TEAM_ID}#gw#{GW}"
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
    entry = body["entry"]
    assert entry["team_id"] == TEAM_ID
    assert entry["gameweek"] == GW
    # Captain / vice are computed from the squad even on the hit path.
    assert entry["captain"] == 100
    assert entry["vice_captain"] == 101
    # Proves the response was JSON-serialized successfully despite the
    # Decimal-wrapped mock — that would raise TypeError without _json_default.
    assert entry["points"] == 65
    assert len(entry["squad"]) == 15
    patch_fetch.assert_not_called()
    mock_table.put_item.assert_not_called()


# ---- Hit (expired) -> refetch ------------------------------------------------


def test_hit_expired_refetches(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {
        "Item": _cached_item(expires_at=frozen_time - 1),
    }
    patch_fetch.return_value = RAW_PICKS

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
    patch_fetch.return_value = RAW_PICKS

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    patch_fetch.assert_called_once()
    mock_table.put_item.assert_called_once()


# ---- FPL 404 -----------------------------------------------------------------


def test_404_from_fpl_returns_404(mock_table, patch_fetch, frozen_time):
    mock_table.get_item.return_value = {}
    patch_fetch.side_effect = handler.PicksNotFound(TEAM_ID, GW)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 404
    body = json.loads(result["body"])
    assert body["error"] == "picks not found"
    assert body["team_id"] == TEAM_ID
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


@pytest.mark.parametrize(
    "team,gw",
    [
        (None, str(GW)),          # team_id missing
        (str(TEAM_ID), None),     # gw missing
        ("", str(GW)),
        ("abc", str(GW)),
        ("-3", str(GW)),
        ("0", str(GW)),
        ("12.5", str(GW)),
        (str(TEAM_ID), "abc"),
        (str(TEAM_ID), "-1"),
        (str(TEAM_ID), "0"),
        (str(TEAM_ID), "12.5"),
    ],
)
def test_invalid_path_params_return_400(mock_table, patch_fetch, team, gw):
    result = lambda_handler(_event(team_id=team, gw=gw), None)

    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "invalid path" in body["error"]
    mock_table.get_item.assert_not_called()
    patch_fetch.assert_not_called()


def test_missing_path_parameters_returns_400(mock_table, patch_fetch):
    result = lambda_handler({"pathParameters": None}, None)
    assert result["statusCode"] == 400
    patch_fetch.assert_not_called()


# ---- Env-var TTL -------------------------------------------------------------


def test_env_var_ttl_is_respected(mock_table, patch_fetch, frozen_time, monkeypatch):
    monkeypatch.setenv("PICKS_TTL_SECONDS", "60")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_PICKS

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + 60


def test_invalid_env_var_falls_back_to_default(
    mock_table, patch_fetch, frozen_time, monkeypatch,
):
    monkeypatch.setenv("PICKS_TTL_SECONDS", "not-a-number")
    mock_table.get_item.return_value = {}
    patch_fetch.return_value = RAW_PICKS

    lambda_handler(_event(), None)

    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["expires_at"] == int(frozen_time) + handler.DEFAULT_TTL_SECONDS


# ---- No captain / no vice (defensive) ---------------------------------------


def test_squad_with_no_captain_flag_returns_null_captain(
    mock_table, patch_fetch, frozen_time,
):
    mock_table.get_item.return_value = {}
    raw = {
        **RAW_PICKS,
        "picks": [
            {**p, "is_captain": False, "is_vice_captain": False}
            for p in RAW_PICKS["picks"]
        ],
    }
    patch_fetch.return_value = raw

    result = lambda_handler(_event(), None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 200
    assert body["entry"]["captain"] is None
    assert body["entry"]["vice_captain"] is None
