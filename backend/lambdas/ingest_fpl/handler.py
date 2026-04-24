"""Scheduled ingestion Lambda.

Fetches the two FPL endpoints we care about (bootstrap-static + fixtures),
preserves each raw payload in S3 for history, then caches a parsed typed
subset in DynamoDB for the read-side Lambdas.

Invariants:
- Both fetches must succeed before we write anything — partial data never
  lands in either store.
- S3 snapshots are written *before* DDB, so a success in DDB always has a
  matching archive row in S3.
"""
from __future__ import annotations

import json
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

# S3 layout: fpl/<endpoint>/<ISO-timestamp>.json
# Endpoint segments mirror the FPL path. Timestamp uses a URL-friendly
# ISO-8601 variant (colons swapped for dashes) — still sortable, no escaping.
BOOTSTRAP_S3_PREFIX = "fpl/bootstrap-static"
FIXTURES_S3_PREFIX = "fpl/fixtures"


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


def _snapshot_id(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H-%M-%SZ")


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    bucket_name = os.environ["SNAPSHOTS_BUCKET_NAME"]
    session = _make_session()

    bootstrap_raw = _fetch_json(session, BOOTSTRAP_URL)
    fixtures_raw = _fetch_json(session, FIXTURES_URL)

    bootstrap = Bootstrap.model_validate(bootstrap_raw)
    fixtures = [Fixture.model_validate(f) for f in fixtures_raw]

    now = datetime.now(timezone.utc)
    fetched_at = now.isoformat()
    snapshot_id = _snapshot_id(now)

    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket_name,
        Key=f"{BOOTSTRAP_S3_PREFIX}/{snapshot_id}.json",
        Body=json.dumps(bootstrap_raw).encode("utf-8"),
        ContentType="application/json",
    )
    s3.put_object(
        Bucket=bucket_name,
        Key=f"{FIXTURES_S3_PREFIX}/{snapshot_id}.json",
        Body=json.dumps(fixtures_raw).encode("utf-8"),
        ContentType="application/json",
    )

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
    log.info("Ingestion complete: snapshot=%s counts=%s", snapshot_id, counts)
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "fetched_at": fetched_at,
        "snapshot_id": snapshot_id,
        "counts": counts,
    }
