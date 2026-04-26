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
    """Patch boto3.resource so the handler writes/reads a MagicMock DDB.

    batch_writer() is a context manager returning a writer with put_item;
    mirror that shape so we can count and inspect writes per player.
    """
    table = MagicMock()
    table.get_item.side_effect = lambda Key: _ddb_get_item(Key)
    table.query.side_effect = _ddb_query(PLAYER_FORM_ROWS)

    writer = MagicMock()
    table.batch_writer.return_value.__enter__.return_value = writer
    table.batch_writer.return_value.__exit__.return_value = False

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table, writer


def _items_by_player(writer):
    return {
        call.kwargs["Item"]["player_id"]: call.kwargs["Item"]
        for call in writer.put_item.call_args_list
    }


def test_happy_path_writes_one_record_per_player(mock_table):
    """Three players × one upcoming GW -> three per-player rows.

    Math, spelled out so a weighting tweak surfaces here:
      Saka:     6.0 * 0.6 * 1.0 * 1 = 3.6
      Palmer:   8.0 * 0.4 * 1.0 * 1 = 3.2
      Odegaard: 4.0 * 0.6 * 0.5 * 1 = 1.2
    """
    table, writer = mock_table
    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["gameweek"] == 33
    assert result["players_scored"] == 3

    assert writer.put_item.call_count == 3
    items = _items_by_player(writer)
    assert set(items) == {101, 102, 201}

    # ---- Saka (101): form=6.0, easiness=(6-3)/5=0.6, mins=1.0, nfx=1
    saka = items[101]
    assert saka["pk"] == "analytics#player_xp"
    assert saka["sk"] == "101"
    assert saka["web_name"] == "Saka"
    assert saka["team_id"] == 1
    assert saka["position_id"] == 3
    assert saka["gameweek"] == 33
    assert saka["xp"] == Decimal("3.6")
    assert saka["components"]["form_score"] == Decimal("6")
    assert saka["components"]["fixture_easiness"] == Decimal("0.6")
    assert saka["components"]["minutes_prob"] == Decimal("1")
    assert saka["components"]["num_fixtures"] == 1

    # ---- Palmer (201): form=8.0, easiness=(6-4)/5=0.4, mins=1.0, nfx=1
    palmer = items[201]
    assert palmer["xp"] == Decimal("3.2")
    assert palmer["components"]["fixture_easiness"] == Decimal("0.4")

    # ---- Odegaard (102): form=4.0, easiness=0.6, mins=0.5, nfx=1
    odegaard = items[102]
    assert odegaard["xp"] == Decimal("1.2")
    assert odegaard["components"]["minutes_prob"] == Decimal("0.5")


def test_skips_when_match_live(mock_table):
    table, writer = mock_table
    with patch("handler.get_match_window") as gmw:
        gmw.return_value.is_live = True
        gmw.return_value.next_kickoff = None
        result = lambda_handler({}, None)

    assert result == {"ok": True, "skipped": "match_live"}
    writer.put_item.assert_not_called()


def test_missing_bootstrap_raises(mock_table):
    """Bootstrap missing — handler raises before any compute or write."""
    table, writer = mock_table

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": []}}
        return {}

    table.get_item.side_effect = get_item

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)
    writer.put_item.assert_not_called()


def test_missing_player_form_rows_raises(mock_table):
    """Player xP is downstream of the form analyzer — if there's no form
    data, fail loudly rather than write zero-filled records."""
    table, writer = mock_table
    table.query.side_effect = _ddb_query([])

    with pytest.raises(RuntimeError, match="analytics#player_form"):
        lambda_handler({}, None)
    writer.put_item.assert_not_called()


def test_no_upcoming_gameweek_is_noop(mock_table):
    """Season's over: every gameweek finished, nothing to score."""
    table, writer = mock_table
    finished_bootstrap = {**BOOTSTRAP_DATA}
    finished_bootstrap["gameweeks"] = [
        {**gw, "is_next": False, "finished": True}
        for gw in BOOTSTRAP_DATA["gameweeks"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": finished_bootstrap}}
        return _ddb_get_item(Key)

    table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result == {"ok": True, "skipped": "no_upcoming_gameweek"}
    writer.put_item.assert_not_called()


def test_blank_gameweek_skips_team(mock_table):
    """Team 1 has a fixture in GW33; team 2 doesn't (blank). Only team 1's
    players should get xP rows — team 2's player is skipped, not written
    with xP=0 (those are different signals to a downstream reader)."""
    table, writer = mock_table
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

    table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result["players_scored"] == 2  # Saka + Odegaard, no Palmer

    items = _items_by_player(writer)
    assert set(items) == {101, 102}


def test_double_gameweek_doubles_expected_points(mock_table):
    """Team 2 has two fixtures in GW33 (DGW). Palmer's xP should reflect
    num_fixtures=2 — same form/easiness/mins, but doubled."""
    table, writer = mock_table
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

    table.get_item.side_effect = get_item

    lambda_handler({}, None)
    items = _items_by_player(writer)
    palmer = items[201]
    # Two fixtures: away diff 4 (easiness 0.4), home diff 4 (easiness 0.4) -> avg 0.4
    # xp = 8.0 * 0.4 * 1.0 * 2 = 6.4
    assert palmer["components"]["num_fixtures"] == 2
    assert palmer["xp"] == Decimal("6.4")
