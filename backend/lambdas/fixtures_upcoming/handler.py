"""GET /fixtures/upcoming.

Every club's fixtures for the next few gameweeks, with FPL's own 1-5
fixture difficulty rating (FDR) from that club's side. Mobile joins it to
players by club short name to draw the fixture strip on player rows, and
uses the club ids to map an entry's ``favourite_team`` to a club.

The window starts at the first gameweek whose deadline is still ahead,
the same gameweek xP projects, so a live gameweek is skipped. Each club
gets one list per gameweek in ``gameweeks``: empty for a blank gameweek,
two fixtures for a double.

Cache never populated, or schema version drift, returns HTTP 503.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from schemas import SCHEMA_VERSION, Bootstrap, Fixture, utc_now
from xp_compute import fixtures_in_gw_for_team, upcoming_gameweek_ids

log = logging.getLogger()
log.setLevel(logging.INFO)

BOOTSTRAP_KEY = {"pk": "fpl#bootstrap", "sk": "latest"}
FIXTURES_KEY = {"pk": "fpl#fixtures", "sk": "latest"}

UPCOMING_GAMEWEEK_COUNT = 3


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

    gameweeks = upcoming_gameweek_ids(
        bootstrap.gameweeks, UPCOMING_GAMEWEEK_COUNT, utc_now(),
    )
    short_names_by_id = {t.id: t.short_name for t in bootstrap.teams}

    teams = [
        {
            "id": team.id,
            "short_name": team.short_name,
            "fixtures": [
                [
                    _club_fixture(fixture, team.id, short_names_by_id)
                    for fixture in _by_kickoff(
                        fixtures_in_gw_for_team(fixtures, team.id, gameweek)
                    )
                ]
                for gameweek in gameweeks
            ],
        }
        for team in sorted(bootstrap.teams, key=lambda t: t.short_name)
    ]

    return _response(200, {
        "schema_version": SCHEMA_VERSION,
        "gameweeks": gameweeks,
        "teams": teams,
    })


def _by_kickoff(fixtures: list[Fixture]) -> list[Fixture]:
    # An unscheduled kickoff (None) sorts last within its gameweek.
    return sorted(fixtures, key=lambda f: (f.kickoff_time is None, f.kickoff_time or ""))


def _club_fixture(
    fixture: Fixture,
    team_id: int,
    short_names_by_id: dict[int, str],
) -> dict[str, Any]:
    is_home = fixture.team_h == team_id
    opponent_id = fixture.team_a if is_home else fixture.team_h
    return {
        "opponent": short_names_by_id.get(opponent_id),
        "is_home": is_home,
        "difficulty": fixture.team_h_difficulty if is_home else fixture.team_a_difficulty,
        "kickoff_time": fixture.kickoff_time,
    }
