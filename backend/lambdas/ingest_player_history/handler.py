"""Per-player history ingestion Lambda.

Iterates the players surfaced by the cached FPL bootstrap and pulls each
one's ``/element-summary/{id}/`` endpoint, which is the only place FPL
exposes per-fixture underlying stats (xG / xA / xGI / xGC / per-component
defcon counts) — the cheaper ``/event/{gw}/live/`` endpoint only ships
points and minutes.

We use the per-fixture rows as the data source for the xP-v2 model.

Output
------
For each player ``id``, writes:

- One DDB row per played fixture at
  ``pk = fpl#player_history#{id}, sk = gw#{round:03d}#fixture#{fixture}``.
- One DDB row per prior season at
  ``pk = fpl#player_history#{id}, sk = season_summary#{season_name}``.

Schedule
--------
Runs weekly. FPL's per-player stats stabilize after the matchday is fully
finished (bonus is awarded post-match), so a Sunday-night refresh picks
up the latest GW cleanly.

Resilience
----------
~700 sequential GETs are intentional — FPL's API has no batch endpoint,
and parallelism would risk tripping their rate filter. We sleep briefly
between calls and rely on ``make_fpl_session``'s retry adapter for
transient 429/5xx. Per-player errors are logged and skipped rather than
failing the run; a hard threshold (``MAX_ERROR_FRACTION``) escalates
when a systemic issue is happening.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import boto3
import requests

from compute import (
    history_past_to_ddb_item,
    history_row_to_ddb_item,
    parse_element_summary,
)
from fpl_session import make_fpl_session
from schemas import SCHEMA_VERSION, Bootstrap

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"

HTTP_TIMEOUT_SECONDS = 10

# Pause between sequential FPL calls. 50ms × 700 players ≈ 35s of pure
# sleep, well under the Lambda timeout. Polite enough that FPL's rate
# filter has never tripped on a comparable cadence in this codebase.
INTER_CALL_DELAY_SECONDS = 0.05

# If more than this fraction of players fails, raise so the CW alarm
# fires. A handful of bad players (e.g. a transferred-in mid-season
# rookie with a malformed payload) shouldn't kill the whole run.
MAX_ERROR_FRACTION = 0.10


def _fetch_element_summary(session: requests.Session, player_id: int) -> Any:
    url = f"{FPL_BASE_URL}/element-summary/{player_id}/"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def _read_player_ids(table: Any) -> list[int]:
    item = table.get_item(Key={"pk": "fpl#bootstrap", "sk": "latest"}).get("Item")
    if not item:
        raise RuntimeError("fpl#bootstrap / latest missing — has ingest_fpl run?")
    bootstrap = Bootstrap.model_validate(item["data"])
    return [p.id for p in bootstrap.players]


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)
    session = make_fpl_session()

    player_ids = _read_player_ids(table)
    fetched_at = datetime.now(timezone.utc).isoformat()

    counts = {
        "players_attempted": len(player_ids),
        "players_succeeded": 0,
        "history_rows": 0,
        "season_summary_rows": 0,
        "errors": 0,
    }
    failed_ids: list[int] = []

    with table.batch_writer() as batch:
        for player_id in player_ids:
            try:
                payload = _fetch_element_summary(session, player_id)
                parsed = parse_element_summary(payload)
                for row in parsed.history:
                    batch.put_item(
                        Item=history_row_to_ddb_item(
                            player_id=player_id,
                            row=row,
                            schema_version=SCHEMA_VERSION,
                            fetched_at=fetched_at,
                        )
                    )
                    counts["history_rows"] += 1
                for past in parsed.history_past:
                    batch.put_item(
                        Item=history_past_to_ddb_item(
                            player_id=player_id,
                            row=past,
                            schema_version=SCHEMA_VERSION,
                            fetched_at=fetched_at,
                        )
                    )
                    counts["season_summary_rows"] += 1
                counts["players_succeeded"] += 1
            except Exception:
                # Log the offender + continue. Failed_ids is reported in
                # the return so a debugger can re-run a targeted fetch.
                log.exception("Failed to ingest player_id=%s", player_id)
                counts["errors"] += 1
                failed_ids.append(player_id)
            time.sleep(INTER_CALL_DELAY_SECONDS)

    error_fraction = (
        counts["errors"] / counts["players_attempted"]
        if counts["players_attempted"]
        else 0.0
    )
    if error_fraction > MAX_ERROR_FRACTION:
        # Exit non-zero so the CW alarm fires. The successful writes from
        # earlier players are kept — partial is better than nothing for
        # downstream analysis, and re-runs are idempotent.
        raise RuntimeError(
            f"Too many ingestion errors: {counts['errors']}/{counts['players_attempted']} "
            f"({error_fraction:.1%}). First failed ids: {failed_ids[:10]}"
        )

    log.info(
        "Player-history ingestion complete: succeeded=%d/%d history_rows=%d season_rows=%d errors=%d",
        counts["players_succeeded"],
        counts["players_attempted"],
        counts["history_rows"],
        counts["season_summary_rows"],
        counts["errors"],
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "fetched_at": fetched_at,
        "counts": counts,
        "failed_ids": failed_ids,
    }
