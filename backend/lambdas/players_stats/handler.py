"""GET /players/stats.

Serves the cached ``fpl#player_stats`` item: the FPL stats beyond those on
/players, one list per stat aligned with ``ids``. Ingest already stores
them in API units, so this handler only reads and encodes.

The full response is ~100 KB of JSON and HTTP APIs don't compress, so it
gzips the body itself when the client accepts it.
"""
from __future__ import annotations

import base64
import gzip
import json
import logging
import os
from decimal import Decimal
from typing import Any

import boto3

from schemas import PLAYER_STATS_SCHEMA_VERSION

log = logging.getLogger()
log.setLevel(logging.INFO)

PLAYER_STATS_KEY = {"pk": "fpl#player_stats", "sk": "latest"}
GZIP_ENCODING = "gzip"


def _to_json_number(value: Any) -> Any:
    """boto3 hands numbers back as Decimal, which json can't encode."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _to_json_number(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_json_number(v) for v in value]
    return value


def _accepts_gzip(event: dict[str, Any]) -> bool:
    headers = event.get("headers") or {}
    accept_encoding = headers.get("accept-encoding", "")
    return isinstance(accept_encoding, str) and GZIP_ENCODING in accept_encoding


def _response(
    status: int, body: dict[str, Any], *, compress: bool = False
) -> dict[str, Any]:
    payload = json.dumps(body)
    headers = {"content-type": "application/json"}
    if not compress:
        return {"statusCode": status, "headers": headers, "body": payload}
    headers["content-encoding"] = GZIP_ENCODING
    return {
        "statusCode": status,
        "headers": headers,
        "body": base64.b64encode(gzip.compress(payload.encode("utf-8"))).decode("ascii"),
        "isBase64Encoded": True,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    item = table.get_item(Key=PLAYER_STATS_KEY).get("Item")
    if not item:
        log.warning("Cache not ready: no player stats item")
        return _response(503, {"error": "cache not ready"})

    stored_version = item.get("schema_version")
    if stored_version != PLAYER_STATS_SCHEMA_VERSION:
        log.error("Schema mismatch: stored=%s expected=%s",
                  stored_version, PLAYER_STATS_SCHEMA_VERSION)
        return _response(503, {
            "error": "schema version mismatch",
            "expected": PLAYER_STATS_SCHEMA_VERSION,
            "stored": _to_json_number(stored_version),
        })

    data = _to_json_number(item["data"])
    return _response(
        200,
        {
            "schema_version": PLAYER_STATS_SCHEMA_VERSION,
            "fetched_at": item.get("fetched_at"),
            "count": len(data["ids"]),
            "ids": data["ids"],
            "stats": data["stats"],
        },
        compress=_accepts_gzip(event),
    )
