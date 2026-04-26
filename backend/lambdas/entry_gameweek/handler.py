"""Read API — GET /entry/{teamId}/gameweek/{gw}.

Cache-aside for per-team, per-gameweek picks. Like /entry/{teamId}, there are
too many (team, gameweek) pairs to pre-ingest — fetch on demand, cache with a
TTL, serve from cache while fresh.

The response flattens what FPL returns into a small, client-friendly shape:
the 15-pick squad, the captain/vice element IDs (lifted out of the picks
flags for convenience), and the gameweek's points + bank/value snapshot.

TTL handling mirrors /entry/{teamId}:

- Logical freshness check via ``expires_at`` on every read, so stale items
  are never served even if DDB hasn't swept them yet.
- Physical ``ttl`` attribute for DDB's native TTL feature to eventually GC.

Schema-version mismatches are treated as a cache miss and re-fetched — we can
always recover from FPL directly.
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

from fpl_session import make_fpl_session

from schemas import SCHEMA_VERSION, EntryPicks

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
DEFAULT_TTL_SECONDS = 1800  # 30 min


class PicksNotFound(Exception):
    """FPL returned 404 for this (team, gameweek) pair."""


def _json_default(o: Any) -> Any:
    # DynamoDB's resource API returns numeric attributes as decimal.Decimal,
    # which the default json encoder can't serialize. Convert to int when the
    # value is a whole number, otherwise float.
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=_json_default),
    }


def _parse_path(event: dict[str, Any]) -> tuple[int | None, int | None]:
    params = event.get("pathParameters") or {}
    team_id = _parse_positive_int(params.get("teamId"))
    gw = _parse_positive_int(params.get("gw"))
    return team_id, gw


def _parse_positive_int(raw: Any) -> int | None:
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def _cache_key(team_id: int, gw: int) -> dict[str, str]:
    return {"pk": f"entry#{team_id}#gw#{gw}", "sk": "latest"}


def _fetch_picks(
    session: requests.Session, team_id: int, gw: int,
) -> dict[str, Any]:
    url = f"{FPL_BASE_URL}/entry/{team_id}/event/{gw}/picks/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise PicksNotFound(team_id, gw)
    response.raise_for_status()
    return response.json()


def _is_fresh(item: dict[str, Any]) -> bool:
    if item.get("schema_version") != SCHEMA_VERSION:
        return False
    expires_at = item.get("expires_at")
    if expires_at is None:
        return False
    try:
        deadline = float(expires_at)
    except (TypeError, ValueError):
        return False
    return time.time() < deadline


def _ttl_seconds() -> int:
    raw = os.environ.get("PICKS_TTL_SECONDS")
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return value if value > 0 else DEFAULT_TTL_SECONDS


def _put_cache(
    table: Any,
    team_id: int,
    gw: int,
    picks: EntryPicks,
    now: float,
    ttl_seconds: int,
) -> int:
    expires_at = int(now) + ttl_seconds
    table.put_item(
        Item={
            **_cache_key(team_id, gw),
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            # `ttl` is the attribute DynamoDB's native TTL feature watches.
            "ttl": expires_at,
            "data": picks.model_dump(),
        }
    )
    return expires_at


def _build_response_body(
    data: dict[str, Any],
    team_id: int,
    gw: int,
    cache: str,
    fetched_at: int | None,
) -> dict[str, Any]:
    picks = data.get("picks") or []
    captain = next(
        (p["element"] for p in picks if p.get("is_captain")),
        None,
    )
    vice_captain = next(
        (p["element"] for p in picks if p.get("is_vice_captain")),
        None,
    )
    history = data.get("entry_history") or {}
    return {
        "schema_version": SCHEMA_VERSION,
        "entry": {
            "team_id": team_id,
            "gameweek": gw,
            "points": history.get("points"),
            "total_points": history.get("total_points"),
            "bank": history.get("bank"),
            "value": history.get("value"),
            "event_transfers": history.get("event_transfers"),
            "event_transfers_cost": history.get("event_transfers_cost"),
            "points_on_bench": history.get("points_on_bench"),
            "active_chip": data.get("active_chip"),
            "captain": captain,
            "vice_captain": vice_captain,
            "squad": picks,
        },
        "fetched_at": fetched_at,
        "cache": cache,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    team_id, gw = _parse_path(event)
    if team_id is None or gw is None:
        return _response(400, {"error": "invalid path — need positive team id and gameweek"})

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    cached = table.get_item(Key=_cache_key(team_id, gw)).get("Item")
    if cached and _is_fresh(cached):
        return _response(
            200,
            _build_response_body(
                cached["data"],
                team_id,
                gw,
                cache="hit",
                fetched_at=cached.get("fetched_at"),
            ),
        )

    try:
        raw = _fetch_picks(make_fpl_session(), team_id, gw)
    except PicksNotFound:
        log.info("FPL reports picks not found for team %s gw %s", team_id, gw)
        return _response(
            404,
            {"error": "picks not found", "team_id": team_id, "gameweek": gw},
        )
    except requests.RequestException:
        log.exception("FPL picks fetch failed for team %s gw %s", team_id, gw)
        return _response(502, {"error": "upstream error"})

    picks = EntryPicks.model_validate(raw)
    now = time.time()
    _put_cache(table, team_id, gw, picks, now, _ttl_seconds())

    return _response(
        200,
        _build_response_body(
            picks.model_dump(),
            team_id,
            gw,
            cache="miss",
            fetched_at=int(now),
        ),
    )
