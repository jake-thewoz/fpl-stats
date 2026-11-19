"""DDB loading + training-pair construction for the offline fit.

Pulls every ``fpl#player_history#*`` row out of the cache table (one
``Scan`` with a filter; ~21k items at end-of-season scale fits well
inside DDB free-tier limits when the script is run ~4× per season).
Then for each row, builds a ``FitPair`` whose features are computed
strictly from prior rounds via the Phase 2 pipeline — i.e. point-in-
time, no leakage.

Two simplifications vs. the v2 spec, both documented in README:

- ``opponent_strength = 0.5`` (neutral) for every training pair.
  History rows don't carry a per-fixture difficulty signal yet, so we
  can't fit ``opp_strength_w_*`` from this data alone. Phase 3.x
  augments fixture data and re-fits those slopes.
- ``minutes_prob`` and ``p60`` are 1.0 / 0.0 from observed minutes —
  for historical rows we know exactly whether the player played, so
  the fit isolates the per-90 rates and component weights from the
  (separate) availability prediction problem.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Iterable

from boto3.dynamodb.conditions import Attr

from fit import FitPair, decompose_actual_xp
from schemas import Bootstrap, PlayerHistoryRow
from season_data import SeasonData
from xp_v2 import (
    DEFAULT_RULES,
    FixtureContext,
    PerNinetyRates,
    V2Coefficients,
    xp_for_fixture,
)
from xp_v2_features import (
    FeatureWindow,
    PositionPriors,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    merge_team_xgc,
)

log = logging.getLogger(__name__)


# Neutral fixture context used for every training pair. See module
# docstring for why we don't vary opp_strength on the historical fit.
_NEUTRAL_OPP_STRENGTH = 0.5


def scan_player_history(table: Any) -> list[PlayerHistoryRow]:
    """Return every PlayerHistoryRow in the cache, parsed from the
    ``data`` map of each ``fpl#player_history#{id}, sk=gw#*`` row.

    Skips ``season_summary#*`` rows — those are per-season aggregates,
    not per-fixture, and we don't use them in the fit yet.
    """
    rows: list[PlayerHistoryRow] = []
    response = table.scan(
        FilterExpression=Attr("pk").begins_with("fpl#player_history#")
        & Attr("sk").begins_with("gw#")
    )
    rows.extend(_parse_history_items(response.get("Items", [])))
    while "LastEvaluatedKey" in response:
        response = table.scan(
            FilterExpression=Attr("pk").begins_with("fpl#player_history#")
            & Attr("sk").begins_with("gw#"),
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        rows.extend(_parse_history_items(response.get("Items", [])))
    log.info("Loaded %d player_history rows from DDB", len(rows))
    return rows


def _parse_history_items(items: Iterable[dict[str, Any]]) -> list[PlayerHistoryRow]:
    parsed: list[PlayerHistoryRow] = []
    for item in items:
        try:
            parsed.append(PlayerHistoryRow.model_validate(item["data"]))
        except Exception:
            # One bad row shouldn't kill the whole fit — log and skip.
            log.exception("Failed to parse history row pk=%s sk=%s",
                          item.get("pk"), item.get("sk"))
    return parsed


def load_bootstrap(table: Any) -> Bootstrap:
    """Read the cached bootstrap. Required for the player → team / position
    mapping the fit needs."""
    item = table.get_item(Key={"pk": "fpl#bootstrap", "sk": "latest"}).get("Item")
    if not item:
        raise RuntimeError(
            "fpl#bootstrap missing — has ingest_fpl run yet? "
            "The fit script can't map player_id → team / position without it."
        )
    return Bootstrap.model_validate(item["data"])


def build_pairs(
    *,
    season: SeasonData,
    coefs: V2Coefficients,
    priors: PositionPriors,
    window: FeatureWindow,
    min_minutes: int = 1,
) -> list[FitPair]:
    """For each history row, compute features as_of_gw=row.round and pair
    with the row's actual outcomes.

    Skips rows where the player didn't play (``minutes < min_minutes``)
    by default — a 0-minute appearance contributes no information about
    per-90 rates and dilutes the mean-match denominators. Set
    ``min_minutes=0`` to include them (e.g. for studying availability).
    """
    rows_by_player: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    rows_by_team: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    for row in season.rows:
        rows_by_player[row.element].append(row)
        team_id = season.team_by_player_round.get((row.element, row.round))
        if team_id is not None:
            rows_by_team[team_id].append(row)

    # Team xGC depends only on (team, round); computing it once per pair
    # rescans the whole team's history every time.
    team_xgc_by_team_round: dict[tuple[int, int], float] = {}
    pairs: list[FitPair] = []
    skipped_unmapped = 0
    skipped_short_minutes = 0
    for row in season.rows:
        if row.minutes < min_minutes:
            skipped_short_minutes += 1
            continue
        team_id = season.team_by_player_round.get((row.element, row.round))
        position = season.position_by_player.get(row.element)
        if team_id is None or position is None:
            # A current-season row whose player has since left the
            # bootstrap. Skip rather than guess the position.
            skipped_unmapped += 1
            continue

        team_round = (team_id, row.round)
        if team_round not in team_xgc_by_team_round:
            team_xgc_by_team_round[team_round] = compute_team_xgc_at_gw(
                team_history_rows=rows_by_team[team_id],
                as_of_gw=row.round,
                priors=priors,
                window=window,
            )
        team_xgc = team_xgc_by_team_round[team_round]
        rates = compute_rates_at_gw(
            history=rows_by_player[row.element],
            position=position,
            as_of_gw=row.round,
            priors=priors,
            window=window,
        )
        rates = merge_team_xgc(rates, team_xgc)

        fixture = FixtureContext(
            home=row.was_home,
            opponent_strength=_NEUTRAL_OPP_STRENGTH,
        )
        # We know the player played — use observed minutes to set the
        # availability terms. The fit isolates per-90 rates and weights
        # from the (separate) availability prediction problem.
        minutes_prob = 1.0 if row.minutes > 0 else 0.0
        p60 = 1.0 if row.minutes >= 60 else 0.0
        predicted = xp_for_fixture(
            position=position,
            rates=rates,
            fixture=fixture,
            minutes_prob=minutes_prob,
            p60=p60,
            coefs=coefs,
            rules=DEFAULT_RULES,
        )
        actual = decompose_actual_xp(position=position, row=row, rules=DEFAULT_RULES)

        pairs.append(FitPair(
            season=season.season,
            player_id=row.element,
            round=row.round,
            position=position,
            predicted=predicted,
            actual=actual,
        ))

    if skipped_short_minutes:
        log.info("Skipped %d rows under min_minutes=%d", skipped_short_minutes, min_minutes)
    if skipped_unmapped:
        log.warning("Skipped %d rows with unmapped player_id (rotated out of bootstrap)",
                    skipped_unmapped)
    return pairs
