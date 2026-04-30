"""Read API — GET /analytics/squad/{teamId}/transfers.

On-demand FT-aware multi-transfer suggestions for the user's squad.
Returns a ranked list of *bundles* — each is a 1-, 2-, or 3-move
package, scored by net delta-xP across the requested horizon after
subtracting the FT-aware hit cost (4 pts per transfer beyond the user's
free count). A 2-move bundle that requires a hit only beats a 1-move
free bundle if its gross gain outweighs the −4.

Query params:
- ``horizon=N`` — GWs to sum xP over (default 3, clamped to MAX_HORIZON)
- ``positions=2,3`` — restrict to FPL element_type set
- ``max_transfers=N`` — bundle size ceiling (default 2, clamped to
  MAX_BUNDLE_SIZE = 3)
- ``free_transfers=N`` — override the FT count derived from FPL history.
  Mostly for testing; production calls omit it and rely on derivation.

Inputs (from DDB cache, with cache-aside FPL fetches for per-team data):
- entry#{teamId}                — bank + current_event (cache-aside)
- entry#{teamId}#gw#{event}     — the 15 picks (cache-aside)
- entry#{teamId}#history        — per-GW transfers + chips for FT walk
                                  (cache-aside)
- fpl#bootstrap                 — players, positions, teams, gameweeks
- fpl#fixtures                  — upcoming fixtures + difficulty
- analytics#player_form rows    — form_score per player (xP input)
- analytics#player_xp_v2 rows   — pre-computed horizon xP

Approximations (documented for the smoke tester so the output isn't
mysterious):
- Buy and sell prices both use ``now_cost``. Real FPL keeps half of any
  appreciation as the sell price; we don't have purchase prices without
  FPL auth, and the delta-xP ranking is robust to small budget noise.
- FT derivation walks the public history endpoint and applies 25/26
  rules (banked cap of 5, Wildcard/Free Hit preserve FTs). Doesn't
  account for transfers made *during* the current GW lead-up that
  haven't landed in history yet — typical staleness is < 30 min via
  the cache TTL.
"""
from __future__ import annotations

import json
import logging
import os
import time
from decimal import Decimal
from typing import Any

import boto3
import requests
from boto3.dynamodb.conditions import Key

from compute import (
    MAX_BUNDLE_SIZE,
    TransferBundle,
    derive_free_transfers,
    suggest_transfer_bundles,
)
from fpl_session import make_fpl_session
from schemas import (
    SCHEMA_VERSION,
    Bootstrap,
    Entry,
    EntryFullHistory,
    EntryPicks,
    Fixture,
)
from v2_horizon import read_v2_horizon_xps
from xp_compute import upcoming_gameweek_ids

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
ENTRY_TTL_SECONDS = 1800  # 30 min, matches /entry/{teamId}
PICKS_TTL_SECONDS = 1800
HISTORY_TTL_SECONDS = 1800

DEFAULT_HORIZON = 3
MAX_HORIZON = 5
DEFAULT_MAX_TRANSFERS = 2
TOP_N = 10
# Conservative fallback when FT derivation fails (history fetch failed,
# malformed response, etc.). Charging 1 FT means we'll over-charge hits
# in some cases, which is the safer direction — better to under-promise
# and let users execute fewer transfers than to mislead them into hits
# they thought were free.
FALLBACK_FREE_TRANSFERS = 1


class EntryNotFound(Exception):
    pass


class PicksNotFound(Exception):
    pass


def _json_default(o: Any) -> Any:
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=_json_default),
    }


def _parse_team_id(event: dict[str, Any]) -> int | None:
    params = event.get("pathParameters") or {}
    raw = params.get("teamId")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def _parse_horizon(event: dict[str, Any]) -> int:
    params = event.get("queryStringParameters") or {}
    raw = params.get("horizon") if isinstance(params, dict) else None
    if not isinstance(raw, str) or not raw.isdigit():
        return DEFAULT_HORIZON
    value = int(raw)
    if value <= 0:
        return DEFAULT_HORIZON
    return min(value, MAX_HORIZON)


def _parse_max_transfers(event: dict[str, Any]) -> int:
    """``?max_transfers=N`` → bundle size ceiling. Defaults to
    DEFAULT_MAX_TRANSFERS (2). Clamped to MAX_BUNDLE_SIZE (3) to keep
    the combinatorial search inside the Lambda timeout."""
    params = event.get("queryStringParameters") or {}
    raw = params.get("max_transfers") if isinstance(params, dict) else None
    if not isinstance(raw, str) or not raw.isdigit():
        return DEFAULT_MAX_TRANSFERS
    value = int(raw)
    if value <= 0:
        return DEFAULT_MAX_TRANSFERS
    return min(value, MAX_BUNDLE_SIZE)


def _parse_free_transfers(event: dict[str, Any]) -> int | None:
    """``?free_transfers=N`` → override the FT count derived from FPL
    history. Returns ``None`` when absent so the handler falls back to
    derivation. Mostly for testing — production callers shouldn't pass it.
    Negative values are silently dropped (treated as absent)."""
    params = event.get("queryStringParameters") or {}
    raw = params.get("free_transfers") if isinstance(params, dict) else None
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value >= 0 else None


# FPL element_type values: 1=GKP, 2=DEF, 3=MID, 4=FWD. We don't validate
# membership beyond "positive int" — an unknown value just yields zero
# matches downstream, which is the same effect as filtering nothing.
def _parse_positions(event: dict[str, Any]) -> set[int] | None:
    """Parse ``?positions=2,3,4`` into a set of FPL element_type ints.

    Returns ``None`` to mean "no filter" — which is distinct from an
    empty set (which would mean "filter to nothing, return zero
    suggestions"). An empty/missing query param parses as None so the
    default behaviour is unchanged.
    """
    params = event.get("queryStringParameters") or {}
    raw = params.get("positions") if isinstance(params, dict) else None
    if not isinstance(raw, str) or not raw.strip():
        return None
    out: set[int] = set()
    for token in raw.split(","):
        token = token.strip()
        if token.isdigit():
            value = int(token)
            if value > 0:
                out.add(value)
    return out if out else None


def _is_fresh(item: dict[str, Any]) -> bool:
    if item.get("schema_version") != SCHEMA_VERSION:
        return False
    expires_at = item.get("expires_at")
    if expires_at is None:
        return False
    try:
        return time.time() < float(expires_at)
    except (TypeError, ValueError):
        return False


def _fetch_entry_with_cache(
    table: Any,
    session: requests.Session,
    team_id: int,
) -> Entry:
    cached = table.get_item(
        Key={"pk": f"entry#{team_id}", "sk": "latest"}
    ).get("Item")
    if cached and _is_fresh(cached):
        return Entry.model_validate(cached["data"])

    url = f"{FPL_BASE_URL}/entry/{team_id}/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise EntryNotFound(team_id)
    response.raise_for_status()
    entry = Entry.model_validate(response.json())

    now = time.time()
    expires_at = int(now) + ENTRY_TTL_SECONDS
    table.put_item(
        Item={
            "pk": f"entry#{team_id}",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            "ttl": expires_at,
            "data": entry.model_dump(),
        }
    )
    return entry


def _fetch_history_with_cache(
    table: Any,
    session: requests.Session,
    team_id: int,
) -> EntryFullHistory:
    """Fetch ``/entry/{teamId}/history/`` with cache-aside semantics
    (same TTL pattern as entry/picks). Provides per-GW transfer counts
    and chip activations for the FT-derivation walk."""
    cached = table.get_item(
        Key={"pk": f"entry#{team_id}#history", "sk": "latest"}
    ).get("Item")
    if cached and _is_fresh(cached):
        return EntryFullHistory.model_validate(cached["data"])

    url = f"{FPL_BASE_URL}/entry/{team_id}/history/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise EntryNotFound(team_id)
    response.raise_for_status()
    history = EntryFullHistory.model_validate(response.json())

    now = time.time()
    expires_at = int(now) + HISTORY_TTL_SECONDS
    table.put_item(
        Item={
            "pk": f"entry#{team_id}#history",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            "ttl": expires_at,
            "data": history.model_dump(),
        }
    )
    return history


def _fetch_picks_with_cache(
    table: Any,
    session: requests.Session,
    team_id: int,
    gw: int,
) -> EntryPicks:
    cached = table.get_item(
        Key={"pk": f"entry#{team_id}#gw#{gw}", "sk": "latest"}
    ).get("Item")
    if cached and _is_fresh(cached):
        return EntryPicks.model_validate(cached["data"])

    url = f"{FPL_BASE_URL}/entry/{team_id}/event/{gw}/picks/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise PicksNotFound(team_id, gw)
    response.raise_for_status()
    picks = EntryPicks.model_validate(response.json())

    now = time.time()
    expires_at = int(now) + PICKS_TTL_SECONDS
    table.put_item(
        Item={
            "pk": f"entry#{team_id}#gw#{gw}",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            "ttl": expires_at,
            "data": picks.model_dump(),
        }
    )
    return picks


def _read_player_forms(table: Any) -> dict[int, dict[str, float | None]]:
    """Per-player snapshot of the form analyzer's output, keyed by id.

    Each snapshot carries the fields the suggestions screen surfaces:
    `form_score` (always populated by the analyzer), plus the two
    fixture-quality signals which can be ``None`` when the upcoming
    fixtures are missing FPL difficulty values or ClubELO ratings.
    """
    snapshots: dict[int, dict[str, float | None]] = {}
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_form"),
        "ProjectionExpression": (
            "sk, form_score, avg_upcoming_difficulty, "
            "avg_upcoming_elo_expected_score"
        ),
    }
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            try:
                pid = int(item["sk"])
                snapshots[pid] = {
                    "form_score": float(item["form_score"]),
                    "avg_upcoming_difficulty": _opt_float(
                        item.get("avg_upcoming_difficulty")
                    ),
                    "avg_upcoming_elo_expected_score": _opt_float(
                        item.get("avg_upcoming_elo_expected_score")
                    ),
                }
            except (KeyError, ValueError, TypeError):
                log.warning("Skipping malformed player_form row: %r", item)
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return snapshots


def _opt_float(value: Any) -> float | None:
    """DDB-side numeric values arrive as Decimal (or None). Normalise to
    float for the JSON response, preserving null."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _enriched_player(
    player_id: int,
    by_id: dict[int, Any],
    horizon_xps: dict[int, float],
    snapshots: dict[int, dict[str, float | None]],
) -> dict[str, Any]:
    p = by_id[player_id]
    snap = snapshots.get(player_id, {})
    avg_diff = snap.get("avg_upcoming_difficulty")
    avg_elo = snap.get("avg_upcoming_elo_expected_score")
    form = snap.get("form_score")
    return {
        "player_id": player_id,
        "web_name": p.web_name,
        "team_id": p.team,
        "position_id": p.element_type,
        "now_cost": p.now_cost,
        "horizon_xp": round(horizon_xps.get(player_id, 0.0), 4),
        # Fixture-quality signals surfaced for the expand-on-tap card
        # (#97). All three are nullable: a player whose form analyzer
        # row is missing (new arrival, ingest race) gets ``None`` here
        # rather than zeroing out the value, so the UI can render "—"
        # instead of misleading numbers.
        "form_score": None if form is None else round(form, 4),
        "avg_upcoming_difficulty": (
            None if avg_diff is None else round(avg_diff, 4)
        ),
        "avg_upcoming_elo_expected_score": (
            None if avg_elo is None else round(avg_elo, 4)
        ),
    }


def _bundle_to_dict(
    bundle: TransferBundle,
    by_id: dict[int, Any],
    horizon_xps: dict[int, float],
    snapshots: dict[int, dict[str, float | None]],
) -> dict[str, Any]:
    return {
        "moves": [
            {
                "out": _enriched_player(
                    move.out_player_id, by_id, horizon_xps, snapshots
                ),
                "in": _enriched_player(
                    move.in_player_id, by_id, horizon_xps, snapshots
                ),
                "delta_xp": round(move.delta_xp, 4),
                "cost_change": move.cost_change,
            }
            for move in bundle.moves
        ],
        "num_transfers": bundle.num_transfers,
        "hit_cost": bundle.hit_cost,
        "delta_xp_gross": round(bundle.delta_xp_gross, 4),
        "delta_xp_net": round(bundle.delta_xp_net, 4),
        "total_cost_change": bundle.total_cost_change,
    }


def _empty_response(
    team_id: int,
    *,
    season_over: bool,
    preseason: bool,
    free_transfers: int,
    max_transfers: int,
    freehit_active: bool = False,
) -> dict[str, Any]:
    return _response(
        200,
        {
            "team_id": team_id,
            "horizon_gws": 0,
            "horizon_gw_ids": [],
            "season_over": season_over,
            "preseason": preseason,
            "free_transfers": free_transfers,
            "max_transfers_considered": max_transfers,
            "freehit_active": freehit_active,
            "bundles": [],
        },
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    team_id = _parse_team_id(event)
    if team_id is None:
        return _response(400, {"error": "invalid team id"})
    horizon = _parse_horizon(event)
    position_filter = _parse_positions(event)
    max_transfers = _parse_max_transfers(event)
    free_transfers_override = _parse_free_transfers(event)

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)
    session = make_fpl_session()

    try:
        entry = _fetch_entry_with_cache(table, session, team_id)
    except EntryNotFound:
        return _response(
            404, {"error": "entry not found", "team_id": team_id}
        )
    except requests.RequestException:
        log.exception("FPL entry fetch failed for team %s", team_id)
        return _response(502, {"error": "upstream error"})

    # FT derivation: walks history applying 25/26 banking rules. Falls
    # back to FALLBACK_FREE_TRANSFERS on history fetch failure (over-
    # charging hits is safer than under-charging — see the constant's
    # comment). Override path skips derivation entirely.
    if free_transfers_override is not None:
        free_transfers = free_transfers_override
    else:
        try:
            history = _fetch_history_with_cache(table, session, team_id)
            free_transfers = derive_free_transfers(history.current, history.chips)
        except (EntryNotFound, requests.RequestException, Exception):
            log.exception(
                "FT derivation failed for team %s, falling back to %d",
                team_id, FALLBACK_FREE_TRANSFERS,
            )
            free_transfers = FALLBACK_FREE_TRANSFERS

    if entry.current_event is None:
        # Pre-season: user hasn't played a GW yet, so no picks to read.
        return _empty_response(
            team_id, season_over=False, preseason=True,
            free_transfers=free_transfers, max_transfers=max_transfers,
        )

    try:
        picks = _fetch_picks_with_cache(
            table, session, team_id, entry.current_event
        )
    except PicksNotFound:
        return _response(
            404,
            {
                "error": "picks not found",
                "team_id": team_id,
                "gameweek": entry.current_event,
            },
        )
    except requests.RequestException:
        log.exception(
            "FPL picks fetch failed for team %s gw %s",
            team_id,
            entry.current_event,
        )
        return _response(502, {"error": "upstream error"})

    # Free Hit fallback: when FH is active in the current GW, the picks
    # endpoint returns the temporary FH eleven, not the persistent squad.
    # Transfer suggestions against the FH squad are useless because that
    # squad reverts at the next deadline — the user wants moves for their
    # *real* team. Refetch picks for ``current_event - 1`` and use those
    # as the squad. Mirrors the same fallback in fetchMyTeam on mobile.
    # Surface ``freehit_active`` so the UI can label the suggestion list.
    freehit_active = picks.active_chip == "freehit"
    if freehit_active and entry.current_event > 1:
        try:
            picks = _fetch_picks_with_cache(
                table, session, team_id, entry.current_event - 1
            )
        except (PicksNotFound, requests.RequestException):
            # Couldn't get the previous-GW picks — degrade silently to
            # the FH temporary squad. Recommendations will be off, but
            # ``freehit_active`` still tells mobile to surface a banner.
            log.warning(
                "Free Hit fallback failed for team %s — using FH squad",
                team_id,
            )

    bootstrap_item = table.get_item(
        Key={"pk": "fpl#bootstrap", "sk": "latest"}
    ).get("Item")
    if not bootstrap_item:
        raise RuntimeError("fpl#bootstrap / latest missing — has ingest run?")
    bootstrap = Bootstrap.model_validate(bootstrap_item["data"])

    fixtures_item = table.get_item(
        Key={"pk": "fpl#fixtures", "sk": "latest"}
    ).get("Item")
    if not fixtures_item:
        raise RuntimeError("fpl#fixtures / latest missing — has ingest run?")
    fixtures = [Fixture.model_validate(f) for f in fixtures_item["data"]]

    horizon_gw_ids = upcoming_gameweek_ids(bootstrap.gameweeks, horizon)
    if not horizon_gw_ids:
        # Post-final-deadline: nothing left to score.
        return _empty_response(
            team_id, season_over=True, preseason=False,
            free_transfers=free_transfers, max_transfers=max_transfers,
            freehit_active=freehit_active,
        )

    # player_form rows drive the per-card UI fields (form_score,
    # avg_upcoming_difficulty, avg_upcoming_elo_expected_score). Mobile's
    # expand-on-tap card relies on these even though horizon_xp is now
    # sourced from the v2 analytics rows.
    snapshots = _read_player_forms(table)
    if not snapshots:
        raise RuntimeError(
            "analytics#player_form rows missing — has the form analyzer run?"
        )

    by_id = {p.id: p for p in bootstrap.players}
    horizon_xps = read_v2_horizon_xps(
        table=table, horizon_gw_ids=horizon_gw_ids,
    )
    if not horizon_xps:
        # The v2 writer is upstream of this read. No rows means
        # analyze_player_xp_v2 hasn't run yet (fresh deploy, or its
        # nightly schedule hasn't fired). Fail loud — better than
        # serving zero-ranked suggestions.
        raise RuntimeError(
            "analytics#player_xp_v2 rows missing — has analyze_player_xp_v2 run?"
        )

    squad_ids = [pick.element for pick in picks.picks]
    squad = [by_id[pid] for pid in squad_ids if pid in by_id]
    if len(squad) != len(squad_ids):
        log.warning(
            "Squad has %d picks, %d resolved from bootstrap — id drift?",
            len(squad_ids),
            len(squad),
        )

    # Position filter applies to BOTH sides of every swap. FPL's same-
    # position rule (enforced inside the bundle compute) means a swap is
    # always position(out) == position(in), so filtering both squad and
    # candidate pool to the same set yields the right answer naturally.
    if position_filter is not None:
        squad = [p for p in squad if p.element_type in position_filter]
        candidate_pool = [
            p for p in bootstrap.players if p.element_type in position_filter
        ]
    else:
        candidate_pool = bootstrap.players

    bundles = suggest_transfer_bundles(
        squad=squad,
        bank=entry.last_deadline_bank or 0,
        candidate_pool=candidate_pool,
        horizon_xps=horizon_xps,
        free_transfers=free_transfers,
        max_transfers=max_transfers,
        top_n=TOP_N,
    )

    return _response(
        200,
        {
            "team_id": team_id,
            "horizon_gws": len(horizon_gw_ids),
            "horizon_gw_ids": horizon_gw_ids,
            "season_over": False,
            "preseason": False,
            "free_transfers": free_transfers,
            "max_transfers_considered": max_transfers,
            "freehit_active": freehit_active,
            "current_squad_xp": round(
                sum(horizon_xps.get(pid, 0.0) for pid in squad_ids), 4
            ),
            "bundles": [
                _bundle_to_dict(b, by_id, horizon_xps, snapshots)
                for b in bundles
            ],
        },
    )
