from __future__ import annotations

import json
import os
import time
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
import responses

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")

import handler  # noqa: E402
from handler import lambda_handler  # noqa: E402


# ---------------------------------------------------------------------------
# Hand-built dataset.
#
# 4-player "squad" (smaller than FPL's real 15 — the algorithm doesn't care
# about squad size and a small one is easier to reason about in test math).
#
# Squad: ids [101, 102, 201, 401]
#   101  Bruno Fernandes  team 1   MID (3)  cost 85   form 6.0
#   102  GK Pickup        team 2   GK  (1)  cost 45   form 4.0
#   201  Palmer           team 3   MID (3)  cost 105  form 8.0
#   401  Cheap DEF        team 4   DEF (2)  cost 45   form 1.0
#
# Pool: ids [501, 502, 503] — also valid candidate INs
#   501  Haaland          team 5   FWD (4)  cost 145  form 9.0
#   502  Salah            team 5   MID (3)  cost 130  form 7.5
#   503  Cheap DEF #2     team 6   DEF (2)  cost 45   form 4.0
#
# Six teams (1-6) in three fixture pairings ((1,2), (3,4), (5,6)) — every
# team plays exactly once per GW, so xP math is form × 0.6 (easiness) ×
# 1.0 (mins) × 1 (single fixture) × N GWs.
#
# Bank: 0.5m (= 5 in 0.1m units). Single-fixture upcoming GW33 for all teams,
# all difficulty 3 (easiness 0.6) — keeps math identical across players so we
# can spot-check delta-xP arithmetic by hand.
# ---------------------------------------------------------------------------


def _player(id_, web_name, team, pos, cost, *, status="a", cop=None):
    return {
        "id": id_, "first_name": "First", "second_name": web_name,
        "web_name": web_name, "team": team, "element_type": pos,
        "total_points": 100, "form": "5.0", "now_cost": cost,
        "status": status, "chance_of_playing_next_round": cop,
    }


SQUAD_IDS = [101, 102, 201, 401]

BOOTSTRAP_DATA = {
    "teams": [{"id": t, "name": f"T{t}", "short_name": f"T{t}",
               "code": t, "strength": 3} for t in range(1, 7)],
    "positions": [
        {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
        {"id": 2, "singular_name": "Defender", "singular_name_short": "DEF"},
        {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
        {"id": 4, "singular_name": "Forward", "singular_name_short": "FWD"},
    ],
    "players": [
        _player(101, "Bruno", 1, 3, 85),
        _player(102, "PickupGK", 2, 1, 45),
        _player(201, "Palmer", 3, 3, 105),
        _player(401, "CheapDef", 4, 2, 45),
        _player(501, "Haaland", 5, 4, 145),
        _player(502, "Salah", 5, 3, 130),
        _player(503, "CheapDef2", 6, 2, 45),
    ],
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
        {"id": 35, "name": "Gameweek 35",
         "deadline_time": "2026-05-06T10:00:00Z",
         "is_current": False, "is_next": False, "finished": False},
    ],
}


def _fx(id_, gw, h, a, h_diff=3, a_diff=3):
    return {
        "id": id_, "event": gw, "kickoff_time": f"2026-04-2{gw - 30}T15:00:00Z",
        "team_h": h, "team_a": a, "finished": False, "started": False,
        "team_h_difficulty": h_diff, "team_a_difficulty": a_diff,
    }


# Each team plays once per GW, all difficulty 3 -> easiness 0.6 across the
# board. Lets us verify horizon-xP math: 3 GWs * (form * 0.6 * 1.0 * 1) = 1.8 * form.
FIXTURES_DATA = []
for gw_id in (33, 34, 35):
    for fx_id, (h, a) in enumerate([(1, 2), (3, 4), (5, 6)], start=1):
        FIXTURES_DATA.append(_fx(gw_id * 100 + fx_id, gw_id, h, a))


PLAYER_FORM_ROWS = [
    {"pk": "analytics#player_form", "sk": "101", "form_score": Decimal("6.0")},
    {"pk": "analytics#player_form", "sk": "102", "form_score": Decimal("4.0")},
    {"pk": "analytics#player_form", "sk": "201", "form_score": Decimal("8.0")},
    {"pk": "analytics#player_form", "sk": "401", "form_score": Decimal("1.0")},
    {"pk": "analytics#player_form", "sk": "501", "form_score": Decimal("9.0")},
    {"pk": "analytics#player_form", "sk": "502", "form_score": Decimal("7.5")},
    {"pk": "analytics#player_form", "sk": "503", "form_score": Decimal("4.0")},
]


# Cached entry + picks: the user's data lives in DDB already (the cache-aside
# happy path; FPL is not called).
ENTRY_CACHE = {
    "id": 12345, "name": "Test Team",
    "player_first_name": "Manager", "player_last_name": "Name",
    "started_event": 1, "favourite_team": 13,
    "summary_overall_points": 1500, "summary_overall_rank": 100000,
    "summary_event_points": 50, "summary_event_rank": 50000,
    "current_event": 32, "last_deadline_value": 1000,
    "last_deadline_bank": 5,  # 0.5m
    "last_deadline_total_transfers": 10,
}

PICKS_CACHE = {
    "active_chip": None,
    "picks": [
        {"element": pid, "position": i + 1, "multiplier": 1,
         "is_captain": False, "is_vice_captain": False}
        for i, pid in enumerate(SQUAD_IDS)
    ],
    "entry_history": {
        "event": 32, "points": 50, "total_points": 1500,
        "rank": None, "overall_rank": 100000,
        "bank": 5, "value": 1000, "event_transfers": 1,
        "event_transfers_cost": 0, "points_on_bench": 5,
    },
}

FUTURE_TIME = int(time.time()) + 1800  # cached items still fresh


def _cached_item(pk, sk, data):
    return {
        "pk": pk, "sk": sk,
        "schema_version": 1,
        "fetched_at": int(time.time()),
        "expires_at": FUTURE_TIME,
        "ttl": FUTURE_TIME,
        "data": data,
    }


def _ddb_get_item_default(key):
    pk, sk = key["pk"], key["sk"]
    if (pk, sk) == ("fpl#bootstrap", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": BOOTSTRAP_DATA}}
    if (pk, sk) == ("fpl#fixtures", "latest"):
        return {"Item": {"pk": pk, "sk": sk, "data": FIXTURES_DATA}}
    if (pk, sk) == ("entry#12345", "latest"):
        return {"Item": _cached_item(pk, sk, ENTRY_CACHE)}
    if (pk, sk) == ("entry#12345#gw#32", "latest"):
        return {"Item": _cached_item(pk, sk, PICKS_CACHE)}
    return {}


def _ddb_query_default(**kwargs):
    return {"Items": PLAYER_FORM_ROWS}


@pytest.fixture
def mock_table():
    table = MagicMock()
    table.get_item.side_effect = lambda Key: _ddb_get_item_default(Key)
    table.query.side_effect = _ddb_query_default

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


def _event(team_id="12345", horizon=None):
    qs = {"horizon": str(horizon)} if horizon is not None else None
    return {
        "pathParameters": {"teamId": team_id},
        "queryStringParameters": qs,
    }


def _body(response):
    return json.loads(response["body"])


# ---------------------------------------------------------------------------
# Happy path: cached entry + picks, fresh bootstrap/fixtures, form rows present.
# ---------------------------------------------------------------------------


def test_happy_path_returns_ranked_suggestions(mock_table):
    """Hand-picked math: each fixture has difficulty 3 (easiness 0.6),
    every team plays exactly once each GW, all players are 'a' status.
    horizon_xp(player) = form * 0.6 * 1.0 * 1 * 3 GWs = 1.8 * form.

      Squad horizon xPs:
        101 (Bruno):   1.8 * 6.0 = 10.8
        102 (PickupGK): 1.8 * 4.0 = 7.2
        201 (Palmer):   1.8 * 8.0 = 14.4
        401 (CheapDef): 1.8 * 1.0 = 1.8
      Pool horizon xPs:
        501 (Haaland):  1.8 * 9.0 = 16.2
        502 (Salah):    1.8 * 7.5 = 13.5
        503 (CheapDef2): 1.8 * 4.0 = 7.2

      Bank = 5 (0.5m). Valid same-position swaps:
        401 (DEF, 45) -> 503 (DEF, 45): cost_change=0 ✓
          delta = 7.2 - 1.8 = 5.4
        101 (MID, 85) -> 502 (MID, 130): cost=45 > bank 5 ✗
        201 (MID, 105) -> 502 (MID, 130): cost=25 > bank 5 ✗
        102 (GK)  -> no GK in pool ✗
        Haaland is FWD; no FWD in squad ✗

      So only one valid swap surfaces: (401 out, 503 in).
    """
    response = lambda_handler(_event(), None)
    assert response["statusCode"] == 200
    body = _body(response)

    assert body["team_id"] == 12345
    assert body["horizon_gws"] == 3
    assert body["horizon_gw_ids"] == [33, 34, 35]
    assert body["season_over"] is False
    assert body["preseason"] is False

    # Squad horizon xP = 10.8 + 7.2 + 14.4 + 1.8 = 34.2
    assert body["current_squad_xp"] == 34.2

    suggestions = body["suggestions"]
    assert len(suggestions) == 1
    s = suggestions[0]
    assert s["out"]["player_id"] == 401
    assert s["in"]["player_id"] == 503
    assert s["delta_xp"] == 5.4
    assert s["cost_change"] == 0
    assert s["out"]["web_name"] == "CheapDef"
    assert s["in"]["web_name"] == "CheapDef2"
    assert s["out"]["horizon_xp"] == 1.8
    assert s["in"]["horizon_xp"] == 7.2


def test_happy_path_bigger_bank_unlocks_more_swaps(mock_table):
    """Same setup, but with bigger bank. Now MID upgrades become viable.
    Bank=50 (5m): Bruno -> Salah cost=45 ✓; Palmer -> Salah cost=25 ✓."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(), None))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in body["suggestions"]}
    assert (101, 502) in swaps  # Bruno -> Salah
    assert (201, 502) in swaps  # Palmer -> Salah
    assert (401, 503) in swaps  # CheapDef -> CheapDef2


def test_horizon_clamps_to_remaining_season(mock_table):
    """Bootstrap with only GW33 unfinished — horizon=3 should clamp to 1."""
    one_left = dict(BOOTSTRAP_DATA)
    one_left["gameweeks"] = [
        {**gw, "is_next": gw["id"] == 33,
         "finished": gw["id"] != 33}
        for gw in BOOTSTRAP_DATA["gameweeks"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": one_left}}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item
    body = _body(lambda_handler(_event(horizon=3), None))
    assert body["horizon_gws"] == 1
    assert body["horizon_gw_ids"] == [33]


def test_season_over_returns_empty_suggestions(mock_table):
    finished = dict(BOOTSTRAP_DATA)
    finished["gameweeks"] = [
        {**gw, "is_next": False, "finished": True}
        for gw in BOOTSTRAP_DATA["gameweeks"]
    ]

    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {"Item": {"pk": Key["pk"], "sk": Key["sk"], "data": finished}}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item
    body = _body(lambda_handler(_event(), None))
    assert body["season_over"] is True
    assert body["suggestions"] == []
    assert body["horizon_gws"] == 0


def test_invalid_team_id_returns_400(mock_table):
    response = lambda_handler({"pathParameters": {"teamId": "abc"}}, None)
    assert response["statusCode"] == 400
    assert _body(response)["error"] == "invalid team id"


def test_missing_bootstrap_raises(mock_table):
    """Bootstrap missing — analyzer fails loudly. Same precedent as
    analyze_player_xp; this is an ingest problem, not user-facing."""
    def get_item(Key):
        if (Key["pk"], Key["sk"]) == ("fpl#bootstrap", "latest"):
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item
    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler(_event(), None)


def test_missing_player_form_rows_raises(mock_table):
    mock_table.query.side_effect = lambda **kwargs: {"Items": []}
    with pytest.raises(RuntimeError, match="analytics#player_form"):
        lambda_handler(_event(), None)


# ---------------------------------------------------------------------------
# Cache-aside paths: entry / picks not cached -> falls through to FPL.
# ---------------------------------------------------------------------------


@responses.activate
def test_cache_miss_on_entry_fetches_from_fpl(mock_table):
    """No cached entry + picks; both fall through to /entry/... FPL endpoints
    and get cached afterwards. Asserts the suggestion still computes."""
    def get_item(Key):
        # Bootstrap & fixtures cached, entry & picks not.
        if Key["pk"] in {"entry#12345", "entry#12345#gw#32"}:
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    responses.get(
        "https://fantasy.premierleague.com/api/entry/12345/",
        json=ENTRY_CACHE,
    )
    responses.get(
        "https://fantasy.premierleague.com/api/entry/12345/event/32/picks/",
        json=PICKS_CACHE,
    )

    response = lambda_handler(_event(), None)
    assert response["statusCode"] == 200
    body = _body(response)
    assert body["team_id"] == 12345

    # Sanity: both cache-aside puts should have happened.
    pk_writes = {call.kwargs["Item"]["pk"]
                 for call in mock_table.put_item.call_args_list}
    assert "entry#12345" in pk_writes
    assert "entry#12345#gw#32" in pk_writes


@responses.activate
def test_entry_404_returns_404(mock_table):
    def get_item(Key):
        if Key["pk"] == "entry#12345":
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    responses.get(
        "https://fantasy.premierleague.com/api/entry/12345/",
        status=404,
    )
    response = lambda_handler(_event(), None)
    assert response["statusCode"] == 404
    assert _body(response)["error"] == "entry not found"


@responses.activate
def test_picks_404_returns_404(mock_table):
    """Cached entry, but picks missing in cache and FPL returns 404 — e.g.
    the user just signed up and hasn't picked a team for current_event yet."""
    def get_item(Key):
        if Key["pk"] == "entry#12345#gw#32":
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    responses.get(
        "https://fantasy.premierleague.com/api/entry/12345/event/32/picks/",
        status=404,
    )
    response = lambda_handler(_event(), None)
    assert response["statusCode"] == 404
    body = _body(response)
    assert body["error"] == "picks not found"
    assert body["gameweek"] == 32


def test_horizon_query_param_caps_at_max(mock_table):
    body = _body(lambda_handler(_event(horizon=99), None))
    # MAX_HORIZON is 5 but only 3 GWs unfinished here -> clamped further.
    assert body["horizon_gws"] == 3


def test_horizon_query_param_default_when_invalid(mock_table):
    body = _body(lambda_handler(_event(horizon="garbage"), None))
    # Invalid query -> falls back to DEFAULT_HORIZON (3); 3 GWs available.
    assert body["horizon_gws"] == 3


def test_preseason_returns_empty(mock_table):
    """User has no current_event yet (signed up pre-season)."""
    preseason_entry = {**ENTRY_CACHE, "current_event": None}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], preseason_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(), None))
    assert body["preseason"] is True
    assert body["suggestions"] == []
