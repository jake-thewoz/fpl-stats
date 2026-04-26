from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402


# ---------------------------------------------------------------------------
# Hand-built fixture dataset: 2 teams, 3 players, 1 upcoming GW.
# Saka (101, team 1, status=a), Odegaard (102, team 1, status=d cop=50),
# Palmer (201, team 2, status=a). All midfielders (position 3).
# Form scores below: Saka 6.0, Odegaard 4.0, Palmer 8.0
# ---------------------------------------------------------------------------

BOOTSTRAP_DATA = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3, "strength": 4},
        {"id": 2, "name": "Chelsea", "short_name": "CHE", "code": 8, "strength": 3},
    ],
    "positions": [
        {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
    ],
    "players": [
        {
            "id": 101, "first_name": "Bukayo", "second_name": "Saka",
            "web_name": "Saka", "team": 1, "element_type": 3,
            "total_points": 200, "form": "6.5", "now_cost": 95,
            "status": "a", "chance_of_playing_next_round": None,
        },
        {
            "id": 102, "first_name": "Martin", "second_name": "Odegaard",
            "web_name": "Odegaard", "team": 1, "element_type": 3,
            "total_points": 150, "form": "4.5", "now_cost": 85,
            "status": "d", "chance_of_playing_next_round": 50,
        },
        {
            "id": 201, "first_name": "Cole", "second_name": "Palmer",
            "web_name": "Palmer", "team": 2, "element_type": 3,
            "total_points": 180, "form": "5.5", "now_cost": 105,
            "status": "a", "chance_of_playing_next_round": None,
        },
    ],
    "gameweeks": [
        {
            "id": 32, "name": "Gameweek 32",
            "deadline_time": "2026-04-15T10:00:00Z",
            "is_current": True, "is_next": False, "finished": True,
        },
        {
            "id": 33, "name": "Gameweek 33",
            "deadline_time": "2026-04-22T10:00:00Z",
            "is_current": False, "is_next": True, "finished": False,
        },
    ],
}

# GW33 fixtures: Arsenal hosts Chelsea (team 1 home, diff 3; team 2 away, diff 4).
FIXTURES_DATA = [
    {
        "id": 301, "event": 33, "kickoff_time": "2026-04-24T17:30:00Z",
        "team_h": 1, "team_a": 2, "finished": False, "started": False,
        "team_h_difficulty": 3, "team_a_difficulty": 4,
    },
]

PLAYER_FORM_ROWS = [
    {"pk": "analytics#player_form", "sk": "101", "form_score": Decimal("6.0")},
    {"pk": "analytics#player_form", "sk": "102", "form_score": Decimal("4.0")},
    {"pk": "analytics#player_form", "sk": "201", "form_score": Decimal("8.0")},
]


def _ddb_get_item(key):
    pk, sk = key["pk"], key["sk"]
    if (pk, sk) == ("fpl#bootstrap", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": BOOTSTRAP_DATA}}
    if (pk, sk) == ("fpl#fixtures", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": FIXTURES_DATA}}
    return {}


def _ddb_query(form_rows):
    """Return a callable that mimics table.query for analytics#player_form."""
    def _query(**kwargs):
        return {"Items": form_rows}
    return _query


@pytest.fixture
def mock_table():
    table = MagicMock()
    table.get_item.side_effect = lambda Key: _ddb_get_item(Key)
    table.query.side_effect = _ddb_query(PLAYER_FORM_ROWS)

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def test_happy_path_ranking_and_math(mock_table):
    """Three candidates -> one ranked DDB put_item.

    Math, spelled out so a weighting tweak surfaces here:
      Saka:     6.0 * 0.6 * 1.0 * 1 = 3.6  -> captain_ev 7.2
      Palmer:   8.0 * 0.4 * 1.0 * 1 = 3.2  -> captain_ev 6.4
      Odegaard: 4.0 * 0.6 * 0.5 * 1 = 1.2  -> captain_ev 2.4
    """
    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["gameweek"] == 33
    assert result["candidates_scored"] == 3
    assert result["ranked_size"] == 3

    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs["Item"]
    assert item["pk"] == "analytics#captain_ev"
    assert item["sk"] == "33"
    assert item["gameweek"] == 33

    ranked = item["ranked"]
    assert [r["player_id"] for r in ranked] == [101, 201, 102]

    by_id = {r["player_id"]: r for r in ranked}
    assert by_id[101]["captain_ev"] == Decimal("7.2")
    assert by_id[101]["expected_points"] == Decimal("3.6")
    assert by_id[101]["components"]["form_score"] == Decimal("6")
    assert by_id[101]["components"]["fixture_easiness"] == Decimal("0.6")
    assert by_id[101]["components"]["minutes_prob"] == Decimal("1")
    assert by_id[101]["components"]["num_fixtures"] == 1

    assert by_id[201]["captain_ev"] == Decimal("6.4")
    assert by_id[201]["expected_points"] == Decimal("3.2")
    assert by_id[201]["components"]["fixture_easiness"] == Decimal("0.4")

    assert by_id[102]["captain_ev"] == Decimal("2.4")
    assert by_id[102]["components"]["minutes_prob"] == Decimal("0.5")


def test_skips_when_match_live(mock_table):
    with patch("handler.get_match_window") as gmw:
        gmw.return_value.is_live = True
        gmw.return_value.next_kickoff = None
        result = lambda_handler({}, None)

    assert result == {"ok": True, "skipped": "match_live"}
    mock_table.put_item.assert_not_called()


def test_missing_bootstrap_raises(mock_table):
    """Bootstrap missing — handler raises before any compute or write."""
    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": []}}
        return {}

    mock_table.get_item.side_effect = get_item

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)
    mock_table.put_item.assert_not_called()


def test_missing_player_form_rows_raises(mock_table):
    """Captain EV is downstream of the form analyzer — if there's no form
    data, fail loudly rather than write a zero-filled list."""
    mock_table.query.side_effect = _ddb_query([])

    with pytest.raises(RuntimeError, match="analytics#player_form"):
        lambda_handler({}, None)
    mock_table.put_item.assert_not_called()


def test_no_upcoming_gameweek_is_noop(mock_table):
    """Season's over: every gameweek finished, nothing to score."""
    finished_bootstrap = {**BOOTSTRAP_DATA}
    finished_bootstrap["gameweeks"] = [
        {**gw, "is_next": False, "finished": True}
        for gw in BOOTSTRAP_DATA["gameweeks"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": finished_bootstrap}}
        return _ddb_get_item(Key)

    mock_table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result == {"ok": True, "skipped": "no_upcoming_gameweek"}
    mock_table.put_item.assert_not_called()


def test_blank_gameweek_excludes_team(mock_table):
    """Team 1 has a fixture in GW33; team 2 doesn't (blank). Only team 1's
    players should appear in the ranked list."""
    arsenal_only_fixtures = [
        {
            "id": 301, "event": 33, "kickoff_time": "2026-04-24T17:30:00Z",
            "team_h": 1, "team_a": 99, "finished": False, "started": False,
            "team_h_difficulty": 3, "team_a_difficulty": 4,
        },
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": arsenal_only_fixtures}}
        return _ddb_get_item(Key)

    mock_table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result["candidates_scored"] == 2  # Saka + Odegaard, no Palmer

    ranked = mock_table.put_item.call_args.kwargs["Item"]["ranked"]
    assert {r["player_id"] for r in ranked} == {101, 102}


def test_double_gameweek_doubles_expected_points(mock_table):
    """Team 2 has two fixtures in GW33 (DGW). Palmer's EV should reflect
    num_fixtures=2 — same form/easiness/mins, but doubled."""
    dgw_fixtures = [
        {
            "id": 301, "event": 33, "kickoff_time": "2026-04-24T17:30:00Z",
            "team_h": 1, "team_a": 2, "finished": False, "started": False,
            "team_h_difficulty": 3, "team_a_difficulty": 4,
        },
        {
            "id": 302, "event": 33, "kickoff_time": "2026-04-26T15:00:00Z",
            "team_h": 2, "team_a": 99, "finished": False, "started": False,
            "team_h_difficulty": 4, "team_a_difficulty": 5,
        },
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": dgw_fixtures}}
        return _ddb_get_item(Key)

    mock_table.get_item.side_effect = get_item

    lambda_handler({}, None)
    ranked = mock_table.put_item.call_args.kwargs["Item"]["ranked"]
    palmer = next(r for r in ranked if r["player_id"] == 201)
    # Two fixtures averaged: away diff 4 (easiness 0.4), home diff 4 (easiness 0.4) -> avg 0.4
    # ep = 8.0 * 0.4 * 1.0 * 2 = 6.4 ; captain_ev = 12.8
    assert palmer["components"]["num_fixtures"] == 2
    assert palmer["expected_points"] == Decimal("6.4")
    assert palmer["captain_ev"] == Decimal("12.8")
