"""GET /gameweek/current.

Reads the cached FPL bootstrap + fixtures from DynamoDB, picks the current
gameweek (``is_current=True``), and returns it alongside the fixtures whose
``event`` matches that gameweek's id.

Pre-season (no gameweek with ``is_current=True``) returns HTTP 200 with
``gameweek: null`` and empty fixtures — a legitimate app state for the
mobile client to render.

Cache never populated, or schema version drift, returns HTTP 503 — those
indicate server-side problems the client can't do anything about.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from schemas import SCHEMA_VERSION, Bootstrap, Fixture, Gameweek

log = logging.getLogger()
log.setLevel(logging.INFO)

BOOTSTRAP_KEY = {"pk": "fpl#bootstrap", "sk": "latest"}
FIXTURES_KEY = {"pk": "fpl#fixtures", "sk": "latest"}


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    bootstrap_item = table.get_item(Key=BOOTSTRAP_KEY).get("Item")
    fixtures_item = table.get_item(Key=FIXTURES_KEY).get("Item")

    if not bootstrap_item or not fixtures_item:
        log.warning("Cache not ready: bootstrap=%s fixtures=%s",
                    bool(bootstrap_item), bool(fixtures_item))
        return _response(503, {"error": "cache not ready"})

    for item in (bootstrap_item, fixtures_item):
        stored_version = item.get("schema_version")
        if stored_version != SCHEMA_VERSION:
            log.error("Schema mismatch: stored=%s expected=%s",
                      stored_version, SCHEMA_VERSION)
            return _response(503, {
                "error": "schema version mismatch",
                "expected": SCHEMA_VERSION,
                "stored": stored_version,
            })

    bootstrap = Bootstrap.model_validate(bootstrap_item["data"])
    fixtures = [Fixture.model_validate(f) for f in fixtures_item["data"]]

    current = next((g for g in bootstrap.gameweeks if g.is_current), None)

    if current is None:
        return _response(200, {
            "schema_version": SCHEMA_VERSION,
            "gameweek": None,
            "fixtures": [],
        })

    teams_by_id = {t.id: t for t in bootstrap.teams}
    current_fixtures = [
        _fixture_response(f, teams_by_id)
        for f in fixtures
        if f.event == current.id
    ]

    return _response(200, {
        "schema_version": SCHEMA_VERSION,
        "gameweek": current.model_dump(),
        "fixtures": current_fixtures,
    })


def _fixture_response(fixture: Fixture, teams_by_id: dict) -> dict[str, Any]:
    return {
        "id": fixture.id,
        "kickoff_time": fixture.kickoff_time,
        "started": fixture.started,
        "finished": fixture.finished,
        "home": _side(teams_by_id.get(fixture.team_h), fixture.team_h, fixture.team_h_score),
        "away": _side(teams_by_id.get(fixture.team_a), fixture.team_a, fixture.team_a_score),
    }


def _side(team, team_id: int, score: int | None) -> dict[str, Any]:
    return {
        "id": team_id,
        "short_name": team.short_name if team else None,
        "name": team.name if team else None,
        "score": score,
    }
