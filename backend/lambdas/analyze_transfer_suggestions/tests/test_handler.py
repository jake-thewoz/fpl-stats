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


# Each row carries form_score plus the two fixture-quality signals the
# transfer-suggestion expand UI surfaces (#97). Keeping the values
# distinct per player so test assertions pin to the right row.
PLAYER_FORM_ROWS = [
    {"pk": "analytics#player_form", "sk": "101",
     "form_score": Decimal("6.0"),
     "avg_upcoming_difficulty": Decimal("3.2"),
     "avg_upcoming_elo_expected_score": Decimal("0.55")},
    {"pk": "analytics#player_form", "sk": "102",
     "form_score": Decimal("4.0"),
     "avg_upcoming_difficulty": Decimal("3.4"),
     "avg_upcoming_elo_expected_score": Decimal("0.50")},
    {"pk": "analytics#player_form", "sk": "201",
     "form_score": Decimal("8.0"),
     "avg_upcoming_difficulty": Decimal("2.6"),
     "avg_upcoming_elo_expected_score": Decimal("0.65")},
    {"pk": "analytics#player_form", "sk": "401",
     "form_score": Decimal("1.0"),
     "avg_upcoming_difficulty": Decimal("4.2"),
     "avg_upcoming_elo_expected_score": Decimal("0.30")},
    {"pk": "analytics#player_form", "sk": "501",
     "form_score": Decimal("9.0"),
     "avg_upcoming_difficulty": Decimal("2.0"),
     "avg_upcoming_elo_expected_score": Decimal("0.70")},
    # 502 carries form but no fixture signals — covers the "new arrival
    # / missing data" path where the response should serialise null.
    {"pk": "analytics#player_form", "sk": "502",
     "form_score": Decimal("7.5"),
     "avg_upcoming_difficulty": None,
     "avg_upcoming_elo_expected_score": None},
    {"pk": "analytics#player_form", "sk": "503",
     "form_score": Decimal("4.0"),
     "avg_upcoming_difficulty": Decimal("3.0"),
     "avg_upcoming_elo_expected_score": Decimal("0.50")},
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

# History fixture: empty `current` so the FT walk yields the season-
# start default (1). Tests that need specific FT scenarios can override
# via the ``free_transfers`` query param on _event(), avoiding having
# to construct a 30+ GW history walk per test.
HISTORY_CACHE = {
    "current": [],
    "chips": [],
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
    if (pk, sk) == ("entry#12345#history", "latest"):
        return {"Item": _cached_item(pk, sk, HISTORY_CACHE)}
    return {}


def _v2_xp_row(player_id: int, *, horizon_xp_by_gw: dict[int, str]) -> dict:
    """Mock row matching what analyze_player_xp_v2 writes."""
    return {
        "pk": "analytics#player_xp_v2",
        "sk": str(player_id),
        "schema_version": 1,
        "model_version": "v2.0",
        "computed_at": "2026-04-28T04:30:00+00:00",
        "player_id": player_id,
        "gameweek": 33,
        "horizon_gw_ids": [33, 34, 35, 36, 37],
        "horizon_xp_by_gw": {
            str(gw): Decimal(xp) for gw, xp in horizon_xp_by_gw.items()
        },
    }


# Synthetic v2 horizon for every player in the squad + pool. Distinct
# values per player so ranking math is deterministic.
V2_XP_ROWS = [
    _v2_xp_row(101, horizon_xp_by_gw={
        33: "5.0", 34: "5.5", 35: "6.0", 36: "5.5", 37: "5.2",
    }),
    _v2_xp_row(102, horizon_xp_by_gw={
        33: "3.0", 34: "3.0", 35: "3.0", 36: "3.0", 37: "3.0",
    }),
    _v2_xp_row(201, horizon_xp_by_gw={
        33: "7.5", 34: "7.0", 35: "7.5", 36: "8.0", 37: "7.0",
    }),
    _v2_xp_row(401, horizon_xp_by_gw={
        33: "1.5", 34: "1.5", 35: "1.5", 36: "1.5", 37: "1.5",
    }),
    _v2_xp_row(501, horizon_xp_by_gw={
        33: "8.5", 34: "9.0", 35: "8.5", 36: "8.0", 37: "8.5",
    }),
    _v2_xp_row(502, horizon_xp_by_gw={
        33: "6.5", 34: "6.0", 35: "7.0", 36: "6.5", 37: "6.5",
    }),
    _v2_xp_row(503, horizon_xp_by_gw={
        33: "3.5", 34: "3.5", 35: "3.5", 36: "3.5", 37: "3.5",
    }),
]


def _query_pk(kwargs: dict) -> str:
    """Pull the pk value out of a ``Key("pk").eq(...)`` condition for
    routing the mocked query response. Uses ``get_expression()`` rather
    than the private ``_values`` attribute so this stays robust against
    boto3 internals changing."""
    cond = kwargs.get("KeyConditionExpression")
    if cond is None:
        return ""
    try:
        return cond.get_expression()["values"][1]
    except (AttributeError, KeyError, IndexError, TypeError):
        return ""


def _ddb_query_default(**kwargs):
    """Default query mock — routes by partition so the v2 reader finds
    horizon rows and the player_form Query still finds form rows."""
    if _query_pk(kwargs) == "analytics#player_xp_v2":
        return {"Items": V2_XP_ROWS}
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


def _event(
    team_id="12345",
    horizon=None,
    positions=None,
    max_transfers=None,
    free_transfers=None,
):
    qs: dict[str, str] | None = None
    if any(p is not None for p in (horizon, positions, max_transfers, free_transfers)):
        qs = {}
        if horizon is not None:
            qs["horizon"] = str(horizon)
        if positions is not None:
            qs["positions"] = positions
        if max_transfers is not None:
            qs["max_transfers"] = str(max_transfers)
        if free_transfers is not None:
            qs["free_transfers"] = str(free_transfers)
    return {
        "pathParameters": {"teamId": team_id},
        "queryStringParameters": qs,
    }


def _body(response):
    return json.loads(response["body"])


def _moves_in(body):
    """Flatten ``body['bundles']`` to a list of single moves. For tests
    written against the single-transfer endpoint shape, where every
    bundle is size-1, this list mirrors the legacy ``suggestions``
    array. For tests where size>1 bundles may appear, prefer accessing
    ``body['bundles']`` directly."""
    return [b["moves"][0] for b in body["bundles"] if b["num_transfers"] == 1]


# ---------------------------------------------------------------------------
# Happy path: cached entry + picks, fresh bootstrap/fixtures, v2 horizon
# rows present. The mock returns V2_XP_ROWS on the v2 partition Query;
# the suggest_transfers ranking math is independent of which model
# produced the horizon_xps dict.
# ---------------------------------------------------------------------------


def test_happy_path_returns_ranked_suggestions(mock_table):
    """End-to-end happy path with the v2 horizon mock.

    V2_XP_ROWS values per player on horizon=3 (GW33-35):
        101 Bruno:    5.0+5.5+6.0 = 16.5
        102 PickupGK: 3.0+3.0+3.0 =  9.0
        201 Palmer:   7.5+7.0+7.5 = 22.0
        401 CheapDef: 1.5+1.5+1.5 =  4.5
        501 Haaland:  8.5+9.0+8.5 = 26.0
        502 Salah:    6.5+6.0+7.0 = 19.5
        503 CheapDef2: 3.5+3.5+3.5 = 10.5

      Squad horizon xP = 16.5 + 9.0 + 22.0 + 4.5 = 52.0

      Bank = 5 (0.5m). Same constraint logic as before — only one
      valid same-position swap fits the budget:
        401 (DEF, 45) -> 503 (DEF, 45): cost_change=0 ✓
          delta = 10.5 - 4.5 = 6.0
    """
    response = lambda_handler(_event(), None)
    assert response["statusCode"] == 200
    body = _body(response)

    assert body["team_id"] == 12345
    assert body["horizon_gws"] == 3
    assert body["horizon_gw_ids"] == [33, 34, 35]
    assert body["season_over"] is False
    assert body["preseason"] is False
    assert body["current_squad_xp"] == 52.0

    suggestions = _moves_in(body)
    assert len(suggestions) == 1
    s = suggestions[0]
    assert s["out"]["player_id"] == 401
    assert s["in"]["player_id"] == 503
    assert s["delta_xp"] == 6.0
    assert s["cost_change"] == 0
    assert s["out"]["web_name"] == "CheapDef"
    assert s["in"]["web_name"] == "CheapDef2"
    assert s["out"]["horizon_xp"] == 4.5
    assert s["in"]["horizon_xp"] == 10.5


def test_enriched_player_carries_form_and_fixture_signals(mock_table):
    """Each side of every suggestion exposes form_score, avg_upcoming_difficulty,
    and avg_upcoming_elo_expected_score so the mobile expand-on-tap card
    (#97) can render its comparison table without a second round-trip."""
    response = lambda_handler(_event(), None)
    body = _body(response)
    s = _moves_in(body)[0]

    # 401 (CheapDef, going out) — values from the fixture row.
    assert s["out"]["form_score"] == 1.0
    assert s["out"]["avg_upcoming_difficulty"] == 4.2
    assert s["out"]["avg_upcoming_elo_expected_score"] == 0.3

    # 503 (CheapDef2, coming in).
    assert s["in"]["form_score"] == 4.0
    assert s["in"]["avg_upcoming_difficulty"] == 3.0
    assert s["in"]["avg_upcoming_elo_expected_score"] == 0.5


def test_enriched_player_handles_null_fixture_signals(mock_table):
    """When a player's analytics#player_form row has null
    avg_upcoming_difficulty / elo (no upcoming fixtures with known
    ratings), the response forwards null rather than zeroing out."""
    # Bigger bank so 502's swap-in becomes viable and we can read its block.
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item
    response = lambda_handler(_event(), None)
    body = _body(response)

    # Find a suggestion where 502 appears (in or out) — it's the player
    # whose fixture signals are null in the fixture data.
    swap_with_502 = next(
        s for s in _moves_in(body)
        if s["in"]["player_id"] == 502 or s["out"]["player_id"] == 502
    )
    side = "in" if swap_with_502["in"]["player_id"] == 502 else "out"
    assert swap_with_502[side]["form_score"] == 7.5
    assert swap_with_502[side]["avg_upcoming_difficulty"] is None
    assert swap_with_502[side]["avg_upcoming_elo_expected_score"] is None


def test_happy_path_bigger_bank_unlocks_more_swaps(mock_table):
    """Same setup, but with bigger bank. Now MID upgrades become viable.
    Bank=50 (5m): Bruno -> Salah cost=45 ✓; Palmer -> Salah cost=25 ✓."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    # Constrain to single-transfer bundles for the legacy assertion shape;
    # multi-move bundles get exercised in the dedicated multi-transfer tests.
    body = _body(lambda_handler(_event(max_transfers=1), None))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in _moves_in(body)}
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
    assert body["bundles"] == []
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
    assert body["bundles"] == []


# ---------------------------------------------------------------------------
# Position filter (`?positions=2,3`)
# ---------------------------------------------------------------------------


def test_position_filter_def_only_returns_def_swap(mock_table):
    """positions=2 (DEF) -> only the CheapDef -> CheapDef2 swap survives.
    (In our hand-built dataset with bank=5 the DEF swap was already the
    only one that fit; this asserts the same result lands when a filter
    is explicit.)"""
    body = _body(lambda_handler(_event(positions="2"), None))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in _moves_in(body)}
    assert swaps == {(401, 503)}


def test_position_filter_fwd_returns_no_suggestions(mock_table):
    """positions=4 (FWD) -> squad has no FWD members, so no candidate
    swaps exist. Empty list, no crash."""
    body = _body(lambda_handler(_event(positions="4"), None))
    assert body["bundles"] == []


def test_position_filter_def_and_mid_with_bigger_bank(mock_table):
    """positions=2,3 + bigger bank -> DEF and MID swaps both land.
    Confirms the union semantics: 'top 10 from the union of these
    positions', not 'top 10 in each'."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)
    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(positions="2,3", max_transfers=1), None))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in _moves_in(body)}
    # DEF: 401 -> 503; MID: 101 -> 502, 201 -> 502.
    assert (401, 503) in swaps
    assert (101, 502) in swaps
    assert (201, 502) in swaps
    # No GKP or FWD swaps even though they'd be valid otherwise — the
    # filter excludes positions 1 and 4 entirely.
    assert all(s["out"]["position_id"] in (2, 3) for s in _moves_in(body))


def test_position_filter_mid_only_with_bigger_bank(mock_table):
    """positions=3 (MID) with bank big enough — DEF swap excluded even
    though it would otherwise rank highly."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)
    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(positions="3", max_transfers=1), None))
    assert all(s["out"]["position_id"] == 3 for s in _moves_in(body))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in _moves_in(body)}
    assert (401, 503) not in swaps  # DEF swap excluded


def test_position_filter_invalid_falls_back_to_no_filter(mock_table):
    """positions=garbage -> parsed as None -> behaviour identical to
    omitting the param entirely. Same number of suggestions as the
    happy path."""
    body_filtered = _body(lambda_handler(_event(positions="not-numbers"), None))
    body_default = _body(lambda_handler(_event(), None))
    assert len(body_filtered["bundles"]) == len(body_default["bundles"])


def test_position_filter_unknown_positions_yields_empty(mock_table):
    """positions=99 -> parses to {99}, but no FPL element_type is 99,
    so squad and pool both filter to empty. Empty suggestions, no
    crash. (Distinct from invalid strings which fall back to None.)"""
    body = _body(lambda_handler(_event(positions="99"), None))
    assert body["bundles"] == []


def test_position_filter_mixed_valid_and_garbage_keeps_valid(mock_table):
    """positions=2,not-a-number,3 -> valid tokens kept ({2, 3}), garbage
    skipped silently. Same effect as positions=2,3."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)
    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(positions="2,not-a-number,3", max_transfers=1), None))
    assert all(s["out"]["position_id"] in (2, 3) for s in _moves_in(body))
    assert len(_moves_in(body)) > 0


# ---------------------------------------------------------------------------
# v2 horizon — extra coverage of the read path. The default mock above
# already routes the v2 partition to V2_XP_ROWS, so the existing
# happy-path / position-filter / horizon-clamp tests exercise the v2
# query implicitly.
# ---------------------------------------------------------------------------


def test_horizon_param_changes_sum(mock_table):
    """horizon=1 picks GW33 only; default horizon=3 picks GW33-35.
    The summed current_squad_xp scales with horizon size.

    Bootstrap has only 3 unfinished GWs, so horizon>3 clamps to 3 and
    yields the same sum — covered by test_horizon_clamps_to_remaining_season.
    """
    body_h1 = _body(lambda_handler(_event(horizon=1), None))
    body_default = _body(lambda_handler(_event(), None))
    # h=1: per-player GW33 → 5.0 + 3.0 + 7.5 + 1.5 = 17.0
    assert body_h1["current_squad_xp"] == pytest.approx(17.0)
    # default h=3 → 52.0 (same totals as test_happy_path).
    assert body_default["current_squad_xp"] == pytest.approx(52.0)
    assert body_h1["current_squad_xp"] < body_default["current_squad_xp"]


def test_missing_v2_xp_rows_raises(mock_table):
    """The reader is downstream of analyze_player_xp_v2. No rows means
    the writer hasn't run yet (fresh deploy). Fail loud — better than
    serving zero-ranked suggestions."""
    def query_side_effect(**kwargs):
        if _query_pk(kwargs) == "analytics#player_xp_v2":
            return {"Items": []}
        return {"Items": PLAYER_FORM_ROWS}
    mock_table.query.side_effect = query_side_effect

    with pytest.raises(RuntimeError, match="analytics#player_xp_v2"):
        lambda_handler(_event(), None)


# ---------------------------------------------------------------------------
# FT-aware multi-transfer behaviour (#90).
# ---------------------------------------------------------------------------


def test_response_carries_free_transfers_and_max_transfers(mock_table):
    """The response surfaces FT-related fields the mobile UI uses to
    explain bundle scoring (e.g. labelling hit cost on a card)."""
    body = _body(lambda_handler(_event(), None))
    # Default HISTORY_CACHE has no completed GWs, so derived FT = 1
    # (season-start convention).
    assert body["free_transfers"] == 1
    # Default max_transfers is 2 (DEFAULT_MAX_TRANSFERS).
    assert body["max_transfers_considered"] == 2


def test_free_transfers_query_param_overrides_derivation(mock_table):
    """``?free_transfers=N`` skips the history fetch and uses N directly.
    Useful for previewing 'what if I had 3 banked FTs' scenarios."""
    body = _body(lambda_handler(_event(free_transfers=3), None))
    assert body["free_transfers"] == 3


def test_max_transfers_clamped_to_module_constant(mock_table):
    """``?max_transfers=99`` is clamped to MAX_BUNDLE_SIZE (3) so the
    combinatorial search stays bounded."""
    from compute import MAX_BUNDLE_SIZE
    body = _body(lambda_handler(_event(max_transfers=99), None))
    assert body["max_transfers_considered"] == MAX_BUNDLE_SIZE


def test_max_transfers_one_returns_only_size_one_bundles(mock_table):
    body = _body(lambda_handler(_event(max_transfers=1), None))
    assert all(b["num_transfers"] == 1 for b in body["bundles"])


def test_two_move_bundle_includes_hit_cost_when_ft_is_one(mock_table):
    """Bigger bank + max_transfers=2 + free_transfers=1 enables 2-move
    bundles. Each 2-move bundle should report hit_cost = 4 and a
    delta_xp_net that's exactly delta_xp_gross − 4."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(
        _event(max_transfers=2, free_transfers=1), None,
    ))
    two_move_bundles = [b for b in body["bundles"] if b["num_transfers"] == 2]
    assert two_move_bundles, "expected at least one 2-move bundle with bigger bank"
    for b in two_move_bundles:
        assert b["hit_cost"] == 4
        assert b["delta_xp_net"] == pytest.approx(b["delta_xp_gross"] - 4)


def test_two_move_bundle_no_hit_when_ft_is_two(mock_table):
    """Same bigger-bank setup, but with free_transfers=2 the 2-move
    bundles should report hit_cost=0 and net == gross."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(
        _event(max_transfers=2, free_transfers=2), None,
    ))
    two_move_bundles = [b for b in body["bundles"] if b["num_transfers"] == 2]
    assert two_move_bundles
    for b in two_move_bundles:
        assert b["hit_cost"] == 0
        assert b["delta_xp_net"] == pytest.approx(b["delta_xp_gross"])


def test_history_cache_miss_falls_back_to_fpl(mock_table):
    """No cached history → handler fetches from FPL and caches the result.
    Verifies the FT-derivation cache-aside path."""
    # Cached history removed: handler will fetch from FPL.
    def get_item(Key):
        if Key["pk"] == "entry#12345#history":
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    with responses.RequestsMock() as rsps:
        rsps.get(
            "https://fantasy.premierleague.com/api/entry/12345/history/",
            json={"current": [], "chips": []},
        )
        response = lambda_handler(_event(), None)
        assert response["statusCode"] == 200

    # Cache-aside put: history written.
    pk_writes = {call.kwargs["Item"]["pk"]
                 for call in mock_table.put_item.call_args_list}
    assert "entry#12345#history" in pk_writes


def test_history_fetch_failure_falls_back_to_one_ft(mock_table):
    """If FPL history fetch fails, handler defaults to FALLBACK_FREE_TRANSFERS=1
    rather than crashing — see fallback rationale in the handler."""
    def get_item(Key):
        if Key["pk"] == "entry#12345#history":
            return {}
        return _ddb_get_item_default(Key)

    mock_table.get_item.side_effect = get_item

    with responses.RequestsMock() as rsps:
        rsps.get(
            "https://fantasy.premierleague.com/api/entry/12345/history/",
            status=500,
        )
        response = lambda_handler(_event(), None)
        assert response["statusCode"] == 200
        body = _body(response)
        assert body["free_transfers"] == 1


def test_bundle_top_level_fields_present(mock_table):
    """Each bundle has all the fields mobile expects: moves array (with
    out/in/delta_xp/cost_change per move), num_transfers, hit_cost,
    delta_xp_gross, delta_xp_net, total_cost_change."""
    body = _body(lambda_handler(_event(), None))
    assert body["bundles"], "happy path returns at least one bundle"
    b = body["bundles"][0]
    expected_top = {
        "moves", "num_transfers", "hit_cost",
        "delta_xp_gross", "delta_xp_net", "total_cost_change",
    }
    assert expected_top.issubset(b.keys())
    for move in b["moves"]:
        assert {"out", "in", "delta_xp", "cost_change"}.issubset(move.keys())
