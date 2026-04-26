from __future__ import annotations

import json
import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402


def _xp_row(player_id, web_name, team, pos, xp):
    """Mirror what the player-xP analyzer writes — Decimals because DDB
    resource API returns them that way."""
    return {
        "pk": "analytics#player_xp",
        "sk": str(player_id),
        "schema_version": 1,
        "computed_at": "2026-04-26T04:30:00+00:00",
        "player_id": player_id,
        "web_name": web_name,
        "team_id": team,
        "position_id": pos,
        "gameweek": 33,
        "xp": Decimal(str(xp)),
        "components": {
            "form_score": Decimal("6.0"),
            "fixture_easiness": Decimal("0.6"),
            "minutes_prob": Decimal("1.0"),
            "num_fixtures": 1,
        },
    }


SAMPLE_ROWS = [
    _xp_row(308, "Haaland", 13, 4, "18.4"),
    _xp_row(427, "Bruno", 14, 3, "12.6"),
    _xp_row(201, "Palmer", 6, 3, "11.2"),
]


@pytest.fixture
def mock_table():
    table = MagicMock()
    table.query.return_value = {"Items": SAMPLE_ROWS}

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _body(response):
    return json.loads(response["body"])


def test_happy_path_returns_all_rows_slimmed(mock_table):
    response = lambda_handler({}, None)
    assert response["statusCode"] == 200
    body = _body(response)

    assert body["gameweek"] == 33
    assert body["schema_version"] == 1
    assert body["computed_at"] == "2026-04-26T04:30:00+00:00"
    assert len(body["players"]) == 3

    haaland = next(p for p in body["players"] if p["player_id"] == 308)
    assert haaland == {
        "player_id": 308, "web_name": "Haaland",
        "team_id": 13, "position_id": 4, "xp": 18.4,
    }


def test_drops_components_block(mock_table):
    """The slim list shape doesn't include the analyzer's debug
    components — those would roughly double the payload size for no
    list-view benefit."""
    body = _body(lambda_handler({}, None))
    for player in body["players"]:
        assert "components" not in player


def test_drops_internal_pk_sk(mock_table):
    body = _body(lambda_handler({}, None))
    for player in body["players"]:
        assert "pk" not in player
        assert "sk" not in player


def test_decimal_xp_serialised_as_float(mock_table):
    body = _body(lambda_handler({}, None))
    for player in body["players"]:
        assert isinstance(player["xp"], float)


def test_empty_table_returns_200_with_empty_list(mock_table):
    """No analyzer output yet (fresh deploy, pre-season). Endpoint
    should report empty cleanly, not 404 — the endpoint is reachable,
    the data just isn't ready."""
    mock_table.query.return_value = {"Items": []}
    response = lambda_handler({}, None)
    assert response["statusCode"] == 200
    body = _body(response)
    assert body["players"] == []
    assert body["gameweek"] is None
    assert body["computed_at"] is None


def test_pagination_aggregates_across_pages(mock_table):
    """Even though ~700 small rows fit in one page, the handler
    paginates for safety. Two-page response should be flattened."""
    page1 = SAMPLE_ROWS[:2]
    page2 = SAMPLE_ROWS[2:]
    mock_table.query.side_effect = [
        {"Items": page1, "LastEvaluatedKey": {"pk": "x", "sk": "y"}},
        {"Items": page2},
    ]

    body = _body(lambda_handler({}, None))
    assert len(body["players"]) == 3
    assert mock_table.query.call_count == 2
    # Second call must have ExclusiveStartKey forwarded from page 1.
    second_call_kwargs = mock_table.query.call_args_list[1].kwargs
    assert second_call_kwargs["ExclusiveStartKey"] == {"pk": "x", "sk": "y"}


def test_query_uses_player_xp_partition(mock_table):
    """Sanity: don't accidentally query analytics#player_form here."""
    lambda_handler({}, None)
    call_kwargs = mock_table.query.call_args.kwargs
    # KeyConditionExpression is a boto3 Condition object — its string
    # repr includes the partition value, easiest assertion form.
    assert "analytics#player_xp" in str(
        call_kwargs["KeyConditionExpression"].get_expression()
    )
