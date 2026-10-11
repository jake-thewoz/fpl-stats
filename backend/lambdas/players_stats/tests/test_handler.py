from __future__ import annotations

import base64
import gzip
import json
import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import PLAYER_STATS_KEY, lambda_handler  # noqa: E402
from schemas import (  # noqa: E402
    PLAYER_STATS_FIELDS,
    PLAYER_STATS_SCHEMA_VERSION,
    PlayerStats,
    player_stats_columns,
)

FETCHED_AT = "2026-10-11T00:00:00+00:00"

# Raw /bootstrap-static/ element shapes: numeric strings, JSON floats and a
# 0.1m-unit price change, as ingest receives them.
ELEMENTS_RAW = [
    {"id": 411, "event_points": 6, "saves": 0, "transfers_in": 1064367,
     "expected_goal_involvements": "5.12", "influence": "184.2",
     "expected_goals_per_90": 0.78, "cost_change_start": -3},
    {"id": 1, "event_points": 3, "saves": 13, "transfers_in": 1200441,
     "expected_goal_involvements": "0.01", "influence": "104.6",
     "expected_goals_per_90": 0.0, "cost_change_start": 1},
]


def _as_dynamodb(value: object) -> object:
    """What boto3 hands back: every number a Decimal."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _as_dynamodb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_as_dynamodb(v) for v in value]
    return value


def _stats_item(schema_version: int = PLAYER_STATS_SCHEMA_VERSION) -> dict:
    players = [PlayerStats.model_validate(e) for e in ELEMENTS_RAW]
    return _as_dynamodb({
        "pk": "fpl#player_stats",
        "sk": "latest",
        "schema_version": schema_version,
        "fetched_at": FETCHED_AT,
        "data": player_stats_columns(players),
    })


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _wire(table: MagicMock, item: dict | None) -> None:
    def side_effect(*, Key: dict):
        assert Key == PLAYER_STATS_KEY
        return {"Item": item} if item is not None else {}
    table.get_item.side_effect = side_effect


def _event(accept_encoding: str | None = None) -> dict:
    headers = {} if accept_encoding is None else {"accept-encoding": accept_encoding}
    return {"headers": headers}


def test_returns_columnar_stats_as_plain_json(mock_table):
    _wire(mock_table, _stats_item())

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 200
    assert "content-encoding" not in result["headers"]
    assert not result.get("isBase64Encoded")
    body = json.loads(result["body"])
    assert body["schema_version"] == PLAYER_STATS_SCHEMA_VERSION
    assert body["fetched_at"] == FETCHED_AT
    assert body["count"] == 2
    assert body["ids"] == [411, 1]
    assert set(body["stats"]) == set(PLAYER_STATS_FIELDS)


def test_decimals_become_ints_and_floats(mock_table):
    _wire(mock_table, _stats_item())

    stats = json.loads(lambda_handler(_event(), None)["body"])["stats"]

    assert stats["saves"] == [0, 13]
    assert all(isinstance(v, int) for v in stats["transfers_in"])
    assert stats["expected_goal_involvements"] == [5.12, 0.01]
    assert stats["influence"] == [184.2, 104.6]
    assert stats["expected_goals_per_90"] == [0.78, 0.0]
    assert stats["cost_change_start"] == [-0.3, 0.1]
    assert stats["red_cards"] == [None, None]


def test_gzips_when_client_accepts_it(mock_table):
    _wire(mock_table, _stats_item())
    plain = json.loads(lambda_handler(_event(), None)["body"])

    result = lambda_handler(_event("gzip, deflate, br"), None)

    assert result["statusCode"] == 200
    assert result["isBase64Encoded"] is True
    assert result["headers"]["content-encoding"] == "gzip"
    decoded = gzip.decompress(base64.b64decode(result["body"]))
    assert json.loads(decoded) == plain


def test_no_gzip_for_other_encodings(mock_table):
    _wire(mock_table, _stats_item())

    result = lambda_handler(_event("br"), None)

    assert "content-encoding" not in result["headers"]
    assert json.loads(result["body"])["count"] == 2


def test_missing_headers_serve_plain_json(mock_table):
    _wire(mock_table, _stats_item())

    result = lambda_handler({}, None)

    assert result["statusCode"] == 200
    assert json.loads(result["body"])["count"] == 2


def test_missing_item_is_503(mock_table):
    _wire(mock_table, None)

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 503
    assert json.loads(result["body"]) == {"error": "cache not ready"}


def test_schema_mismatch_is_503(mock_table):
    stale_version = PLAYER_STATS_SCHEMA_VERSION + 1
    _wire(mock_table, _stats_item(schema_version=stale_version))

    result = lambda_handler(_event(), None)

    assert result["statusCode"] == 503
    body = json.loads(result["body"])
    assert body["error"] == "schema version mismatch"
    assert body["expected"] == PLAYER_STATS_SCHEMA_VERSION
    assert body["stored"] == stale_version
