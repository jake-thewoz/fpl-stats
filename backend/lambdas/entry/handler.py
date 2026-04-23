"""Read API — GET /entry/{teamId}.

Cache-aside for individual team entries. Team IDs number in the millions, so
we can't pre-ingest them like bootstrap/fixtures. On request: check DDB; on
miss or stale TTL, fetch FPL's ``/api/entry/{id}/``, validate with pydantic,
and write a TTL'd copy back.

TTL is enforced two ways:

- Logically, in this handler: we compare ``expires_at`` against ``time.time()``
  on every read so stale items are never served.
- Physically, via DynamoDB's native TTL feature on the ``ttl`` attribute.
  DDB sweeps expired items eventually (can take up to 48 hours), which keeps
  the table from growing unbounded. Existing cached items without ``ttl``
  (e.g. bootstrap, fixtures) are unaffected.

Schema-version mismatches are treated as a cache miss — we re-fetch rather
than 503'ing, because unlike the pre-warmed readers we can always recover
from FPL directly.
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

from schemas import SCHEMA_VERSION, Entry

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10
DEFAULT_TTL_SECONDS = 1800  # 30 min


class EntryNotFound(Exception):
    """FPL said this team ID doesn't exist."""


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


def _parse_team_id(event: dict[str, Any]) -> int | None:
    params = event.get("pathParameters") or {}
    raw = params.get("teamId")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def _cache_key(team_id: int) -> dict[str, str]:
    return {"pk": f"entry#{team_id}", "sk": "latest"}


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


def _fetch_entry(session: requests.Session, team_id: int) -> dict[str, Any]:
    url = f"{FPL_BASE_URL}/entry/{team_id}/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise EntryNotFound(team_id)
    response.raise_for_status()
    return response.json()


def _is_fresh(item: dict[str, Any]) -> bool:
    if item.get("schema_version") != SCHEMA_VERSION:
        return False
    expires_at = item.get("expires_at")
    if expires_at is None:
        return False
    # DynamoDB hands back Decimal for numeric attributes; coerce to float so
    # the comparison works regardless of what we got.
    try:
        deadline = float(expires_at)
    except (TypeError, ValueError):
        return False
    return time.time() < deadline


def _ttl_seconds() -> int:
    raw = os.environ.get("ENTRY_TTL_SECONDS")
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return value if value > 0 else DEFAULT_TTL_SECONDS


def _put_cache(
    table: Any, team_id: int, entry: Entry, now: float, ttl_seconds: int,
) -> int:
    expires_at = int(now) + ttl_seconds
    table.put_item(
        Item={
            **_cache_key(team_id),
            "schema_version": SCHEMA_VERSION,
            "fetched_at": int(now),
            "expires_at": expires_at,
            # `ttl` is the attribute DynamoDB's native TTL feature watches.
            "ttl": expires_at,
            "data": entry.model_dump(),
        }
    )
    return expires_at


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    team_id = _parse_team_id(event)
    if team_id is None:
        return _response(400, {"error": "invalid team id"})

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    cached = table.get_item(Key=_cache_key(team_id)).get("Item")
    if cached and _is_fresh(cached):
        return _response(200, {
            "schema_version": SCHEMA_VERSION,
            "entry": cached["data"],
            "fetched_at": cached.get("fetched_at"),
            "cache": "hit",
        })

    try:
        raw = _fetch_entry(_make_session(), team_id)
    except EntryNotFound:
        log.info("FPL reports team %s not found", team_id)
        return _response(404, {"error": "team not found", "team_id": team_id})
    except requests.RequestException:
        log.exception("FPL entry fetch failed for team %s", team_id)
        return _response(502, {"error": "upstream error"})

    entry = Entry.model_validate(raw)
    now = time.time()
    _put_cache(table, team_id, entry, now, _ttl_seconds())

    return _response(200, {
        "schema_version": SCHEMA_VERSION,
        "entry": entry.model_dump(),
        "fetched_at": int(now),
        "cache": "miss",
    })
