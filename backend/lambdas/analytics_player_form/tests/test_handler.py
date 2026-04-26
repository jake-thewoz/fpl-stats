from __future__ import annotations

import json
import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402


# Sample form row matching what the analyzer writes (Decimals because
# DDB resource API returns them that way).
HAALAND_FORM_ROW = {
    "pk": "analytics#player_form",
    "sk": "308",
    "schema_version": 1,
    "computed_at": "2026-04-26T04:00:00+00:00",
    "player_id": 308,
    "web_name": "Haaland",
    "team_id": 13,
    "position_id": 4,
    "form_score": Decimal("8.6667"),
    "recent_points": [12, 8, 6],
    "recent_gameweeks": [30, 31, 32],
    "sample_size": 3,
    "next_fixtures": [
        {"gw": 33, "opponent_team_id": 5, "home": True, "difficulty": 2},
    ],
    "avg_upcoming_difficulty": Decimal("2"),
}


@pytest.fixture
def mock_table():
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _event(player_id: str) -> dict:
    return {"pathParameters": {"id": player_id}}


def _body(response: dict) -> dict:
    return json.loads(response["body"])


def test_happy_path_returns_row(mock_table):
    mock_table.get_item.return_value = {"Item": HAALAND_FORM_ROW}
    response = lambda_handler(_event("308"), None)
    assert response["statusCode"] == 200

    body = _body(response)
    assert body["player_id"] == 308
    assert body["web_name"] == "Haaland"
    assert body["form_score"] == 8.6667
    assert body["sample_size"] == 3
    assert body["recent_gameweeks"] == [30, 31, 32]


def test_strips_internal_pk_sk_from_response(mock_table):
    """Consumers shouldn't see DDB internal keys — they're an
    implementation detail of our storage layer."""
    mock_table.get_item.return_value = {"Item": HAALAND_FORM_ROW}
    body = _body(lambda_handler(_event("308"), None))
    assert "pk" not in body
    assert "sk" not in body


def test_keeps_schema_version_and_computed_at(mock_table):
    """Both fields are useful for debugging stale data on the client."""
    mock_table.get_item.return_value = {"Item": HAALAND_FORM_ROW}
    body = _body(lambda_handler(_event("308"), None))
    assert body["schema_version"] == 1
    assert body["computed_at"] == "2026-04-26T04:00:00+00:00"


def test_decimal_xp_serialised_as_float(mock_table):
    """form_score is a Decimal in DDB; must round-trip as a float
    in the JSON body, not a string or stringified Decimal."""
    mock_table.get_item.return_value = {"Item": HAALAND_FORM_ROW}
    body = _body(lambda_handler(_event("308"), None))
    assert isinstance(body["form_score"], float)


def test_decimal_whole_number_serialised_as_int(mock_table):
    """avg_upcoming_difficulty is Decimal('2') — should serialise as 2,
    not 2.0, so it matches the typical numeric shape on the client."""
    mock_table.get_item.return_value = {"Item": HAALAND_FORM_ROW}
    body = _body(lambda_handler(_event("308"), None))
    assert body["avg_upcoming_difficulty"] == 2
    assert isinstance(body["avg_upcoming_difficulty"], int)


def test_missing_row_returns_404(mock_table):
    mock_table.get_item.return_value = {}  # no 'Item' key
    response = lambda_handler(_event("999"), None)
    assert response["statusCode"] == 404
    body = _body(response)
    assert body["error"] == "player_form not found"
    assert body["player_id"] == 999


def test_invalid_id_returns_400(mock_table):
    response = lambda_handler(_event("abc"), None)
    assert response["statusCode"] == 400
    assert _body(response)["error"] == "invalid player id"


def test_negative_id_returns_400(mock_table):
    """isdigit() rejects leading minus, so -5 fails the parse before
    reaching DDB. Belt-and-braces test in case the parse is loosened."""
    response = lambda_handler(_event("-5"), None)
    assert response["statusCode"] == 400


def test_zero_id_returns_400(mock_table):
    """Player IDs are 1-indexed in FPL; 0 is invalid."""
    response = lambda_handler(_event("0"), None)
    assert response["statusCode"] == 400


def test_missing_path_param_returns_400(mock_table):
    response = lambda_handler({"pathParameters": None}, None)
    assert response["statusCode"] == 400
