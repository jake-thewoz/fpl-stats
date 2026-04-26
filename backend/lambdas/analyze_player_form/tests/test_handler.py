from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
import responses

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import FPL_BASE_URL, lambda_handler  # noqa: E402


# ---------------------------------------------------------------------------
# Hand-built fixture dataset: 2 teams, 3 players, 3 finished GWs, 2 upcoming
# fixtures. Small enough to walk through by hand when debugging a failure.
# ---------------------------------------------------------------------------

BOOTSTRAP_DATA = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3, "strength": 4},
        {"id": 2, "name": "Chelsea", "short_name": "CHE", "code": 8, "strength": 3},
    ],
    "positions": [
        {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
        {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
    ],
    "players": [
        {
            "id": 101, "first_name": "Bukayo", "second_name": "Saka",
            "web_name": "Saka", "team": 1, "element_type": 3,
            "total_points": 200, "form": "6.5", "now_cost": 95,
        },
        {
            "id": 102, "first_name": "Martin", "second_name": "Odegaard",
            "web_name": "Odegaard", "team": 1, "element_type": 3,
            "total_points": 150, "form": "4.5", "now_cost": 85,
        },
        {
            "id": 201, "first_name": "Cole", "second_name": "Palmer",
            "web_name": "Palmer", "team": 2, "element_type": 3,
            "total_points": 180, "form": "5.5", "now_cost": 105,
        },
    ],
    "gameweeks": [
        {
            "id": 30, "name": "Gameweek 30",
            "deadline_time": "2026-04-01T10:00:00Z",
            "is_current": False, "is_next": False, "finished": True,
        },
        {
            "id": 31, "name": "Gameweek 31",
            "deadline_time": "2026-04-08T10:00:00Z",
            "is_current": False, "is_next": False, "finished": True,
        },
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

FIXTURES_DATA = [
    # Fully-populated upcoming fixtures with difficulty — the post-first-ingest shape.
    {
        "id": 301, "event": 33, "kickoff_time": "2026-04-24T17:30:00Z",
        "team_h": 1, "team_a": 2, "finished": False, "started": False,
        "team_h_difficulty": 3, "team_a_difficulty": 4,
    },
    {
        "id": 302, "event": 33, "kickoff_time": "2026-04-24T20:00:00Z",
        "team_h": 2, "team_a": 1, "finished": False, "started": False,
        "team_h_difficulty": 4, "team_a_difficulty": 3,
    },
]

# One completed fixture per recent GW, used only to flesh out the dataset;
# the analyzer pulls points from /event/{gw}/live/, not from here.
FINISHED_FIXTURES = [
    {
        "id": 201 + i, "event": 30 + i, "kickoff_time": f"2026-04-0{i+1}T15:00:00Z",
        "team_h": 1, "team_a": 2, "finished": True, "started": True,
        "team_h_difficulty": 3, "team_a_difficulty": 4,
    }
    for i in range(3)
]


def _gw_live_payload(points_by_player: dict[int, int]) -> dict:
    return {
        "elements": [
            {"id": pid, "stats": {"total_points": pts, "minutes": 90}}
            for pid, pts in points_by_player.items()
        ]
    }


def _ddb_table_get_item(key):
    pk = key["pk"]
    sk = key["sk"]
    if (pk, sk) == ("fpl#bootstrap", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": BOOTSTRAP_DATA}}
    if (pk, sk) == ("fpl#fixtures", "latest"):
        return {
            "Item": {
                "pk": pk, "sk": sk,
                "data": FINISHED_FIXTURES + FIXTURES_DATA,
            }
        }
    return {}


@pytest.fixture
def mock_table():
    """Patch boto3.resource so the handler writes/reads a MagicMock DDB."""
    table = MagicMock()
    table.get_item.side_effect = lambda Key: _ddb_table_get_item(Key)

    # batch_writer() is used as a context manager returning a writer with
    # put_item — mirror that shape so we can count writes.
    writer = MagicMock()
    table.batch_writer.return_value.__enter__.return_value = writer
    table.batch_writer.return_value.__exit__.return_value = False

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table, writer


@pytest.fixture
def no_retry_session(monkeypatch):
    monkeypatch.setattr(handler, "_make_session", __import__("requests").Session)


def _register_gw_live_mocks():
    """Points per player per GW (GW id → {player_id: points}):
    GW 30: Saka 8, Odegaard 5, Palmer 10
    GW 31: Saka 4, Odegaard 2, Palmer 12
    GW 32: Saka 6, Odegaard 7, Palmer 3"""
    per_gw = {
        30: {101: 8, 102: 5, 201: 10},
        31: {101: 4, 102: 2, 201: 12},
        32: {101: 6, 102: 7, 201: 3},
    }
    for gw, points in per_gw.items():
        responses.get(
            f"{FPL_BASE_URL}/event/{gw}/live/",
            json=_gw_live_payload(points),
        )


@responses.activate
def test_happy_path_writes_one_record_per_player(mock_table, no_retry_session):
    """Three players × three finished GWs → three records written with
    correctly weighted form scores and upcoming fixture difficulties."""
    table, writer = mock_table
    _register_gw_live_mocks()

    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["players_scored"] == 3
    assert result["recent_gameweeks"] == [30, 31, 32]

    # 3 players → 3 batch_writer.put_item calls
    assert writer.put_item.call_count == 3
    items_by_player = {
        call.kwargs["Item"]["player_id"]: call.kwargs["Item"]
        for call in writer.put_item.call_args_list
    }
    assert set(items_by_player) == {101, 102, 201}

    # ---- Saka (player 101, team 1): points [8, 4, 6], weights suffix [3,2,1] ----
    saka = items_by_player[101]
    assert saka["pk"] == "analytics#player_form"
    assert saka["sk"] == "101"
    assert saka["web_name"] == "Saka"
    assert saka["team_id"] == 1
    assert saka["position_id"] == 3
    assert saka["recent_points"] == [8, 4, 6]
    assert saka["recent_gameweeks"] == [30, 31, 32]
    assert saka["sample_size"] == 3
    # weighted form: (8*3 + 4*2 + 6*1) / 6 = (24+8+6)/6 = 38/6 = 6.333...
    assert saka["form_score"] == Decimal("6.3333")
    # Team 1's two upcoming fixtures: GW33 home vs team 2 (diff 3), GW33 away vs team 2 (diff 3)
    assert len(saka["next_fixtures"]) == 2
    assert saka["next_fixtures"][0] == {
        "gw": 33, "opponent_team_id": 2, "home": True, "difficulty": 3,
    }
    assert saka["next_fixtures"][1] == {
        "gw": 33, "opponent_team_id": 2, "home": False, "difficulty": 3,
    }
    assert saka["avg_upcoming_difficulty"] == Decimal("3")

    # ---- Palmer (player 201, team 2): points [10, 12, 3] ----
    palmer = items_by_player[201]
    assert palmer["sk"] == "201"
    assert palmer["team_id"] == 2
    assert palmer["recent_points"] == [10, 12, 3]
    # (10*3 + 12*2 + 3*1) / 6 = (30+24+3)/6 = 57/6 = 9.5
    assert palmer["form_score"] == Decimal("9.5")
    # Team 2's upcoming: GW33 away vs team 1 (diff 4), GW33 home vs team 1 (diff 4)
    assert palmer["avg_upcoming_difficulty"] == Decimal("4")


@responses.activate
def test_skips_when_match_live(mock_table, no_retry_session):
    """If match_window says live, do nothing: no FPL calls, no writes."""
    table, writer = mock_table
    # Put a live fixture into the fixtures cache so get_match_window returns is_live=True.
    live_fx = dict(FIXTURES_DATA[0])
    live_fx["kickoff_time"] = "2099-01-01T00:00:00Z"  # irrelevant — we override below

    with patch("handler.get_match_window") as gmw:
        gmw.return_value.is_live = True
        gmw.return_value.next_kickoff = None

        result = lambda_handler({}, None)

    assert result == {"ok": True, "skipped": "match_live"}
    writer.put_item.assert_not_called()
    # No FPL live calls were registered — responses would have raised if any were made.


@responses.activate
def test_missing_bootstrap_raises(mock_table, no_retry_session):
    """Fixtures cached (so match_window passes) but bootstrap missing —
    handler raises before any FPL call or write."""
    table, writer = mock_table

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            # Return empty fixtures so match_window reports not-live.
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": []}}
        # Everything else (bootstrap) misses.
        return {}

    table.get_item.side_effect = get_item

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)

    writer.put_item.assert_not_called()


@responses.activate
def test_no_finished_gameweeks_is_noop(mock_table, no_retry_session):
    """Pre-season: bootstrap has gameweeks but none finished. Analyzer
    returns cleanly without writes, without hitting FPL."""
    table, writer = mock_table
    empty_bootstrap = dict(BOOTSTRAP_DATA)
    empty_bootstrap["gameweeks"] = [
        dict(gw, finished=False) for gw in BOOTSTRAP_DATA["gameweeks"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": empty_bootstrap}}
        return _ddb_table_get_item(Key)

    table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result == {"ok": True, "skipped": "no_finished_gameweeks"}
    writer.put_item.assert_not_called()


@responses.activate
def test_graceful_when_fixtures_lack_difficulty(mock_table, no_retry_session):
    """First run after deploy: the cached fixtures predate the new
    difficulty fields, so every upcoming fixture's difficulty is None.
    The analyzer should still write records, with difficulty=null and
    avg_upcoming_difficulty=None."""
    table, writer = mock_table

    pre_deploy_fixtures = []
    for fx in FINISHED_FIXTURES + FIXTURES_DATA:
        stripped = {k: v for k, v in fx.items() if "difficulty" not in k}
        pre_deploy_fixtures.append(stripped)

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {
                "Item": {"pk": Key["pk"], "sk": Key["sk"], "data": pre_deploy_fixtures}
            }
        return _ddb_table_get_item(Key)

    table.get_item.side_effect = get_item
    _register_gw_live_mocks()

    result = lambda_handler({}, None)
    assert result["players_scored"] == 3

    for call in writer.put_item.call_args_list:
        item = call.kwargs["Item"]
        for fx in item["next_fixtures"]:
            assert fx["difficulty"] is None
        assert item["avg_upcoming_difficulty"] is None
