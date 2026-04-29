"""Read API — GET /analytics/players/xp.

Returns every per-player xP row from the player-xp analyzer's DDB
output. Slimmed to ``{player_id, web_name, team_id, position_id, xp,
xp_h3, xp_h5}`` per row to keep the payload small (~700 players ×
~110 bytes ≈ 77KB); the debug ``components`` block is dropped here.
Sorting and filtering happen client-side, which keeps the same response
useful for both the captain-pick view (sort xp desc, take top N) and
#73's custom-columns view (xP as one of many sortable columns).

Horizon fields
--------------
``xp`` is the next-GW projection (1 fixture). ``xp_h3`` and ``xp_h5``
are the sums over the next 3 / 5 GWs respectively. The writer
pre-computes per-GW values into ``horizon_xp_by_gw`` (mapping ordered
by ``horizon_gw_ids``); we sum the first N entries here to produce
each horizon. End-of-season clamp: if fewer than N GWs remain, the sum
covers what's available — the response's ``horizon_gw_ids`` list shows
exactly which GWs each horizon would have summed.

Source partition
----------------
As of Phase 7 (#118) reads from ``analytics#player_xp_v2`` — the
per-component v2 model's output. The ``xp`` field name is unchanged
on the wire (mobile sees the same shape), but the underlying signal
is now from xp-v2. v1's ``analytics#player_xp`` partition is still
written by the legacy analyzer during the soak window; it'll be
deleted along with that Lambda once v2 has been default for two
clean weeks.
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

# Horizon ceilings exposed on every row as ``xp_h3`` / ``xp_h5``. Choosing
# 3 + 5 as the only two horizons keeps the response shape stable across
# refactors — anything finer-grained (e.g. xp_h2, xp_h4) didn't pay for
# itself in the UX explorations and would bloat the payload.
HORIZON_3 = 3
HORIZON_5 = 5


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


def _sum_horizon(item: dict[str, Any], horizon: int) -> Decimal | None:
    """Sum the first ``horizon`` entries from ``horizon_xp_by_gw`` in the
    order given by ``horizon_gw_ids``. Returns ``None`` when the writer
    didn't store horizon data on this row (older row shape, blank-GW
    edge cases) so the client can render "—" rather than a misleading 0."""
    gw_ids = item.get("horizon_gw_ids")
    horizon_map = item.get("horizon_xp_by_gw")
    if not gw_ids or not horizon_map:
        return None
    total = Decimal(0)
    contributed = 0
    for gw in gw_ids[:horizon]:
        value = horizon_map.get(str(gw))
        if value is None:
            continue
        if isinstance(value, Decimal):
            total += value
        else:
            try:
                total += Decimal(str(value))
            except (TypeError, ValueError):
                continue
        contributed += 1
    return total if contributed > 0 else None


def _slim_row(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": item.get("player_id"),
        "web_name": item.get("web_name"),
        "team_id": item.get("team_id"),
        "position_id": item.get("position_id"),
        "xp": item.get("xp"),
        "xp_h3": _sum_horizon(item, HORIZON_3),
        "xp_h5": _sum_horizon(item, HORIZON_5),
    }


def _read_all_xp(table: Any) -> list[dict[str, Any]]:
    """Single-partition Query — paginated for safety even though ~700
    rows fit comfortably in DDB's 1MB page limit. Reads from the v2
    partition as of Phase 7 (#118)."""
    rows: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_xp_v2"),
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
                "horizon_gw_ids": [],
                "players": [],
            },
        )

    # Lift gameweek + computed_at + horizon_gw_ids to the top level.
    # The analyzer writes the same value for every row in a single run,
    # so per-row repetition would be wasted bytes. On the rare race
    # during a re-run, slightly mixed values across rows are acceptable
    # for these debug fields.
    first = rows[0]
    return _response(
        200,
        {
            "schema_version": first.get("schema_version"),
            "computed_at": first.get("computed_at"),
            "gameweek": first.get("gameweek"),
            "horizon_gw_ids": first.get("horizon_gw_ids") or [],
            "players": [_slim_row(item) for item in rows],
        },
    )
