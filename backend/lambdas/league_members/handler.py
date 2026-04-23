"""Read API — GET /league/{leagueId}/members.

Returns the members of an FPL classic league so clients can bulk-import
friends without typing every team ID. FPL's upstream endpoint
(``/leagues-classic/{id}/standings/``) wraps members inside a nested
``standings.results`` array and includes a chunky ``new_entries`` feed we
don't need — we flatten to a tight ``members`` list and surface the
league's id + name separately.

Pagination: FPL paginates 50 members per page. MVP fetches only page 1
and sets ``has_more`` when the upstream reports additional pages. Worth
following up on if friends use leagues larger than 50.

Cache-aside, matching the other read endpoints:

- Cache key: pk=league#{id}, sk=latest
- Logical freshness via ``expires_at``; physical ``ttl`` for DDB's
  native TTL sweep.
- Schema-version mismatch treated as a cache miss.
- 404 from FPL -> 404 to client; other upstream failures -> 502.
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

from schemas import (
    SCHEMA_VERSION,
    LeagueInfo,
    LeagueMember,
    LeagueStandings,
)

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
DEFAULT_TTL_SECONDS = 1800  # 30 min


class LeagueNotFound(Exception):
    """FPL returned 404 for this league id."""


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


def _parse_league_id(event: dict[str, Any]) -> int | None:
    params = event.get("pathParameters") or {}
    raw = params.get("leagueId")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def _cache_key(league_id: int) -> dict[str, str]:
    return {"pk": f"league#{league_id}", "sk": "latest"}


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


def _fetch_standings(
    session: requests.Session, league_id: int,
) -> dict[str, Any]:
    url = f"{FPL_BASE_URL}/leagues-classic/{league_id}/standings/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise LeagueNotFound(league_id)
    response.raise_for_status()
    return response.json()


def _flatten_raw(raw: dict[str, Any]) -> LeagueStandings:
    """FPL's shape:
        {league: {id, name, ...},
         standings: {has_next, page, results: [{entry, entry_name, player_name, rank, total, ...}]}}
    We keep only what clients need to import friends.
    """
    league_raw = raw.get("league") or {}
    standings = raw.get("standings") or {}
    results = standings.get("results") or []

    members = [
        LeagueMember(
            entry=int(r["entry"]),
            entry_name=str(r.get("entry_name") or ""),
            player_name=str(r.get("player_name") or ""),
            rank=int(r.get("rank") or 0),
            total=int(r.get("total") or 0),
        )
        for r in results
        # Defensive: skip any result that doesn't have an entry id.
        if r.get("entry") is not None
    ]
    return LeagueStandings(
        league=LeagueInfo(
            id=int(league_raw.get("id") or 0),
            name=str(league_raw.get("name") or ""),
        ),
        members=members,
        has_more=bool(standings.get("has_next") or False),
    )


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
    raw = os.environ.get("LEAGUE_TTL_SECONDS")
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return value if value > 0 else DEFAULT_TTL_SECONDS


def _put_cache(
    table: Any,
    league_id: int,
    standings: LeagueStandings,
    now: float,
    ttl_seconds: int,
) -> int:
    expires_at = int(now) + ttl_seconds
    table.put_item(
        Item={
            **_cache_key(league_id),
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            "ttl": expires_at,
            "data": standings.model_dump(),
        }
    )
    return expires_at


def _build_response_body(
    data: dict[str, Any], cache: str, fetched_at: int | None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "league": data.get("league") or {},
        "members": data.get("members") or [],
        "has_more": bool(data.get("has_more") or False),
        "fetched_at": fetched_at,
        "cache": cache,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    league_id = _parse_league_id(event)
    if league_id is None:
        return _response(400, {"error": "invalid league id — must be a positive integer"})

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    cached = table.get_item(Key=_cache_key(league_id)).get("Item")
    if cached and _is_fresh(cached):
        return _response(200, _build_response_body(
            cached["data"],
            cache="hit",
            fetched_at=cached.get("fetched_at"),
        ))

    try:
        raw = _fetch_standings(_make_session(), league_id)
    except LeagueNotFound:
        log.info("FPL reports league %s not found", league_id)
        return _response(404, {"error": "league not found", "league_id": league_id})
    except requests.RequestException:
        log.exception("FPL league standings fetch failed for %s", league_id)
        return _response(502, {"error": "upstream error"})

    standings = _flatten_raw(raw)
    now = time.time()
    _put_cache(table, league_id, standings, now, _ttl_seconds())

    return _response(200, _build_response_body(
        standings.model_dump(),
        cache="miss",
        fetched_at=int(now),
    ))
