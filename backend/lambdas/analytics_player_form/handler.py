"""Read API — GET /analytics/player/{id}/form.

Thin wrapper over the player-form analyzer's DDB output. Returns the
cached row as-is, with Decimal -> int/float for JSON. No cache-aside —
the row exists or doesn't (the form analyzer either ran or didn't), and
we don't trigger the analyzer on demand.
"""
from __future__ import annotations

import json
import logging
import os
from decimal import Decimal
from typing import Any

import boto3

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


def _parse_id(event: dict[str, Any]) -> int | None:
    params = event.get("pathParameters") or {}
    raw = params.get("id")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    value = int(raw)
    return value if value > 0 else None


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    player_id = _parse_id(event)
    if player_id is None:
        return _response(400, {"error": "invalid player id"})

    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    item = table.get_item(
        Key={"pk": "analytics#player_form", "sk": str(player_id)}
    ).get("Item")

    if item is None:
        return _response(
            404,
            {"error": "player_form not found", "player_id": player_id},
        )

    # Drop DDB pk/sk from the response — internal keys, not part of the
    # contract. Keep schema_version/computed_at so consumers can detect
    # stale data.
    body = {k: v for k, v in item.items() if k not in {"pk", "sk"}}
    return _response(200, body)
