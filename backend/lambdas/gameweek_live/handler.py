"""Read API — GET /gameweek/{gw}/live.

Returns per-player points and minutes for a given gameweek. FPL's upstream
endpoint (``/event/{gw}/live/``) returns a nested structure per element with
a full per-stat breakdown; we flatten it to just the fields we need
(id + total_points + minutes) so mobile clients don't have to walk the
bonus/goals/assists tree. That keeps the cached payload small and lets us
add more stats later without a breaking change.

Cache-aside with a configurable TTL, mirroring /entry/{id}/gameweek/{gw}:

- Cache key: pk=gameweek#{gw}#live, sk=latest
- Logical freshness check via ``expires_at`` on every read so stale items
  are never served.
- Physical ``ttl`` attribute for DDB's native TTL feature (eventual GC).
- Schema-version mismatch treated as a miss; we can always recover from FPL.
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
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from schemas import SCHEMA_VERSION, GameweekLive, GameweekLiveElement

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
DEFAULT_TTL_SECONDS = 1800  # 30 min


class GameweekLiveNotFound(Exception):
    """FPL returned 404 for this gameweek."""


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


def _parse_gw(event: dict[str, Any]) -> int | None:
    params = event.get("pathParameters") or {}
    raw = params.get("gw")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def _cache_key(gw: int) -> dict[str, str]:
    return {"pk": f"gameweek#{gw}#live", "sk": "latest"}


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


def _fetch_live(session: requests.Session, gw: int) -> dict[str, Any]:
    url = f"{FPL_BASE_URL}/event/{gw}/live/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise GameweekLiveNotFound(gw)
    response.raise_for_status()
    return response.json()


def _flatten_raw(raw: dict[str, Any]) -> GameweekLive:
    """FPL returns ``{elements: [{id, stats: {total_points, minutes, ...}, explain: [...]}]}``.
    We only keep id + total_points + minutes, dropping the nested stats dict
    and the `explain` breakdown."""
    elements = []
    for el in raw.get("elements") or []:
        stats = el.get("stats") or {}
        elements.append(GameweekLiveElement(
            id=el["id"],
            total_points=int(stats.get("total_points") or 0),
            minutes=int(stats.get("minutes") or 0),
        ))
    return GameweekLive(elements=elements)


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
    raw = os.environ.get("GAMEWEEK_LIVE_TTL_SECONDS")
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return value if value > 0 else DEFAULT_TTL_SECONDS


def _put_cache(
    table: Any, gw: int, live: GameweekLive, now: float, ttl_seconds: int,
) -> int:
    expires_at = int(now) + ttl_seconds
    table.put_item(
        Item={
            **_cache_key(gw),
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            "ttl": expires_at,
            "data": live.model_dump(),
        }
    )
    return expires_at


def _build_response_body(
    data: dict[str, Any], gw: int, cache: str, fetched_at: int | None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "gameweek": gw,
        "elements": data.get("elements") or [],
        "fetched_at": fetched_at,
        "cache": cache,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    gw = _parse_gw(event)
    if gw is None:
        return _response(400, {"error": "invalid gameweek — must be a positive integer"})

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    cached = table.get_item(Key=_cache_key(gw)).get("Item")
    if cached and _is_fresh(cached):
        return _response(200, _build_response_body(
            cached["data"], gw,
            cache="hit",
            fetched_at=cached.get("fetched_at"),
        ))

    try:
        raw = _fetch_live(_make_session(), gw)
    except GameweekLiveNotFound:
        log.info("FPL reports gameweek %s live data not found", gw)
        return _response(404, {"error": "gameweek not found", "gameweek": gw})
    except requests.RequestException:
        log.exception("FPL gameweek live fetch failed for gw %s", gw)
        return _response(502, {"error": "upstream error"})

    live = _flatten_raw(raw)
    now = time.time()
    _put_cache(table, gw, live, now, _ttl_seconds())

    return _response(200, _build_response_body(
        live.model_dump(), gw,
        cache="miss",
        fetched_at=int(now),
    ))
