"""Player-xP analyzer Lambda.

For the upcoming gameweek, scores every player by:

    xp = form_score
       × fixture_easiness   (avg across this GW's fixtures)
       × minutes_prob       (chance of playing)
       × num_fixtures       (DGW multiplier)

Writes one ``pk=analytics#player_xp, sk=<player_id>`` row per scored
player — overwritten each run, so 'latest' is implicit. Consumers
multiply by 2 for captain EV / 3 for triple-captain; xP itself is
multiplier-free so the same data serves the captain picker, the
transfer-suggestion analyzer, and a 'show xP as a column' UI without
baking captaincy into the stored value.

Reads ``analytics#player_form`` (written by the player-form analyzer
30 minutes earlier) for ``form_score`` per player, plus ``fpl#bootstrap``
for player metadata + availability and ``fpl#fixtures`` for this GW's
matches.

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

from xp_compute import (
    XpComponents,
    expected_points,
    fixtures_in_gw_for_team,
    gw_easiness,
    minutes_probability,
    upcoming_gameweek,
)
from match_window import get_match_window
from schemas import SCHEMA_VERSION, Bootstrap, Fixture

log = logging.getLogger()
log.setLevel(logging.INFO)


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
                # signal and contributes 0 xP.
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
        log.info("Match live, skipping player-xp analysis this tick")
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
        # Player xP is downstream of the form analyzer — if its output is
        # missing, every xP would be 0 from a missing form_score. Better
        # to fail loudly so the on-call sees the dependency broke than to
        # write 700 zero rows.
        raise RuntimeError(
            "analytics#player_form rows missing — has the form analyzer run?"
        )

    computed_at = datetime.now(timezone.utc).isoformat()
    written = 0

    with table.batch_writer() as batch:
        for player in bootstrap.players:
            team_fixtures = fixtures_in_gw_for_team(fixtures, player.team, gw)
            num_fixtures = len(team_fixtures)
            if num_fixtures == 0:
                # Blank GW for this team — skip rather than write xP=0.
                # A reader missing a row knows 'no fixture this GW'; a
                # row with xP=0 looks like 'predicted to score nothing',
                # which is a different signal.
                continue

            form_score = forms.get(player.id, 0.0)
            easiness = gw_easiness(team_fixtures, player.team)
            mins_prob = minutes_probability(player)
            xp = expected_points(form_score, easiness, mins_prob, num_fixtures)
            components = XpComponents(
                form_score=form_score,
                fixture_easiness=easiness,
                minutes_prob=mins_prob,
                num_fixtures=num_fixtures,
            )

            batch.put_item(
                Item={
                    "pk": "analytics#player_xp",
                    "sk": str(player.id),
                    "schema_version": SCHEMA_VERSION,
                    "computed_at": computed_at,
                    "player_id": player.id,
                    "web_name": player.web_name,
                    "team_id": player.team,
                    "position_id": player.element_type,
                    "gameweek": gw,
                    "xp": _to_ddb_number(xp),
                    "components": {
                        "form_score": _to_ddb_number(components.form_score),
                        "fixture_easiness": _to_ddb_number(
                            components.fixture_easiness
                        ),
                        "minutes_prob": _to_ddb_number(components.minutes_prob),
                        "num_fixtures": components.num_fixtures,
                    },
                }
            )
            written += 1

    log.info(
        "Player-xp analysis complete: gw=%d players_scored=%d", gw, written
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "computed_at": computed_at,
        "gameweek": gw,
        "players_scored": written,
    }
