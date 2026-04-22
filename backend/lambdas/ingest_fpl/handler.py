"""Scheduled ingestion Lambda.

Fetches the two FPL endpoints we care about (bootstrap-static + fixtures),
parses a small typed subset with pydantic, and caches each endpoint as a
single item in DynamoDB with a schema version and freshness timestamp.

Invariant: both fetches must succeed before we write anything — we never
overwrite a previously good cache entry with partial data.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import boto3
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from schemas import SCHEMA_VERSION, Bootstrap, Fixture

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
BOOTSTRAP_URL = f"{FPL_BASE_URL}/bootstrap-static/"
FIXTURES_URL = f"{FPL_BASE_URL}/fixtures/"

HTTP_TIMEOUT_SECONDS = 10


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


def _fetch_json(session: requests.Session, url: str) -> Any:
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    session = _make_session()

    bootstrap_raw = _fetch_json(session, BOOTSTRAP_URL)
    fixtures_raw = _fetch_json(session, FIXTURES_URL)

    bootstrap = Bootstrap.model_validate(bootstrap_raw)
    fixtures = [Fixture.model_validate(f) for f in fixtures_raw]

    fetched_at = datetime.now(timezone.utc).isoformat()
    table = boto3.resource("dynamodb").Table(table_name)

    table.put_item(
        Item={
            "pk": "fpl#bootstrap",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": fetched_at,
            "data": bootstrap.model_dump(),
        }
    )
    table.put_item(
        Item={
            "pk": "fpl#fixtures",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": fetched_at,
            "data": [f.model_dump() for f in fixtures],
        }
    )

    counts = {
        "teams": len(bootstrap.teams),
        "players": len(bootstrap.players),
        "gameweeks": len(bootstrap.gameweeks),
        "fixtures": len(fixtures),
    }
    log.info("Ingestion complete: %s", counts)
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "fetched_at": fetched_at,
        "counts": counts,
    }
