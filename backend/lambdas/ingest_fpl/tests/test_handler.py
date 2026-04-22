from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
import requests
import responses

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import BOOTSTRAP_URL, FIXTURES_URL, lambda_handler  # noqa: E402


BOOTSTRAP_PAYLOAD = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3},
        {"id": 2, "name": "Aston Villa", "short_name": "AVL", "code": 7},
    ],
    "element_types": [
        {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
        {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
    ],
    "elements": [
        {
            "id": 1,
            "first_name": "Bukayo",
            "second_name": "Saka",
            "web_name": "Saka",
            "team": 1,
            "element_type": 3,
            "total_points": 120,
            "form": "5.2",
            "now_cost": 90,
        },
    ],
    "events": [
        {
            "id": 1,
            "name": "Gameweek 1",
            "deadline_time": "2025-08-15T17:30:00Z",
            "is_current": True,
            "is_next": False,
            "finished": False,
        }
    ],
}

FIXTURES_PAYLOAD = [
    {
        "id": 1,
        "event": 1,
        "kickoff_time": "2025-08-15T19:00:00Z",
        "team_h": 1,
        "team_a": 2,
        "team_h_score": None,
        "team_a_score": None,
        "finished": False,
        "started": False,
    }
]


@pytest.fixture
def mock_table():
    """Patch boto3.resource so the handler writes to a MagicMock instead of DDB."""
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def no_retry_session(monkeypatch):
    """Strip retries so error tests don't wait on exponential backoff."""
    monkeypatch.setattr(handler, "_make_session", requests.Session)


@responses.activate
def test_happy_path_writes_both_endpoints(mock_table):
    responses.get(BOOTSTRAP_URL, json=BOOTSTRAP_PAYLOAD)
    responses.get(FIXTURES_URL, json=FIXTURES_PAYLOAD)

    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["counts"] == {
        "teams": 2,
        "players": 1,
        "events": 1,
        "fixtures": 1,
    }
    assert mock_table.put_item.call_count == 2

    written_pks = {
        call.kwargs["Item"]["pk"] for call in mock_table.put_item.call_args_list
    }
    assert written_pks == {"fpl#bootstrap", "fpl#fixtures"}

    for call in mock_table.put_item.call_args_list:
        item = call.kwargs["Item"]
        assert item["sk"] == "latest"
        assert item["fetched_at"] == result["fetched_at"]


@responses.activate
def test_fpl_error_does_not_write(mock_table, no_retry_session):
    responses.get(BOOTSTRAP_URL, status=500)

    with pytest.raises(requests.HTTPError):
        lambda_handler({}, None)

    mock_table.put_item.assert_not_called()


@responses.activate
def test_partial_failure_does_not_write(mock_table, no_retry_session):
    """Second fetch fails → first fetch's data must not land in DDB alone."""
    responses.get(BOOTSTRAP_URL, json=BOOTSTRAP_PAYLOAD)
    responses.get(FIXTURES_URL, status=503)

    with pytest.raises(requests.HTTPError):
        lambda_handler({}, None)

    mock_table.put_item.assert_not_called()
