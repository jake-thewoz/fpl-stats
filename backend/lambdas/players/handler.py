"""GET /players.

Reads the cached bootstrap from DynamoDB and returns a summarized player
list (one row per player). Optional query params ``team`` and ``position``
filter by team / position short names (e.g. ``ARS``, ``MID``).

Response is flat by design — a nested shape with objects for team and
position pushes the payload over 100 KB for a full ~700-player list.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from schemas import SCHEMA_VERSION, Bootstrap

log = logging.getLogger()
log.setLevel(logging.INFO)

BOOTSTRAP_KEY = {"pk": "fpl#bootstrap", "sk": "latest"}


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def _get_query_param(event: dict[str, Any], name: str) -> str | None:
    params = event.get("queryStringParameters") or {}
    value = params.get(name)
    return value.upper() if isinstance(value, str) and value else None


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    bootstrap_item = table.get_item(Key=BOOTSTRAP_KEY).get("Item")
    if not bootstrap_item:
        log.warning("Cache not ready: no bootstrap item")
        return _response(503, {"error": "cache not ready"})

    stored_version = bootstrap_item.get("schema_version")
    if stored_version != SCHEMA_VERSION:
        log.error("Schema mismatch: stored=%s expected=%s",
                  stored_version, SCHEMA_VERSION)
        return _response(503, {
            "error": "schema version mismatch",
            "expected": SCHEMA_VERSION,
            "stored": stored_version,
        })

    bootstrap = Bootstrap.model_validate(bootstrap_item["data"])
    teams_by_id = {t.id: t.short_name for t in bootstrap.teams}
    positions_by_id = {p.id: p.singular_name_short for p in bootstrap.positions}

    team_filter = _get_query_param(event, "team")
    if team_filter is not None and team_filter not in teams_by_id.values():
        return _response(400, {
            "error": "unknown team",
            "value": team_filter,
            "valid": sorted(teams_by_id.values()),
        })

    position_filter = _get_query_param(event, "position")
    if position_filter is not None and position_filter not in positions_by_id.values():
        return _response(400, {
            "error": "unknown position",
            "value": position_filter,
            "valid": sorted(positions_by_id.values()),
        })

    players = []
    for player in bootstrap.players:
        team_short = teams_by_id.get(player.team)
        position_short = positions_by_id.get(player.element_type)
        if team_short is None or position_short is None:
            continue
        if team_filter is not None and team_short != team_filter:
            continue
        if position_filter is not None and position_short != position_filter:
            continue
        players.append({
            "id": player.id,
            "name": player.web_name,
            "team": team_short,
            "position": position_short,
            "total_points": player.total_points,
            "form": player.form,
            "price": player.now_cost / 10,
        })

    return _response(200, {
        "schema_version": SCHEMA_VERSION,
        "count": len(players),
        "players": players,
    })
