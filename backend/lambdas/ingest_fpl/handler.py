"""Scheduled ingestion Lambda.

Fetches the two FPL endpoints we care about (bootstrap-static + fixtures),
parses a small typed subset with pydantic, and caches each endpoint as a
single item in DynamoDB.

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
from pydantic import BaseModel
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
BOOTSTRAP_URL = f"{FPL_BASE_URL}/bootstrap-static/"
FIXTURES_URL = f"{FPL_BASE_URL}/fixtures/"

HTTP_TIMEOUT_SECONDS = 10


class Team(BaseModel):
    id: int
    name: str
    short_name: str
    code: int


class ElementType(BaseModel):
    id: int
    singular_name: str
    singular_name_short: str


class Player(BaseModel):
    id: int
    first_name: str
    second_name: str
    web_name: str
    team: int
    element_type: int
    total_points: int
    form: str
    now_cost: int


class Event(BaseModel):
    id: int
    name: str
    deadline_time: str
    is_current: bool
    is_next: bool
    finished: bool


class Bootstrap(BaseModel):
    teams: list[Team]
    element_types: list[ElementType]
    elements: list[Player]
    events: list[Event]


class Fixture(BaseModel):
    id: int
    event: int | None = None
    kickoff_time: str | None = None
    team_h: int
    team_a: int
    team_h_score: int | None = None
    team_a_score: int | None = None
    finished: bool
    started: bool | None = None


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
            "fetched_at": fetched_at,
            "data": bootstrap.model_dump(),
        }
    )
    table.put_item(
        Item={
            "pk": "fpl#fixtures",
            "sk": "latest",
            "fetched_at": fetched_at,
            "data": [f.model_dump() for f in fixtures],
        }
    )

    counts = {
        "teams": len(bootstrap.teams),
        "players": len(bootstrap.elements),
        "events": len(bootstrap.events),
        "fixtures": len(fixtures),
    }
    log.info("Ingestion complete: %s", counts)
    return {"ok": True, "fetched_at": fetched_at, "counts": counts}
