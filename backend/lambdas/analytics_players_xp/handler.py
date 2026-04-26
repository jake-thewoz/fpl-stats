"""Read API — GET /analytics/players/xp.

Returns every per-player xP row from the player-xp analyzer's DDB
output. Slimmed to ``{player_id, web_name, team_id, position_id, xp}``
per row to keep the payload small (~700 players × ~80 bytes ≈ 56KB);
the debug ``components`` block is dropped here. Sorting and filtering
happen client-side, which keeps the same response useful for both the
captain-pick view (sort xp desc, take top N) and #73's custom-columns
view (xP as one of many sortable columns).
"""
from __future__ import annotations

import json
import logging
import os
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

log = logging.getLogger()
log.setLevel(logging.INFO)


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


def _slim_row(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": item.get("player_id"),
        "web_name": item.get("web_name"),
        "team_id": item.get("team_id"),
        "position_id": item.get("position_id"),
        "xp": item.get("xp"),
    }


def _read_all_xp(table: Any) -> list[dict[str, Any]]:
    """Single-partition Query — paginated for safety even though ~700
    rows fit comfortably in DDB's 1MB page limit."""
    rows: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_xp"),
    }
    while True:
        resp = table.query(**kwargs)
        rows.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return rows


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    rows = _read_all_xp(table)
    if not rows:
        # No analyzer output yet (fresh deploy, or season pre-start).
        # 200 with an empty list, not 404 — the endpoint is reachable,
        # the data just isn't ready.
        return _response(
            200,
            {
                "schema_version": None,
                "computed_at": None,
                "gameweek": None,
                "players": [],
            },
        )

    # Lift gameweek + computed_at to the top level. The analyzer writes
    # the same value for every row in a single run, so per-row repetition
    # would be wasted bytes. On the rare race during a re-run, slightly
    # mixed values across rows are acceptable for these debug fields.
    first = rows[0]
    return _response(
        200,
        {
            "schema_version": first.get("schema_version"),
            "computed_at": first.get("computed_at"),
            "gameweek": first.get("gameweek"),
            "players": [_slim_row(item) for item in rows],
        },
    )
