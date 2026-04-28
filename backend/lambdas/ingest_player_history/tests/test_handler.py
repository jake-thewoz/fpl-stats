from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests
import responses

# Boto-side env defaults so the handler imports cleanly under pytest.
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import FPL_BASE_URL, lambda_handler  # noqa: E402
from schemas import SCHEMA_VERSION  # noqa: E402

FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "element_summary_sample.json"
)


def _bootstrap_payload(player_ids: list[int]) -> dict:
    return {
        "teams": [
            {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3},
        ],
        "element_types": [
            {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
        ],
        "elements": [
            {
                "id": pid,
                "first_name": f"First{pid}",
                "second_name": f"Last{pid}",
                "web_name": f"Player{pid}",
                "team": 1,
                "element_type": 3,
                "total_points": 100,
                "form": "5.0",
                "now_cost": 80,
            }
            for pid in player_ids
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


@pytest.fixture
def sample_payload() -> dict:
    with FIXTURE_PATH.open() as f:
        return json.load(f)


@pytest.fixture
def mock_table():
    """boto3.resource → MagicMock; expose the batch_writer's put_item
    for assertion."""
    table = MagicMock()

    writer = MagicMock()
    table.batch_writer.return_value.__enter__.return_value = writer
    table.batch_writer.return_value.__exit__.return_value = False

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table, writer


@pytest.fixture
def stub_bootstrap(mock_table):
    """Wire the bootstrap row into mock_table.get_item by default. Tests
    that need 'bootstrap missing' override this via the
    ``empty_bootstrap`` fixture."""
    table, _writer = mock_table

    def _get_item(Key):
        if (Key.get("pk"), Key.get("sk")) == ("fpl#bootstrap", "latest"):
            return {
                "Item": {
                    "pk": "fpl#bootstrap",
                    "sk": "latest",
                    "data": _bootstrap_payload([1, 2]),
                }
            }
        return {}

    table.get_item.side_effect = _get_item
    return mock_table


@pytest.fixture
def fast_sleep(monkeypatch):
    """Strip the inter-call sleep so tests don't pay 50ms × N players."""
    monkeypatch.setattr(handler.time, "sleep", lambda *_args, **_kw: None)


@pytest.fixture
def no_retry_session(monkeypatch):
    """Make HTTP error tests fast — strip the retry adapter."""
    monkeypatch.setattr(handler, "make_fpl_session", requests.Session)


@responses.activate
def test_happy_path_writes_history_and_season_rows(
    stub_bootstrap, fast_sleep, sample_payload
):
    """Two players, each returning the real-shape fixture: every history
    row → one DDB put, every season summary → one DDB put."""
    _table, writer = stub_bootstrap

    for pid in (1, 2):
        responses.get(
            f"{FPL_BASE_URL}/element-summary/{pid}/", json=sample_payload
        )

    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["schema_version"] == SCHEMA_VERSION
    assert result["counts"]["players_attempted"] == 2
    assert result["counts"]["players_succeeded"] == 2
    assert result["counts"]["errors"] == 0
    # Fixture has 7 history rows + 2 history_past rows per player → 18 puts.
    assert result["counts"]["history_rows"] == 14
    assert result["counts"]["season_summary_rows"] == 4
    assert writer.put_item.call_count == 18

    items = [call.kwargs["Item"] for call in writer.put_item.call_args_list]
    pks = {item["pk"] for item in items}
    assert pks == {"fpl#player_history#1", "fpl#player_history#2"}

    # Spot-check shapes: every item carries schema_version + fetched_at +
    # data, and the sk encodes either gw#NNN#fixture#X or season_summary#YYYY/YY.
    for item in items:
        assert item["schema_version"] == SCHEMA_VERSION
        assert item["fetched_at"] == result["fetched_at"]
        assert "data" in item
        assert item["sk"].startswith("gw#") or item["sk"].startswith(
            "season_summary#"
        )


@responses.activate
def test_dgw_writes_two_distinct_rows_for_same_round(
    stub_bootstrap, fast_sleep, sample_payload
):
    """The fixture includes round 22 with two fixtures (synthetic DGW).
    Both must persist as distinct DDB items, never overwriting each
    other under one shared sk."""
    _table, writer = stub_bootstrap
    responses.get(f"{FPL_BASE_URL}/element-summary/1/", json=sample_payload)
    responses.get(f"{FPL_BASE_URL}/element-summary/2/", json=sample_payload)

    lambda_handler({}, None)

    sks_for_round_22 = {
        call.kwargs["Item"]["sk"]
        for call in writer.put_item.call_args_list
        if call.kwargs["Item"]["pk"] == "fpl#player_history#1"
        and call.kwargs["Item"]["sk"].startswith("gw#022#")
    }
    assert len(sks_for_round_22) == 2
    assert all("fixture#" in sk for sk in sks_for_round_22)


@responses.activate
def test_history_row_data_round_trips_underlying_stats(
    stub_bootstrap, fast_sleep, sample_payload
):
    """xG/xA/xGI/xGC are the v2 inputs — assert they survive the
    parse → serialize → DDB-item path on a real-shape row."""
    _table, writer = stub_bootstrap
    responses.get(f"{FPL_BASE_URL}/element-summary/1/", json=sample_payload)
    responses.get(f"{FPL_BASE_URL}/element-summary/2/", json=sample_payload)

    lambda_handler({}, None)

    # Pick the round-3 fixture (the one where the player scored)
    rd3 = next(
        call.kwargs["Item"]
        for call in writer.put_item.call_args_list
        if call.kwargs["Item"]["pk"] == "fpl#player_history#1"
        and call.kwargs["Item"]["sk"].startswith("gw#003#")
    )
    data = rd3["data"]
    assert data["goals_scored"] == 1
    assert data["expected_goals"] is not None
    assert data["expected_assists"] is not None
    assert data["defensive_contribution"] is not None


@responses.activate
def test_per_player_failure_logged_and_continues(
    mock_table, fast_sleep, no_retry_session, sample_payload
):
    """One player returning 500 should not abort the whole run — we
    fall through, count the error, and finish the rest. Uses 12 players
    so 1 failure (8.3%) stays under MAX_ERROR_FRACTION (10%) — a more
    realistic 700-player ingest sees rare per-player blips, not 50%
    failure rates."""
    table, writer = mock_table
    table.get_item.return_value = {
        "Item": {
            "pk": "fpl#bootstrap",
            "sk": "latest",
            "data": _bootstrap_payload(list(range(1, 13))),
        }
    }
    for pid in range(1, 13):
        if pid == 2:
            responses.get(
                f"{FPL_BASE_URL}/element-summary/{pid}/", status=500
            )
        else:
            responses.get(
                f"{FPL_BASE_URL}/element-summary/{pid}/", json=sample_payload
            )

    result = lambda_handler({}, None)

    assert result["counts"]["players_attempted"] == 12
    assert result["counts"]["players_succeeded"] == 11
    assert result["counts"]["errors"] == 1
    assert result["failed_ids"] == [2]
    # The failed player's writes did not land; every other player's did.
    pks = {call.kwargs["Item"]["pk"] for call in writer.put_item.call_args_list}
    assert "fpl#player_history#2" not in pks
    assert len(pks) == 11


@responses.activate
def test_too_many_errors_raises(stub_bootstrap, fast_sleep, no_retry_session):
    """100% of players failing trips MAX_ERROR_FRACTION and raises so
    the CW alarm fires."""
    responses.get(f"{FPL_BASE_URL}/element-summary/1/", status=500)
    responses.get(f"{FPL_BASE_URL}/element-summary/2/", status=500)

    with pytest.raises(RuntimeError, match="Too many ingestion errors"):
        lambda_handler({}, None)


def test_bootstrap_missing_raises(mock_table, fast_sleep):
    """If ingest_fpl hasn't run, fail loudly — there's nothing to iterate."""
    table, _writer = mock_table
    table.get_item.return_value = {}  # no Item key → bootstrap missing

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)
