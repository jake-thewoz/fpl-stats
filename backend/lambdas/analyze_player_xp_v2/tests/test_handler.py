"""Integration tests for the v2 analyzer Lambda.

Mirrors the shape of analyze_player_xp's tests — MagicMock DDB,
batch_writer assertions, edge cases for blank/DGW/match-live —
adapted for the v2 input set (history rows scanned from
fpl#player_history#*) and the per-component output schema.
"""
from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402


# ---------------------------------------------------------------------------
# Hand-built fixture dataset: 2 teams, 3 players, GW32 finished, GW33 upcoming.
# Saka (101, MID, team 1, status=a), Odegaard (102, MID, team 1, status=d cop=50),
# Palmer (201, MID, team 2, status=a). Each has 5 prior GW history rows.
# ---------------------------------------------------------------------------

BOOTSTRAP_DATA = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3},
        {"id": 2, "name": "Chelsea", "short_name": "CHE", "code": 8},
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
        {
            "id": 34, "name": "Gameweek 34",
            "deadline_time": "2026-04-29T10:00:00Z",
            "is_current": False, "is_next": False, "finished": False,
        },
        {
            "id": 35, "name": "Gameweek 35",
            "deadline_time": "2026-05-06T10:00:00Z",
            "is_current": False, "is_next": False, "finished": False,
        },
        {
            "id": 36, "name": "Gameweek 36",
            "deadline_time": "2026-05-13T10:00:00Z",
            "is_current": False, "is_next": False, "finished": False,
        },
        {
            "id": 37, "name": "Gameweek 37",
            "deadline_time": "2026-05-20T10:00:00Z",
            "is_current": False, "is_next": False, "finished": False,
        },
    ],
}

# GW33-37: Arsenal vs Chelsea each gameweek (5 GWs covering MAX_HORIZON).
# All home/away alternates; difficulties stay 3/4 for predictability.
# Kickoff far in the past so the match-window guard never trips.
FIXTURES_DATA = [
    {
        "id": 300 + i, "event": gw,
        "kickoff_time": "2025-08-15T17:30:00Z",
        "team_h": 1 if i % 2 == 0 else 2,
        "team_a": 2 if i % 2 == 0 else 1,
        "finished": False, "started": False,
        "team_h_difficulty": 3,
        "team_a_difficulty": 4,
    }
    for i, gw in enumerate(range(33, 38))
]


def _history_row(*, player_id: int, opponent: int, was_home: bool,
                 round_: int, fixture_id: int,
                 minutes: int = 90, goals: int = 0, assists: int = 0,
                 bonus: int = 0, xg: str = "0.20", xa: str = "0.15",
                 xgc: str = "1.20", defcon: int = 8) -> dict:
    return {
        "element": player_id, "fixture": fixture_id,
        "opponent_team": opponent, "was_home": was_home, "round": round_,
        "minutes": minutes, "goals_scored": goals, "assists": assists,
        "clean_sheets": 0, "goals_conceded": 1, "saves": 0, "bonus": bonus,
        "bps": 25, "yellow_cards": 0, "red_cards": 0, "own_goals": 0,
        "penalties_saved": 0, "penalties_missed": 0, "total_points": 4,
        "expected_goals": xg, "expected_assists": xa,
        "expected_goals_conceded": xgc, "defensive_contribution": defcon,
    }


def _scan_items_for_player(player_id: int, *, opponent: int = 99) -> list[dict]:
    """Build 5 prior GW history rows wrapping each in the DDB row shape
    that `_scan_player_history` parses (pk/sk/data)."""
    items = []
    for r in range(27, 32):
        items.append({
            "pk": f"fpl#player_history#{player_id}",
            "sk": f"gw#{r:03d}#fixture#{r}",
            "data": _history_row(
                player_id=player_id, opponent=opponent, was_home=True,
                round_=r, fixture_id=r,
            ),
        })
    return items


def _ddb_get_item(key):
    pk, sk = key["pk"], key["sk"]
    if (pk, sk) == ("fpl#bootstrap", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": BOOTSTRAP_DATA}}
    if (pk, sk) == ("fpl#fixtures", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": FIXTURES_DATA}}
    return {}


def _build_history_scan_items(*, players: list[int] = (101, 102, 201)) -> list[dict]:
    items: list[dict] = []
    for pid in players:
        opponent = 2 if pid in (101, 102) else 1  # Arsenal vs Chelsea
        items.extend(_scan_items_for_player(pid, opponent=opponent))
    return items


def _ddb_scan(items: list[dict]):
    """Mimic table.scan paginated response — single page, no LastEvaluatedKey."""
    def _scan(**kwargs):
        return {"Items": items}
    return _scan


@pytest.fixture
def mock_table():
    """Patch boto3.resource so the handler reads/writes a MagicMock DDB.

    The scan_player_history helper paginates via LastEvaluatedKey, so
    we only need a single-page response when ``Items`` is the full set.
    """
    table = MagicMock()
    table.get_item.side_effect = lambda Key: _ddb_get_item(Key)
    table.scan.side_effect = _ddb_scan(_build_history_scan_items())

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


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_happy_path_writes_one_v2_row_per_player(mock_table) -> None:
    """3 players × 5-GW horizon → 3 v2 rows under analytics#player_xp_v2.

    Each row carries both the immediate-next-GW fields (xp, components,
    gameweek — used by the players-list xP column) and the multi-GW
    horizon (horizon_xp_by_gw, horizon_gw_ids — used by transfer
    suggestions to sum any user-requested horizon up to MAX_HORIZON).
    """
    _table, writer = mock_table
    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["gameweek"] == 33
    assert result["players_scored"] == 3
    assert result["model_version"] == handler.MODEL_VERSION
    assert result["skipped_blank"] == 0

    assert writer.put_item.call_count == 3
    items = _items_by_player(writer)
    assert set(items) == {101, 102, 201}

    # Output row shape — pk routes to v2 partition, leaving v1 untouched.
    saka = items[101]
    assert saka["pk"] == "analytics#player_xp_v2"
    assert saka["sk"] == "101"
    assert saka["model_version"] == handler.MODEL_VERSION
    assert saka["web_name"] == "Saka"
    assert saka["team_id"] == 1
    assert saka["position_id"] == 3
    assert saka["gameweek"] == 33

    # xp is a Decimal in real points units (not a 0-1 scale).
    assert isinstance(saka["xp"], Decimal)
    assert saka["xp"] > 0

    # components map carries the per-category breakdown.
    components = saka["components"]
    for required in (
        "minutes_prob", "p60", "appearance_xp", "goals_xp", "assists_xp",
        "cs_xp", "concede_xp", "saves_xp", "bonus_xp", "defcon_xp",
        "discipline_xp", "rates", "fixtures",
    ):
        assert required in components, f"missing {required}"

    # rates sub-map carries the inputs to the math.
    rates_map = components["rates"]
    assert "npxg_p90" in rates_map
    assert "team_xgc_p90" in rates_map

    # fixtures sub-map carries the per-fixture diagnostic.
    assert isinstance(components["fixtures"], list)
    assert len(components["fixtures"]) == 1
    fixture_meta = components["fixtures"][0]
    assert fixture_meta["opponent_team_id"] == 2
    assert fixture_meta["home"] is True
    assert fixture_meta["fpl_difficulty"] == 3


def test_writes_horizon_xp_by_gw(mock_table) -> None:
    """Each row carries horizon_xp_by_gw (one entry per upcoming GW
    within MAX_HORIZON) and horizon_gw_ids (the ordered list)."""
    _table, writer = mock_table
    lambda_handler({}, None)
    items = _items_by_player(writer)
    saka = items[101]

    # horizon_gw_ids is the explicit ordering — first entry is the
    # immediate-next GW (matches the row's `gameweek` field).
    assert saka["horizon_gw_ids"] == [33, 34, 35, 36, 37]
    assert saka["gameweek"] == saka["horizon_gw_ids"][0]

    # horizon_xp_by_gw is keyed by GW id as string (DDB Map keys must
    # be strings). One entry per horizon GW.
    horizon = saka["horizon_xp_by_gw"]
    assert set(horizon.keys()) == {"33", "34", "35", "36", "37"}
    for gw_str, xp in horizon.items():
        assert isinstance(xp, Decimal)
        assert xp >= 0  # blank GWs would yield 0; team plays every GW here

    # Single-GW xp matches horizon[upcoming_gw] — the players-list xP
    # column reads the top-level field, transfer suggestions reads the map.
    assert saka["xp"] == horizon[str(saka["gameweek"])]


def test_horizon_clamps_to_remaining_gameweeks(mock_table) -> None:
    """When the season has fewer GWs left than MAX_HORIZON, horizon_gw_ids
    naturally clamps. Same GW set drives the horizon_xp_by_gw map."""
    table, writer = mock_table
    # Bootstrap with only 2 unfinished GWs (33, 34) — fewer than MAX_HORIZON=5.
    bootstrap_short = {
        **BOOTSTRAP_DATA,
        "gameweeks": [
            {"id": 32, "name": "Gameweek 32",
             "deadline_time": "2026-04-15T10:00:00Z",
             "is_current": True, "is_next": False, "finished": True},
            {"id": 33, "name": "Gameweek 33",
             "deadline_time": "2026-04-22T10:00:00Z",
             "is_current": False, "is_next": True, "finished": False},
            {"id": 34, "name": "Gameweek 34",
             "deadline_time": "2026-04-29T10:00:00Z",
             "is_current": False, "is_next": False, "finished": False},
        ],
    }

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": bootstrap_short}}
        return _ddb_get_item(Key)

    table.get_item.side_effect = get_item

    lambda_handler({}, None)
    items = _items_by_player(writer)
    saka = items[101]
    assert saka["horizon_gw_ids"] == [33, 34]
    assert set(saka["horizon_xp_by_gw"].keys()) == {"33", "34"}


def test_happy_path_minutes_prob_reflects_availability(mock_table) -> None:
    """Odegaard has cop=50 → minutes_prob=0.5; Saka cop=None status=a → 1.0."""
    _table, writer = mock_table
    lambda_handler({}, None)
    items = _items_by_player(writer)
    assert items[101]["components"]["minutes_prob"] == Decimal("1")
    assert items[102]["components"]["minutes_prob"] == Decimal("0.5")


# ---------------------------------------------------------------------------
# Match-window guard
# ---------------------------------------------------------------------------


def test_skips_when_match_live(mock_table) -> None:
    _table, writer = mock_table
    with patch("handler.get_match_window") as gmw:
        gmw.return_value.is_live = True
        gmw.return_value.next_kickoff = None
        result = lambda_handler({}, None)

    assert result == {"ok": True, "skipped": "match_live"}
    writer.put_item.assert_not_called()


# ---------------------------------------------------------------------------
# Loud failures on missing dependencies
# ---------------------------------------------------------------------------


def test_missing_bootstrap_raises(mock_table) -> None:
    table, writer = mock_table

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#fixtures", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": []}}
        return {}

    table.get_item.side_effect = get_item

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)
    writer.put_item.assert_not_called()


def test_missing_fixtures_raises(mock_table) -> None:
    table, writer = mock_table

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": BOOTSTRAP_DATA}}
        return {}

    table.get_item.side_effect = get_item

    with pytest.raises(RuntimeError, match="fpl#fixtures"):
        lambda_handler({}, None)
    writer.put_item.assert_not_called()


def test_missing_player_history_raises(mock_table) -> None:
    """v2 inference is downstream of ingest_player_history. With no
    history rows, predictions collapse to position priors — technically
    not zero, but a misleading signal. Fail loud."""
    table, writer = mock_table
    table.scan.side_effect = _ddb_scan([])

    with pytest.raises(RuntimeError, match="fpl#player_history"):
        lambda_handler({}, None)
    writer.put_item.assert_not_called()


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_no_upcoming_gameweek_is_noop(mock_table) -> None:
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


def test_blank_gameweek_skips_team(mock_table) -> None:
    """Team 1 has a fixture in GW33; team 2 doesn't (blank). Only team 1's
    players get v2 rows — team 2's player is skipped, not written with xp=0."""
    table, writer = mock_table
    arsenal_only_fixtures = [
        {
            "id": 301, "event": 33, "kickoff_time": "2025-08-15T17:30:00Z",
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
    assert result["players_scored"] == 2  # Saka + Odegaard
    assert result["skipped_blank"] == 1   # Palmer

    items = _items_by_player(writer)
    assert set(items) == {101, 102}


def test_double_gameweek_sums_components(mock_table) -> None:
    """Team 2 has two fixtures in GW33 (DGW). Palmer's components should
    sum across the two fixtures — appearance, goals_xp, etc. each ~2× the
    single-fixture value (modulo per-fixture factor variation)."""
    table, writer = mock_table
    dgw_fixtures = [
        {
            "id": 301, "event": 33, "kickoff_time": "2025-08-15T17:30:00Z",
            "team_h": 1, "team_a": 2, "finished": False, "started": False,
            "team_h_difficulty": 3, "team_a_difficulty": 4,
        },
        {
            "id": 302, "event": 33, "kickoff_time": "2025-08-15T20:00:00Z",
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

    # DGW: two fixtures landed under fixtures[].
    assert len(palmer["components"]["fixtures"]) == 2
    # Single-fixture peers (Saka, Odegaard) have one. Their xp is in
    # the same scoring-categories scale; Palmer's appearance alone
    # should be ~2× a peer's.
    saka = items[101]
    assert palmer["components"]["appearance_xp"] > saka["components"]["appearance_xp"]


def test_flagged_player_xp_collapses_to_zero(mock_table) -> None:
    """A player with status=u (unavailable) has minutes_prob=0 → every
    p60-gated and p_any-gated component is zero → total xp 0."""
    table, writer = mock_table
    flagged_bootstrap = {**BOOTSTRAP_DATA}
    flagged_bootstrap["players"] = [
        {**p, "status": "u", "chance_of_playing_next_round": 0}
        for p in BOOTSTRAP_DATA["players"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": flagged_bootstrap}}
        return _ddb_get_item(Key)

    table.get_item.side_effect = get_item

    lambda_handler({}, None)
    items = _items_by_player(writer)
    for pid, item in items.items():
        assert item["xp"] == Decimal("0"), f"player {pid} should have xp=0 when flagged"


def test_player_with_no_history_falls_back_to_priors(mock_table) -> None:
    """A new player (no history rows) gets predictions from pure position
    priors — non-zero xp, no crash. The only history is for the OTHER
    two players; player 999 (added to bootstrap) has none."""
    table, writer = mock_table
    bootstrap_with_rookie = {**BOOTSTRAP_DATA}
    bootstrap_with_rookie["players"] = list(BOOTSTRAP_DATA["players"]) + [
        {
            "id": 999, "first_name": "Cold", "second_name": "Start",
            "web_name": "Rookie", "team": 1, "element_type": 4,  # FWD
            "total_points": 0, "form": "0.0", "now_cost": 50,
            "status": "a", "chance_of_playing_next_round": None,
        },
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {
                "Item": {"pk": Key["pk"], "sk": Key["sk"],
                         "data": bootstrap_with_rookie}
            }
        return _ddb_get_item(Key)

    table.get_item.side_effect = get_item

    result = lambda_handler({}, None)
    assert result["players_scored"] == 4  # original 3 + rookie

    items = _items_by_player(writer)
    rookie = items[999]
    # Rookie should still get a prediction (from priors), not crash.
    # Note: this fixture's bootstrap has only 1 completed GW (GW32),
    # which is below the season-play-rate min-GWs threshold, so the
    # dampening doesn't kick in here. The fringe-player dampening test
    # below uses a longer-completed-season fixture to exercise that path.
    assert rookie["xp"] > Decimal("0")
    assert rookie["position_id"] == 4


def test_fringe_player_xp_dampened_by_season_play_rate(mock_table) -> None:
    """The bug-driving case: a player with status='a' and cop=null but
    near-zero season minutes should NOT be projected at full position-
    prior strength. The dampener pulls their xP toward 0; without it
    they'd compete with starters on the back of the position prior alone
    (and a Double Gameweek would put them at the top of the suggestions
    list, which is what Jakob observed)."""
    table, writer = mock_table

    # Override bootstrap so 6 GWs are finished — above the
    # _SEASON_PLAY_RATE_MIN_GWS threshold (4). One *fringe* FWD with 50
    # season minutes (~50/(90·6) = 0.093) and one *starter* FWD with
    # 540 season minutes (= 1.0, full starter). Same position, same
    # team-prior fallback for rates, same fixtures — only the dampener
    # differentiates them.
    long_season_bootstrap = {
        **BOOTSTRAP_DATA,
        "gameweeks": [
            {
                "id": gw_id, "name": f"Gameweek {gw_id}",
                "deadline_time": f"2026-02-{gw_id:02d}T10:00:00Z",
                "is_current": gw_id == 32,
                "is_next": gw_id == 33,
                "finished": gw_id <= 32,
            }
            for gw_id in range(27, 38)
        ],
        "players": list(BOOTSTRAP_DATA["players"]) + [
            {
                "id": 800, "first_name": "Fringe", "second_name": "FWD",
                "web_name": "FringeFWD", "team": 1, "element_type": 4,
                "total_points": 5, "form": "0.5", "now_cost": 45,
                "status": "a", "chance_of_playing_next_round": None,
                "minutes": 50,  # ~0.09 of available — proper fringe
            },
            {
                "id": 801, "first_name": "Starter", "second_name": "FWD",
                "web_name": "StarterFWD", "team": 1, "element_type": 4,
                "total_points": 100, "form": "5.0", "now_cost": 75,
                "status": "a", "chance_of_playing_next_round": None,
                "minutes": 540,  # full starter (= 6 × 90)
            },
        ],
    }

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {
                "Item": {"pk": Key["pk"], "sk": Key["sk"],
                         "data": long_season_bootstrap}
            }
        return _ddb_get_item(Key)

    table.get_item.side_effect = get_item

    lambda_handler({}, None)
    items = _items_by_player(writer)
    fringe = items[800]
    starter = items[801]

    # Both players hit the position prior for per-90 rates (no history),
    # so without dampening they'd have similar xP. With dampening the
    # fringe player's projection should be roughly an order of magnitude
    # lower than the starter's.
    assert fringe["xp"] < starter["xp"] / 5

    # And concretely: a fringe FWD with rate ≈ 0.09 should land far
    # below the typical 4–6 xP range of a starter FWD — well under 1.0.
    assert fringe["xp"] < Decimal("1.0")

    # Sanity: the surfaced ``season_play_rate`` matches what we expect.
    # 50 / (90 · 6) ≈ 0.0926.
    fringe_components = fringe["components"]
    assert float(fringe_components["season_play_rate"]) == pytest.approx(
        50 / (90 * 6), abs=1e-3,
    )
    starter_components = starter["components"]
    assert float(starter_components["season_play_rate"]) == pytest.approx(1.0)
