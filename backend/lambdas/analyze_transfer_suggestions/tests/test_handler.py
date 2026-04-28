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
    """Default query mock — routes by partition so the v2 default path
    finds horizon rows and v1 still finds player_form rows. The
    `_query_pk` helper is defined further down with the v2-section
    helpers; importing that ordering wouldn't read well, so we use
    the same `get_expression()` shape inline here."""
    cond = kwargs.get("KeyConditionExpression")
    pk = ""
    if cond is not None:
        try:
            pk = cond.get_expression()["values"][1]
        except (AttributeError, KeyError, IndexError, TypeError):
            pk = ""
    if pk == "analytics#player_xp_v2":
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


def _event(team_id="12345", horizon=None, positions=None, model=None):
    qs: dict[str, str] | None = None
    if horizon is not None or positions is not None or model is not None:
        qs = {}
        if horizon is not None:
            qs["horizon"] = str(horizon)
        if positions is not None:
            qs["positions"] = positions
        if model is not None:
            qs["model"] = model
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
    """Hand-picked math, explicitly via the v1 path (post-Phase 7 the
    default is v2 and the form-based arithmetic below is v1-specific).

    Each fixture has difficulty 3 (easiness 0.6), every team plays
    exactly once each GW, all players are 'a' status.
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
    response = lambda_handler(_event(model="v1"), None)
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


def test_enriched_player_carries_form_and_fixture_signals(mock_table):
    """Each side of every suggestion exposes form_score, avg_upcoming_difficulty,
    and avg_upcoming_elo_expected_score so the mobile expand-on-tap card
    (#97) can render its comparison table without a second round-trip."""
    response = lambda_handler(_event(), None)
    body = _body(response)
    s = body["suggestions"][0]

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
        s for s in body["suggestions"]
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
             for s in body["suggestions"]}
    assert swaps == {(401, 503)}


def test_position_filter_fwd_returns_no_suggestions(mock_table):
    """positions=4 (FWD) -> squad has no FWD members, so no candidate
    swaps exist. Empty list, no crash."""
    body = _body(lambda_handler(_event(positions="4"), None))
    assert body["suggestions"] == []


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

    body = _body(lambda_handler(_event(positions="2,3"), None))
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in body["suggestions"]}
    # DEF: 401 -> 503; MID: 101 -> 502, 201 -> 502.
    assert (401, 503) in swaps
    assert (101, 502) in swaps
    assert (201, 502) in swaps
    # No GKP or FWD swaps even though they'd be valid otherwise — the
    # filter excludes positions 1 and 4 entirely.
    assert all(s["out"]["position_id"] in (2, 3) for s in body["suggestions"])


def test_position_filter_mid_only_with_bigger_bank(mock_table):
    """positions=3 (MID) with bank big enough — DEF swap excluded even
    though it would otherwise rank highly."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)
    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(positions="3"), None))
    assert all(s["out"]["position_id"] == 3 for s in body["suggestions"])
    swaps = {(s["out"]["player_id"], s["in"]["player_id"])
             for s in body["suggestions"]}
    assert (401, 503) not in swaps  # DEF swap excluded


def test_position_filter_invalid_falls_back_to_no_filter(mock_table):
    """positions=garbage -> parsed as None -> behaviour identical to
    omitting the param entirely. Same number of suggestions as the
    happy path."""
    body_filtered = _body(lambda_handler(_event(positions="not-numbers"), None))
    body_default = _body(lambda_handler(_event(), None))
    assert len(body_filtered["suggestions"]) == len(body_default["suggestions"])


def test_position_filter_unknown_positions_yields_empty(mock_table):
    """positions=99 -> parses to {99}, but no FPL element_type is 99,
    so squad and pool both filter to empty. Empty suggestions, no
    crash. (Distinct from invalid strings which fall back to None.)"""
    body = _body(lambda_handler(_event(positions="99"), None))
    assert body["suggestions"] == []


def test_position_filter_mixed_valid_and_garbage_keeps_valid(mock_table):
    """positions=2,not-a-number,3 -> valid tokens kept ({2, 3}), garbage
    skipped silently. Same effect as positions=2,3."""
    bigger_entry = {**ENTRY_CACHE, "last_deadline_bank": 50}

    def get_item(Key):
        if Key["pk"] == "entry#12345" and Key["sk"] == "latest":
            return {"Item": _cached_item(Key["pk"], Key["sk"], bigger_entry)}
        return _ddb_get_item_default(Key)
    mock_table.get_item.side_effect = get_item

    body = _body(lambda_handler(_event(positions="2,not-a-number,3"), None))
    assert all(s["out"]["position_id"] in (2, 3) for s in body["suggestions"])
    assert len(body["suggestions"]) > 0


# ---------------------------------------------------------------------------
# v2 model path
#
# Phase 7 (#118): default flipped to v2; v1 still served for ?model=v1
# during the soak window. v2 reads pre-computed horizon predictions from
# analytics#player_xp_v2 (one Query, ~100 ms) instead of scanning history
# rows + computing on the fly.
# ---------------------------------------------------------------------------


def _v2_xp_row(player_id: int, *, horizon_xp_by_gw: dict[int, str]) -> dict:
    """Mock row matching what analyze_player_xp_v2 writes — Phase 7 added
    the horizon_xp_by_gw map to the existing per-player record."""
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
    """Pull the pk value out of a `Key("pk").eq(...)` condition for
    routing the mocked query response. Uses `get_expression()` rather
    than the private `_values` attribute so this stays robust against
    boto3 internals changing."""
    cond = kwargs.get("KeyConditionExpression")
    if cond is None:
        return ""
    try:
        return cond.get_expression()["values"][1]
    except (AttributeError, KeyError, IndexError, TypeError):
        return ""


def _ddb_query_with_v2(**kwargs):
    """Returns v2 xp rows on a `pk = analytics#player_xp_v2` query, falls
    through to the v1 player_form rows otherwise."""
    if _query_pk(kwargs) == "analytics#player_xp_v2":
        return {"Items": V2_XP_ROWS}
    return {"Items": PLAYER_FORM_ROWS}


@pytest.fixture
def mock_table_v2_ready(mock_table):
    """Extend the base `mock_table` with v2 query routing — `query`
    returns v2 rows for analytics#player_xp_v2 and player_form rows
    otherwise. Default-model tests use this fixture; v1-only tests
    keep using mock_table and ignore the v2 partition."""
    mock_table.query.side_effect = _ddb_query_with_v2
    return mock_table


# parse_model edge cases — small, fast, document the contract.

def test_parse_model_default_is_v2(mock_table_v2_ready):
    """Phase 7 (#118): default flipped to v2. Clients without ?model=
    now get v2 numbers."""
    body = _body(lambda_handler(_event(), None))
    assert body["model"] == "v2"


def test_parse_model_v1_opt_out_still_works(mock_table_v2_ready):
    """?model=v1 keeps the legacy ranking. Reachable through the soak
    window so we can flip back if v2 misbehaves on real users."""
    body = _body(lambda_handler(_event(model="v1"), None))
    assert body["model"] == "v1"


def test_parse_model_v2_explicit_routes_to_v2(mock_table_v2_ready):
    """?model=v2 still works (now redundant with the default but
    forward-compatible with Phase 7-aware clients)."""
    body = _body(lambda_handler(_event(model="v2"), None))
    assert body["model"] == "v2"


def test_parse_model_unknown_value_falls_back_to_default(mock_table_v2_ready):
    """Stale clients sending ?model=v3 should degrade to the current
    default (v2 post-Phase 7)."""
    body = _body(lambda_handler(_event(model="v99"), None))
    assert body["model"] == "v2"


def test_parse_model_case_insensitive(mock_table_v2_ready):
    """Defensive: V1 / v1 / V2 / v2 all parse correctly."""
    body = _body(lambda_handler(_event(model="V1"), None))
    assert body["model"] == "v1"


# v2 happy path — reads pre-computed horizon and sums per request

def test_v2_path_sums_horizon_xp_by_gw(mock_table_v2_ready):
    """current_squad_xp = sum over (squad players × horizon GWs) of the
    pre-computed per-GW values. With horizon=3 (default), squad
    [101, 102, 201, 401] sums GWs 33+34+35:
        101: 5.0+5.5+6.0  = 16.5
        102: 3.0+3.0+3.0  =  9.0
        201: 7.5+7.0+7.5  = 22.0
        401: 1.5+1.5+1.5  =  4.5
        total            = 52.0
    """
    body = _body(lambda_handler(_event(), None))
    assert body["current_squad_xp"] == pytest.approx(52.0)


def test_v2_path_horizon_param_changes_sum(mock_table_v2_ready):
    """horizon=1 picks GW33 only; default horizon=3 picks GW33-35.
    The summed current_squad_xp scales with horizon size.

    Bootstrap has only 3 unfinished GWs, so horizon>3 clamps to 3 and
    yields the same sum — covered by test_horizon_clamps_to_remaining_season.
    """
    body_h1 = _body(lambda_handler(_event(horizon=1), None))
    body_default = _body(lambda_handler(_event(), None))
    # h=1: per-player GW33 → 5.0 + 3.0 + 7.5 + 1.5 = 17.0
    assert body_h1["current_squad_xp"] == pytest.approx(17.0)
    # default h=3: same as test_v2_path_sums_horizon_xp_by_gw above
    assert body_default["current_squad_xp"] == pytest.approx(52.0)
    assert body_h1["current_squad_xp"] < body_default["current_squad_xp"]


def test_v2_path_returns_response_in_same_shape(mock_table_v2_ready):
    """Wire shape parity between v1 and v2 — the Phase 7 default flip
    is a wire-no-op for mobile clients."""
    body_v1 = _body(lambda_handler(_event(model="v1"), None))
    body_v2 = _body(lambda_handler(_event(model="v2"), None))

    assert set(body_v1) == set(body_v2)
    if body_v1["suggestions"] and body_v2["suggestions"]:
        assert set(body_v1["suggestions"][0]) == set(body_v2["suggestions"][0])
        assert set(body_v1["suggestions"][0]["out"]) == set(
            body_v2["suggestions"][0]["out"]
        )


def test_v2_path_preserves_form_explainability_fields(mock_table_v2_ready):
    """Form / fixture / ELO fields still come from analytics#player_form
    under both models — UI is unchanged, only horizon_xp ranking switches."""
    body_v1 = _body(lambda_handler(_event(model="v1"), None))
    body_v2 = _body(lambda_handler(_event(model="v2"), None))
    if not body_v1["suggestions"] or not body_v2["suggestions"]:
        return
    for s_v1, s_v2 in zip(body_v1["suggestions"], body_v2["suggestions"]):
        for side in ("out", "in"):
            assert s_v1[side]["form_score"] == s_v2[side]["form_score"]
            assert (
                s_v1[side]["avg_upcoming_difficulty"]
                == s_v2[side]["avg_upcoming_difficulty"]
            )


def test_v2_path_missing_v2_xp_rows_raises(mock_table):
    """v2 reader is downstream of analyze_player_xp_v2. No rows means
    the writer hasn't run yet (fresh deploy). Fail loud — better than
    serving zero-ranked suggestions."""
    def query_side_effect(**kwargs):
        if _query_pk(kwargs) == "analytics#player_xp_v2":
            return {"Items": []}
        return {"Items": PLAYER_FORM_ROWS}
    mock_table.query.side_effect = query_side_effect

    with pytest.raises(RuntimeError, match="analytics#player_xp_v2"):
        lambda_handler(_event(model="v2"), None)


def test_v1_path_does_not_query_v2_partition(mock_table_v2_ready):
    """?model=v1 must not waste a Query on the v2 partition — the v1
    path is fully self-contained on player_form rows."""
    lambda_handler(_event(model="v1"), None)
    # Inspect every Query call: none of them should target v2.
    for call in mock_table_v2_ready.query.call_args_list:
        assert _query_pk(call.kwargs) != "analytics#player_xp_v2"
