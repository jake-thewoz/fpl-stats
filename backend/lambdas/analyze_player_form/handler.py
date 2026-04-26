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

from fpl_session import make_fpl_session
from compute import (
    UpcomingFixture,
    average_difficulty,
    recent_completed_gameweeks,
    upcoming_fixtures_for_team,
    weighted_form_score,
)
from elo_compute import DEFAULT_HOME_ADVANTAGE_ELO, expected_score
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

# Tunable so we can adjust without redeploying if the constant turns out
# to over- or under-state real PL home advantage.
HOME_ADVANTAGE_ELO = float(
    os.environ.get("HOME_ADVANTAGE_ELO", str(DEFAULT_HOME_ADVANTAGE_ELO))
)


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


def _to_ddb_number(value: float) -> Decimal:
    """DynamoDB rejects Python floats — resource API wants Decimal."""
    return Decimal(str(round(value, 4)))


def _read_elo_ratings(table: Any) -> dict[int, float]:
    """Return ``{fpl_team_id: elo}`` from the clubelo cache.

    Empty dict if the cache row is missing — analyzer carries on, every
    ``elo_expected_score`` ends up ``None``. This is the path taken on a
    fresh deploy before ``ingest_clubelo`` has run for the first time, or
    if ClubELO has been down for the duration of our 30-min cache
    freshness on retries (rare but worth degrading gracefully for).
    """
    item = table.get_item(
        Key={"pk": "clubelo#ratings", "sk": "latest"}
    ).get("Item")
    if not item:
        log.info("clubelo#ratings missing — elo_expected_score will be null")
        return {}
    raw = item.get("ratings", {})
    out: dict[int, float] = {}
    for team_id_str, elo in raw.items():
        try:
            out[int(team_id_str)] = float(elo)
        except (ValueError, TypeError):
            log.warning(
                "Unparseable clubelo entry, skipping: %r=%r", team_id_str, elo
            )
    return out


def _upcoming_with_elo(
    upcoming: list[UpcomingFixture],
    my_elo: float | None,
    elo_ratings: dict[int, float],
    home_advantage_elo: float,
) -> tuple[list[dict[str, Any]], float | None]:
    """Build the next_fixtures DDB rows + their average elo_expected_score.

    Each row gets ``elo_expected_score`` populated where both teams have
    a known ELO; ``None`` otherwise. The average ignores ``None``s
    (matching how ``avg_upcoming_difficulty`` ignores missing FPL
    difficulties) and returns ``None`` if every fixture was missing data.
    """
    rows: list[dict[str, Any]] = []
    scores: list[float] = []
    for u in upcoming:
        opp_elo = elo_ratings.get(u.opponent_team_id)
        es = expected_score(
            my_elo, opp_elo,
            home=u.home,
            home_advantage_elo=home_advantage_elo,
        )
        rows.append({
            "gw": u.gw,
            "opponent_team_id": u.opponent_team_id,
            "home": u.home,
            "difficulty": u.difficulty,
            "elo_expected_score": (
                None if es is None else _to_ddb_number(es)
            ),
        })
        if es is not None:
            scores.append(es)
    avg = sum(scores) / len(scores) if scores else None
    return rows, avg


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

    session = make_fpl_session()
    gw_points: dict[int, dict[int, int]] = {
        gw: _fetch_gw_live(session, gw) for gw in recent_gws
    }

    elo_ratings = _read_elo_ratings(table)

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
            next_fixtures_ddb, avg_elo = _upcoming_with_elo(
                upcoming,
                elo_ratings.get(player.team),
                elo_ratings,
                HOME_ADVANTAGE_ELO,
            )

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
                    "next_fixtures": next_fixtures_ddb,
                    "avg_upcoming_difficulty": (
                        None if avg_diff is None else _to_ddb_number(avg_diff)
                    ),
                    "avg_upcoming_elo_expected_score": (
                        None if avg_elo is None else _to_ddb_number(avg_elo)
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
