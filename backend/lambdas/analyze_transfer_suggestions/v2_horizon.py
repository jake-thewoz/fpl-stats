"""Read pre-computed v2 horizon xP for the transfer-suggestion endpoint.

Replaces Phase 6's scan-and-compute path (which timed out at 15 s
against real production data even with 1024 MB memory). Phase 7's
``analyze_player_xp_v2`` writer Lambda now stores per-GW horizon
totals on each player's row (``horizon_xp_by_gw`` map keyed by GW id),
so this reader is a single Query + sum over the requested horizon GWs.

Latency target
--------------
- Old (#117): scan ~21k history rows + per-player feature pass = 5-8 s typical
- New (this): single 700-row Query of analytics#player_xp_v2 + sum = ~100 ms

The sum is per-request because the user's ``horizon`` parameter chooses
how many of MAX_HORIZON pre-computed GWs to include. We don't store
pre-summed totals because horizon=1 / 3 / 5 are all valid requests
that read the same source data.
"""
from __future__ import annotations

import logging
from typing import Any

from boto3.dynamodb.conditions import Key

log = logging.getLogger(__name__)


def read_v2_horizon_xps(
    *,
    table: Any,
    horizon_gw_ids: list[int],
) -> dict[int, float]:
    """Return ``{player_id: summed_horizon_xp}`` for the requested GWs.

    Reads every ``analytics#player_xp_v2`` row, extracts the
    ``horizon_xp_by_gw`` map per row, and sums the values for the GW
    ids the user asked for. Missing GWs in any individual row's map
    contribute 0 — common when a player was rotated in mid-window and
    the writer hadn't seen their row at fit time, or for blank GWs
    inside an otherwise-active horizon.

    Pagination via LastEvaluatedKey covers tables that grow past the
    1MB query response limit, even though ~700 rows fit comfortably
    in one page today.
    """
    horizon_xps: dict[int, float] = {}
    requested_keys = [str(gw) for gw in horizon_gw_ids]

    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_xp_v2"),
    }
    while True:
        response = table.query(**kwargs)
        for item in response.get("Items", []):
            try:
                player_id = int(item["sk"])
            except (KeyError, ValueError, TypeError):
                log.warning("Skipping malformed v2 xp row sk=%r", item.get("sk"))
                continue
            horizon_map = item.get("horizon_xp_by_gw") or {}
            total = 0.0
            for key in requested_keys:
                value = horizon_map.get(key)
                if value is None:
                    continue
                try:
                    total += float(value)
                except (TypeError, ValueError):
                    log.warning(
                        "Unparseable horizon xp value for player %s gw %s: %r",
                        player_id, key, value,
                    )
            horizon_xps[player_id] = total
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return horizon_xps
