"""Player-form analyzer Lambda.

Reads the DDB-cached bootstrap + fixtures, fetches the last N completed
gameweeks' live data direct from FPL, computes a weighted rolling form
score plus upcoming fixture difficulty for every player, and writes one
`pk=analytics#player_form, sk=<player_id>` row per player.

Scheduled daily in the post-match quiet window. No-ops if the
match-window guard reports a live match, deferring work to the next
tick rather than running heavy analytics while data could still move.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from compute import (
    UpcomingFixture,
    average_difficulty,
    recent_completed_gameweeks,
    upcoming_fixtures_for_team,
    weighted_form_score,
)
from match_window import get_match_window
from schemas import SCHEMA_VERSION, Bootstrap, Fixture

log = logging.getLogger()
log.setLevel(logging.INFO)

FPL_BASE_URL = "https://fantasy.premierleague.com/api"
HTTP_TIMEOUT_SECONDS = 10

# Tunable via env var so we can dial in the analytic window without a deploy.
RECENT_GW_COUNT = int(os.environ.get("RECENT_GW_COUNT", "5"))
UPCOMING_FIXTURES_COUNT = int(os.environ.get("UPCOMING_FIXTURES_COUNT", "5"))
# Linear decay, most recent heavy. len must be >= RECENT_GW_COUNT.
FORM_WEIGHTS = [5.0, 4.0, 3.0, 2.0, 1.0]


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


def _fetch_gw_live(session: requests.Session, gw: int) -> dict[int, int]:
    """Return {element_id: total_points} for the given finished gameweek."""
    resp = session.get(
        f"{FPL_BASE_URL}/event/{gw}/live/", timeout=HTTP_TIMEOUT_SECONDS
    )
    resp.raise_for_status()
    payload = resp.json()
    # FPL shape: {"elements": [{"id": 1, "stats": {"total_points": 6, ...}}, ...]}
    return {
        el["id"]: el.get("stats", {}).get("total_points", 0)
        for el in payload.get("elements", [])
    }


def _upcoming_to_ddb(u: UpcomingFixture) -> dict[str, Any]:
    return {
        "gw": u.gw,
        "opponent_team_id": u.opponent_team_id,
        "home": u.home,
        "difficulty": u.difficulty,
    }


def _to_ddb_number(value: float) -> Decimal:
    """DynamoDB rejects Python floats — resource API wants Decimal."""
    return Decimal(str(round(value, 4)))


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    # Match-window guard — defer heavy work until the quiet window.
    window = get_match_window(table)
    if window.is_live:
        log.info("Match live, skipping player-form analysis this tick")
        return {"ok": True, "skipped": "match_live"}

    bootstrap_item = table.get_item(
        Key={"pk": "fpl#bootstrap", "sk": "latest"}
    ).get("Item")
    if not bootstrap_item:
        raise RuntimeError("fpl#bootstrap / latest missing — has ingest run?")
    bootstrap = Bootstrap.model_validate(bootstrap_item["data"])

    fixtures_item = table.get_item(
        Key={"pk": "fpl#fixtures", "sk": "latest"}
    ).get("Item")
    if not fixtures_item:
        raise RuntimeError("fpl#fixtures / latest missing — has ingest run?")
    fixtures = [Fixture.model_validate(f) for f in fixtures_item["data"]]

    recent_gws = recent_completed_gameweeks(bootstrap.gameweeks, RECENT_GW_COUNT)
    if not recent_gws:
        log.info("No finished gameweeks yet — nothing to analyze")
        return {"ok": True, "skipped": "no_finished_gameweeks"}

    session = _make_session()
    gw_points: dict[int, dict[int, int]] = {
        gw: _fetch_gw_live(session, gw) for gw in recent_gws
    }

    computed_at = datetime.now(timezone.utc).isoformat()
    written = 0

    with table.batch_writer() as batch:
        for player in bootstrap.players:
            recent_points = [
                gw_points[gw].get(player.id, 0) for gw in recent_gws
            ]
            form_score = weighted_form_score(recent_points, FORM_WEIGHTS)
            upcoming = upcoming_fixtures_for_team(
                player.team, fixtures, UPCOMING_FIXTURES_COUNT
            )
            avg_diff = average_difficulty(upcoming)

            batch.put_item(
                Item={
                    "pk": "analytics#player_form",
                    "sk": str(player.id),
                    "schema_version": SCHEMA_VERSION,
                    "computed_at": computed_at,
                    "player_id": player.id,
                    "web_name": player.web_name,
                    "team_id": player.team,
                    "position_id": player.element_type,
                    "form_score": _to_ddb_number(form_score),
                    "recent_points": recent_points,
                    "recent_gameweeks": recent_gws,
                    "sample_size": len(recent_points),
                    "next_fixtures": [_upcoming_to_ddb(u) for u in upcoming],
                    "avg_upcoming_difficulty": (
                        None if avg_diff is None else _to_ddb_number(avg_diff)
                    ),
                }
            )
            written += 1

    log.info(
        "Player-form analysis complete: players=%d gw_range=%s",
        written,
        recent_gws,
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "computed_at": computed_at,
        "players_scored": written,
        "recent_gameweeks": recent_gws,
    }
