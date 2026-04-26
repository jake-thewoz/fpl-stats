"""Captain-EV analyzer Lambda.

For the upcoming gameweek, scores every player by:

    expected_points = form_score
                    × fixture_easiness   (avg across this GW's fixtures)
                    × minutes_prob       (chance of playing)
                    × num_fixtures       (DGW multiplier)

    captain_ev = expected_points × 2     (FPL captain multiplier)

Reads ``analytics#player_form`` (written by the player-form analyzer 30
minutes earlier) for ``form_score`` per player, plus ``fpl#bootstrap``
for player metadata + availability and ``fpl#fixtures`` for this GW's
matches. Writes a single ranked item: ``analytics#captain_ev / <gw>``.

Scheduled daily in the post-match quiet window. No-ops when the
match-window guard reports a live match.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from compute import (
    CaptainEvCandidate,
    CaptainEvComponents,
    expected_points,
    fixtures_in_gw_for_team,
    gw_easiness,
    minutes_probability,
    rank_top_n,
    upcoming_gameweek,
)
from match_window import get_match_window
from schemas import SCHEMA_VERSION, Bootstrap, Fixture

log = logging.getLogger()
log.setLevel(logging.INFO)

# Env-tunable so we can dial the ranked-list size without redeploying.
TOP_N = int(os.environ.get("CAPTAIN_EV_TOP_N", "50"))
CAPTAIN_MULTIPLIER = 2  # FPL: captain scores 2× (Triple Captain chip ignored).


def _to_ddb_number(value: float) -> Decimal:
    """DDB resource API rejects raw floats — round + cast to Decimal."""
    return Decimal(str(round(value, 4)))


def _read_player_forms(table: Any) -> dict[int, float]:
    """Return {player_id: form_score} from the player-form analyzer's output.

    Query (not Scan) — both analyzers use the same partition key prefix
    convention, so a single partition fetch returns the whole table.
    Pagination handled via LastEvaluatedKey for safety even though ~700
    items fit comfortably in one page.
    """
    forms: dict[int, float] = {}
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq("analytics#player_form"),
        "ProjectionExpression": "sk, form_score",
    }
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            try:
                forms[int(item["sk"])] = float(item["form_score"])
            except (KeyError, ValueError, TypeError):
                # Old/malformed rows shouldn't kill the whole run — log
                # and move on. The dropped player ends up with no form
                # signal and contributes 0 EV.
                log.warning("Skipping malformed player_form row: %r", item)
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return forms


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    window = get_match_window(table)
    if window.is_live:
        log.info("Match live, skipping captain-EV analysis this tick")
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

    gw = upcoming_gameweek(bootstrap.gameweeks)
    if gw is None:
        log.info("No upcoming gameweek — season over, nothing to analyze")
        return {"ok": True, "skipped": "no_upcoming_gameweek"}

    forms = _read_player_forms(table)
    if not forms:
        # Captain EV is downstream of the form analyzer — if its output
        # is missing, we'd just rank everyone at 0. Better to fail loudly
        # so the on-call sees the dependency broke rather than write a
        # zero-filled list.
        raise RuntimeError(
            "analytics#player_form rows missing — has the form analyzer run?"
        )

    candidates: list[CaptainEvCandidate] = []
    for player in bootstrap.players:
        team_fixtures = fixtures_in_gw_for_team(fixtures, player.team, gw)
        num_fixtures = len(team_fixtures)
        if num_fixtures == 0:
            continue  # Blank GW for this team — never captain a non-player.
        form_score = forms.get(player.id, 0.0)
        easiness = gw_easiness(team_fixtures, player.team)
        mins_prob = minutes_probability(player)
        ep = expected_points(form_score, easiness, mins_prob, num_fixtures)
        candidates.append(
            CaptainEvCandidate(
                player_id=player.id,
                web_name=player.web_name,
                team_id=player.team,
                position_id=player.element_type,
                expected_points=ep,
                captain_ev=ep * CAPTAIN_MULTIPLIER,
                components=CaptainEvComponents(
                    form_score=form_score,
                    fixture_easiness=easiness,
                    minutes_prob=mins_prob,
                    num_fixtures=num_fixtures,
                ),
            )
        )

    ranked = rank_top_n(candidates, TOP_N)

    computed_at = datetime.now(timezone.utc).isoformat()
    table.put_item(
        Item={
            "pk": "analytics#captain_ev",
            "sk": str(gw),
            "schema_version": SCHEMA_VERSION,
            "computed_at": computed_at,
            "gameweek": gw,
            "ranked": [
                {
                    "player_id": c.player_id,
                    "web_name": c.web_name,
                    "team_id": c.team_id,
                    "position_id": c.position_id,
                    "expected_points": _to_ddb_number(c.expected_points),
                    "captain_ev": _to_ddb_number(c.captain_ev),
                    "components": {
                        "form_score": _to_ddb_number(c.components.form_score),
                        "fixture_easiness": _to_ddb_number(
                            c.components.fixture_easiness
                        ),
                        "minutes_prob": _to_ddb_number(c.components.minutes_prob),
                        "num_fixtures": c.components.num_fixtures,
                    },
                }
                for c in ranked
            ],
        }
    )

    log.info(
        "Captain-EV analysis complete: gw=%d candidates=%d ranked=%d",
        gw,
        len(candidates),
        len(ranked),
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "computed_at": computed_at,
        "gameweek": gw,
        "candidates_scored": len(candidates),
        "ranked_size": len(ranked),
    }
