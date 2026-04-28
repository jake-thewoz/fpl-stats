"""Player-xP-v2 analyzer Lambda — shadow-mode writer.

Per-player xP for the upcoming gameweek, computed via the per-component
v2 model from the layer (``xp_v2.py`` + ``xp_v2_features.py``). Writes
to a **separate DDB partition** (``pk=analytics#player_xp_v2``) alongside
the existing v1 analyzer, which keeps writing ``pk=analytics#player_xp``
unchanged. No live consumer reads the v2 partition yet — this is shadow
mode for sanity-checking before Phase 6 promotes the read path.

Pipeline
--------
1. Match-window guard: defer when a match is live (mirrors v1).
2. Read ``fpl#bootstrap``, ``fpl#fixtures``, and **scan**
   ``fpl#player_history#*`` (the per-fixture rows landed by Phase 0).
3. Find the upcoming gameweek (``upcoming_gameweek`` from ``xp_compute``).
4. Group history rows by player and team for O(1) feature lookups.
5. Per team: compute team_xgc once via Phase 2's ``compute_team_xgc_at_gw``
   (cached for re-use across that team's players).
6. Per player: compute per-90 rates (Phase 2), build fixture contexts
   from this GW's fixtures (FPL difficulty → opp_strength), call
   ``xp_v2.xp_for_gameweek``, write a row to DDB.

Output row
----------
    pk:              "analytics#player_xp_v2"
    sk:              "<player_id>"
    schema_version:  1
    model_version:   "v2.0"
    computed_at:     ISO 8601
    player_id, web_name, team_id, position_id, gameweek
    xp:              total predicted points (Decimal)
    components:      per-component breakdown, plus ``rates`` and
                     ``fixtures`` sub-maps for explainability.

Skipped players (blank GW for their team) are NOT written — same
convention as v1. A reader missing a row knows "no fixture this GW";
a row with xp=0 would mean "predicted to score nothing", a different
signal.

Schedule
--------
04:30 UTC daily, parallel to the v1 analyzer. Both share the
match-window guard, so a live match defers both runs to the next tick.
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr

from compute import (
    build_fixture_context,
    opponent_team_id,
    player_difficulty,
)
from match_window import get_match_window
from schemas import SCHEMA_VERSION, Bootstrap, Fixture, PlayerHistoryRow
from xp_compute import (
    fixtures_in_gw_for_team,
    minutes_probability,
    upcoming_gameweek_ids,
)
from xp_v2 import (
    XpV2Components,
    load_default_coefficients,
    xp_for_horizon,
)
from xp_v2_features import (
    FeatureWindow,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    load_default_priors,
    merge_team_xgc,
)

log = logging.getLogger()
log.setLevel(logging.INFO)


# Bumped manually whenever the bundled coefficients JSON or the
# math in xp_v2 changes meaningfully — surfaced on every stored row
# so consumers can correlate predictions with the model that produced
# them. After Phase 3 fits a new coefficient set, that PR should bump
# this string (e.g. "v2.0-fit-2026-04-28").
MODEL_VERSION = "v2.0"

# Number of upcoming GWs to pre-compute horizon predictions for. Mirrors
# analyze_transfer_suggestions.MAX_HORIZON — that endpoint clamps user
# requests to this same ceiling and reads the per-GW values written here.
MAX_HORIZON = 5


def _to_ddb_number(value: float) -> Decimal:
    """DDB resource API rejects raw floats — round + cast to Decimal.
    4 decimal places matches the v1 analyzer's precision."""
    return Decimal(str(round(value, 4)))


def _read_bootstrap(table: Any) -> Bootstrap:
    item = table.get_item(
        Key={"pk": "fpl#bootstrap", "sk": "latest"}
    ).get("Item")
    if not item:
        raise RuntimeError("fpl#bootstrap / latest missing — has ingest run?")
    return Bootstrap.model_validate(item["data"])


def _read_fixtures(table: Any) -> list[Fixture]:
    item = table.get_item(
        Key={"pk": "fpl#fixtures", "sk": "latest"}
    ).get("Item")
    if not item:
        raise RuntimeError("fpl#fixtures / latest missing — has ingest run?")
    return [Fixture.model_validate(f) for f in item["data"]]


def _scan_player_history(table: Any) -> list[PlayerHistoryRow]:
    """Scan ``fpl#player_history#*`` rows and parse the ``data`` slice.

    Skips ``season_summary#*`` rows — those are per-season aggregates,
    not per-fixture, and v2 features only consume the per-fixture rows.
    Pagination via LastEvaluatedKey covers tables larger than one page.

    A daily Scan over ~50k items is well within free-tier RCUs and runs
    in under a second; we'd revisit this if the cache table grew
    materially (~10x), at which point per-player Query would win.
    """
    rows: list[PlayerHistoryRow] = []
    kwargs: dict[str, Any] = {
        "FilterExpression": (
            Attr("pk").begins_with("fpl#player_history#")
            & Attr("sk").begins_with("gw#")
        ),
    }
    while True:
        response = table.scan(**kwargs)
        for item in response.get("Items", []):
            try:
                rows.append(PlayerHistoryRow.model_validate(item["data"]))
            except Exception:
                # One bad row shouldn't kill the run — log and skip,
                # mirroring the conservative choice in
                # analyze_player_xp's malformed-row handling.
                log.warning("Skipping malformed player_history row: pk=%s sk=%s",
                            item.get("pk"), item.get("sk"))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return rows


def _components_to_ddb(comp: Any, rates: Any, fixture_map: list[dict]) -> dict:
    """Translate XpV2Components + the per-90 rates + per-fixture meta
    into a DDB-friendly nested map. Floats → Decimal everywhere."""
    return {
        "minutes_prob": _to_ddb_number(comp.minutes_prob),
        "p60": _to_ddb_number(comp.p60),
        "appearance_xp": _to_ddb_number(comp.appearance_xp),
        "goals_xp": _to_ddb_number(comp.goals_xp),
        "assists_xp": _to_ddb_number(comp.assists_xp),
        "cs_xp": _to_ddb_number(comp.cs_xp),
        "concede_xp": _to_ddb_number(comp.concede_xp),
        "saves_xp": _to_ddb_number(comp.saves_xp),
        "bonus_xp": _to_ddb_number(comp.bonus_xp),
        "defcon_xp": _to_ddb_number(comp.defcon_xp),
        "discipline_xp": _to_ddb_number(comp.discipline_xp),
        "rates": {
            "npxg_p90": _to_ddb_number(rates.npxg_p90),
            "xa_p90": _to_ddb_number(rates.xa_p90),
            "team_xgc_p90": _to_ddb_number(rates.team_xgc_p90),
            "saves_p90": _to_ddb_number(rates.saves_p90),
            "bonus_p90": _to_ddb_number(rates.bonus_p90),
            "defcon_per_match_rate": _to_ddb_number(rates.defcon_per_match_rate),
            "yc_p90": _to_ddb_number(rates.yc_p90),
            "rc_p90": _to_ddb_number(rates.rc_p90),
            "historical_p60": _to_ddb_number(rates.historical_p60),
        },
        "fixtures": fixture_map,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    table = boto3.resource("dynamodb").Table(table_name)

    window = get_match_window(table)
    if window.is_live:
        log.info("Match live, skipping player-xp-v2 analysis this tick")
        return {"ok": True, "skipped": "match_live"}

    bootstrap = _read_bootstrap(table)
    fixtures = _read_fixtures(table)

    horizon_gw_ids = upcoming_gameweek_ids(bootstrap.gameweeks, MAX_HORIZON)
    if not horizon_gw_ids:
        log.info("No upcoming gameweek — season over, nothing to analyze")
        return {"ok": True, "skipped": "no_upcoming_gameweek"}
    # The "single GW" fields on the stored row (xp / components / gameweek)
    # describe the immediate-next GW — what the players-list xP column
    # surfaces. The horizon adds GW+1..GW+(MAX_HORIZON-1) so transfer
    # suggestions can sum any user-requested horizon (1..MAX_HORIZON)
    # without re-running the per-90 features pipeline.
    gw = horizon_gw_ids[0]

    history_rows = _scan_player_history(table)
    if not history_rows:
        # v2 is downstream of ingest_player_history. If its output is
        # missing, every prediction would collapse to position priors —
        # technically not zero, but a misleading signal. Fail loud so
        # the dependency break gets noticed.
        raise RuntimeError(
            "fpl#player_history#* rows missing — has ingest_player_history run?"
        )

    coefs = load_default_coefficients()
    priors = load_default_priors()
    feature_window = FeatureWindow()

    # Group history rows for O(1) per-player and per-team lookups.
    # (Used inside the per-player loop, where a quadratic scan would
    # be 700 × 21k = unacceptable.)
    rows_by_player: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    rows_by_team: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    player_team = {p.id: p.team for p in bootstrap.players}
    for row in history_rows:
        rows_by_player[row.element].append(row)
        team_id = player_team.get(row.element)
        if team_id is not None:
            rows_by_team[team_id].append(row)

    # Compute team_xgc once per team — re-used across that team's
    # players. About 20 unique teams vs ~700 players, so this caching
    # avoids ~680 redundant computations per run.
    team_xgc_cache: dict[int, float] = {}

    computed_at = datetime.now(timezone.utc).isoformat()
    written = 0
    skipped_blank = 0

    with table.batch_writer() as batch:
        for player in bootstrap.players:
            # Skip players whose team blanks the immediate-next GW. Same
            # rationale as Phase 5: a missing row means "no fixture this
            # GW", whereas xp=0 would mean "predicted to score nothing".
            # Players who blank GW+0 but play GW+1..GW+4 don't appear in
            # transfer suggestions; that edge case is acceptable for the
            # opt-out version of v2 and a Phase 7.x refinement if needed.
            upcoming_team_fixtures = fixtures_in_gw_for_team(
                fixtures, player.team, gw,
            )
            if not upcoming_team_fixtures:
                skipped_blank += 1
                continue

            if player.team not in team_xgc_cache:
                team_xgc_cache[player.team] = compute_team_xgc_at_gw(
                    team_history_rows=rows_by_team[player.team],
                    as_of_gw=gw,
                    priors=priors,
                    window=feature_window,
                )
            team_xgc = team_xgc_cache[player.team]

            rates = compute_rates_at_gw(
                history=rows_by_player[player.id],
                position=player.element_type,
                as_of_gw=gw,
                priors=priors,
                window=feature_window,
            )
            rates = merge_team_xgc(rates, team_xgc)

            # Build fixture contexts for every GW in the horizon. Blank
            # GWs naturally fall out as empty lists; xp_for_horizon's
            # internal xp_for_gameweek then returns zero components for
            # those, which is the right per-GW signal to store.
            fixtures_by_gw: dict[int, list] = {}
            for h_gw in horizon_gw_ids:
                team_fixtures = fixtures_in_gw_for_team(
                    fixtures, player.team, h_gw,
                )
                fixtures_by_gw[h_gw] = [
                    build_fixture_context(fx, player.team)
                    for fx in team_fixtures
                ]

            mins_prob = minutes_probability(player)

            horizon_components: dict[int, XpV2Components] = xp_for_horizon(
                position=player.element_type,
                rates=rates,
                fixtures_by_gw=fixtures_by_gw,
                base_minutes_prob=mins_prob,
                coefs=coefs,
            )

            single_gw_components = horizon_components[gw]
            fixture_meta = [
                {
                    "opponent_team_id": opponent_team_id(fx, player.team),
                    "home": fx.team_h == player.team,
                    "fpl_difficulty": player_difficulty(fx, player.team),
                }
                for fx in upcoming_team_fixtures
            ]
            horizon_xp_by_gw = {
                str(h_gw): _to_ddb_number(comp.total)
                for h_gw, comp in horizon_components.items()
            }

            batch.put_item(Item={
                "pk": "analytics#player_xp_v2",
                "sk": str(player.id),
                "schema_version": SCHEMA_VERSION,
                "model_version": MODEL_VERSION,
                "computed_at": computed_at,
                "player_id": player.id,
                "web_name": player.web_name,
                "team_id": player.team,
                "position_id": player.element_type,
                "gameweek": gw,
                "xp": _to_ddb_number(single_gw_components.total),
                "components": _components_to_ddb(
                    single_gw_components, rates, fixture_meta,
                ),
                # Horizon view — keyed by GW id (string, DDB Map keys are
                # strings). Consumers (analyze_transfer_suggestions) sum
                # whatever subset of GWs the user's horizon parameter
                # selects. ``horizon_gw_ids`` is repeated as a top-level
                # list so the read path doesn't have to coerce sorted
                # int keys back from the map.
                "horizon_gw_ids": list(horizon_gw_ids),
                "horizon_xp_by_gw": horizon_xp_by_gw,
            })
            written += 1

    log.info(
        "Player-xp-v2 analysis complete: gw=%d players_scored=%d skipped_blank=%d",
        gw, written, skipped_blank,
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "model_version": MODEL_VERSION,
        "computed_at": computed_at,
        "gameweek": gw,
        "players_scored": written,
        "skipped_blank": skipped_blank,
    }
