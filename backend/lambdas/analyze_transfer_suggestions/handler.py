"""Read API — GET /analytics/squad/{teamId}/transfers?horizon=N.

On-demand single-transfer suggestions for the user's squad. Computes at
request time rather than pre-computing on a schedule: per-user output,
not pre-storing means we don't accumulate per-team rows or run a daily
scan over every cached entry.

For each player in the user's 15, considers every PL player who would
be a valid swap (same position, budget fits, 3-per-team rule satisfied,
not already in squad), scores the swap by projected delta-xP across the
next N gameweeks, and returns the top 10 ranked descending.

Inputs (from DDB cache, with cache-aside FPL fetches for per-team data):
- entry#{teamId}                — bank + current_event (cache-aside)
- entry#{teamId}#gw#{event}     — the 15 picks (cache-aside)
- fpl#bootstrap                 — players, positions, teams, gameweeks
- fpl#fixtures                  — upcoming fixtures + difficulty
- analytics#player_form rows    — form_score per player (xP input)

Approximations (documented for the smoke tester so the output isn't
mysterious):
- Buy and sell prices both use ``now_cost``. Real FPL keeps half of any
  appreciation as the sell price; we don't have purchase prices without
  FPL auth, and the delta-xP ranking is robust to small budget noise.
- Free-transfer count is ignored. Output is a ranked list; the user
  applies their own FT count + hit calculus.
- Single-transfer only. Multi-transfer combos (banked FTs, hit math)
  are deliberately deferred — see follow-up issue.
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
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from compute import TransferCandidate, suggest_transfers
from schemas import SCHEMA_VERSION, Bootstrap, Entry, EntryPicks, Fixture
from xp_compute import horizon_xp, upcoming_gameweek_ids

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
ENTRY_TTL_SECONDS = 1800  # 30 min, matches /entry/{teamId}
PICKS_TTL_SECONDS = 1800

DEFAULT_HORIZON = 3
MAX_HORIZON = 5
TOP_N = 10


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


def _make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset({"GET"}),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


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


def _read_player_forms(table: Any) -> dict[int, float]:
    """{player_id: form_score} from the player-form analyzer's output."""
    forms: dict[int, float] = {}
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_form"),
        "ProjectionExpression": "sk, form_score",
    }
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            try:
                forms[int(item["sk"])] = float(item["form_score"])
            except (KeyError, ValueError, TypeError):
                log.warning("Skipping malformed player_form row: %r", item)
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return forms


def _enriched_player(
    player_id: int,
    by_id: dict[int, Any],
    horizon_xps: dict[int, float],
) -> dict[str, Any]:
    p = by_id[player_id]
    return {
        "player_id": player_id,
        "web_name": p.web_name,
        "team_id": p.team,
        "position_id": p.element_type,
        "now_cost": p.now_cost,
        "horizon_xp": round(horizon_xps.get(player_id, 0.0), 4),
    }


def _suggestion_to_dict(
    candidate: TransferCandidate,
    by_id: dict[int, Any],
    horizon_xps: dict[int, float],
) -> dict[str, Any]:
    return {
        "out": _enriched_player(candidate.out_player_id, by_id, horizon_xps),
        "in": _enriched_player(candidate.in_player_id, by_id, horizon_xps),
        "delta_xp": round(candidate.delta_xp, 4),
        "cost_change": candidate.cost_change,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    team_id = _parse_team_id(event)
    if team_id is None:
        return _response(400, {"error": "invalid team id"})
    horizon = _parse_horizon(event)

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)
    session = _make_session()

    try:
        entry = _fetch_entry_with_cache(table, session, team_id)
    except EntryNotFound:
        return _response(
            404, {"error": "entry not found", "team_id": team_id}
        )
    except requests.RequestException:
        log.exception("FPL entry fetch failed for team %s", team_id)
        return _response(502, {"error": "upstream error"})

    if entry.current_event is None:
        # Pre-season: user hasn't played a GW yet, so no picks to read.
        return _response(
            200,
            {
                "team_id": team_id,
                "horizon_gws": 0,
                "horizon_gw_ids": [],
                "season_over": False,
                "preseason": True,
                "suggestions": [],
            },
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
        return _response(
            200,
            {
                "team_id": team_id,
                "horizon_gws": 0,
                "horizon_gw_ids": [],
                "season_over": True,
                "preseason": False,
                "suggestions": [],
            },
        )

    forms = _read_player_forms(table)
    if not forms:
        raise RuntimeError(
            "analytics#player_form rows missing — has the form analyzer run?"
        )

    by_id = {p.id: p for p in bootstrap.players}
    horizon_xps: dict[int, float] = {}
    for player in bootstrap.players:
        form_score = forms.get(player.id, 0.0)
        horizon_xps[player.id] = horizon_xp(
            player, form_score, fixtures, horizon_gw_ids
        )

    squad_ids = [pick.element for pick in picks.picks]
    squad = [by_id[pid] for pid in squad_ids if pid in by_id]
    if len(squad) != len(squad_ids):
        log.warning(
            "Squad has %d picks, %d resolved from bootstrap — id drift?",
            len(squad_ids),
            len(squad),
        )

    candidates = suggest_transfers(
        squad=squad,
        bank=entry.last_deadline_bank or 0,
        candidate_pool=bootstrap.players,
        horizon_xps=horizon_xps,
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
            "current_squad_xp": round(
                sum(horizon_xps.get(pid, 0.0) for pid in squad_ids), 4
            ),
            "suggestions": [
                _suggestion_to_dict(c, by_id, horizon_xps) for c in candidates
            ],
        },
    )
