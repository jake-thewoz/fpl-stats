"""v2 horizon-xP computation for the transfer-suggestion endpoint.

Per-request compute, mirroring v1's pattern in
``compute.py:suggest_transfers``. When the request includes ``?model=v2``
the handler calls ``compute_v2_horizon_xps`` to produce the same shape
(``dict[player_id, horizon_xp_total]``) that the ranking code expects,
so the v2 swap-out/in math otherwise stays identical to v1.

Latency tradeoff
----------------
v2 needs the per-fixture history rows (~21k items in DDB) plus a
features pass per player. Typical request latency:

  v1 path: ~1 s   (one player_form Query + per-player horizon math)
  v2 path: ~3-5 s (one Scan over player_history + features pass)

That's still under the 15 s Lambda timeout, but noticeably slower at
the user-perceived level. v2 ships **opt-in via ?model=v2** in this
PR; the default flip in Phase 7 (#118) should consider whether to
pre-compute horizon xP into a DDB partition before flipping.

Helper duplication
------------------
``_opp_strength_from_difficulty``, ``_player_difficulty``, and
``_build_fixture_context`` mirror the analogous helpers in
``analyze_player_xp_v2/compute.py``. Two consumers of the same FPL-
difficulty-to-model-input mapping; consolidating into a layer module
is a small future cleanup.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Iterable, Optional

from boto3.dynamodb.conditions import Attr

from schemas import Bootstrap, Fixture, PlayerHistoryRow
from xp_compute import fixtures_in_gw_for_team, minutes_probability
from xp_v2 import (
    DEFAULT_RULES,
    FixtureContext,
    V2Coefficients,
    load_default_coefficients,
    xp_for_horizon,
)
from xp_v2_features import (
    FeatureWindow,
    PositionPriors,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    load_default_priors,
    merge_team_xgc,
)

log = logging.getLogger(__name__)


def _opp_strength_from_difficulty(difficulty: Optional[int]) -> float:
    """1 (easiest) → 0.0 / 3 → 0.5 (neutral) / 5 → 1.0 / None → 0.5."""
    if difficulty is None:
        return 0.5
    return (difficulty - 1) / 4.0


def _player_difficulty(fixture: Fixture, team_id: int) -> Optional[int]:
    if fixture.team_h == team_id:
        return fixture.team_h_difficulty
    if fixture.team_a == team_id:
        return fixture.team_a_difficulty
    return None


def _build_fixture_context(fixture: Fixture, team_id: int) -> FixtureContext:
    home = fixture.team_h == team_id
    difficulty = _player_difficulty(fixture, team_id)
    return FixtureContext(
        home=home,
        opponent_strength=_opp_strength_from_difficulty(difficulty),
        fpl_difficulty=difficulty,
    )


def scan_player_history(table: Any) -> list[PlayerHistoryRow]:
    """Pull every per-fixture history row from the cache.

    Same shape as the v2-writer Lambda's scan (filter to
    ``pk=fpl#player_history#*`` and ``sk=gw#*``), paginated. Two
    Lambdas with copies of ~10 lines — would consolidate if a third
    consumer arrives.
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
                log.warning("Skipping malformed player_history row: pk=%s sk=%s",
                            item.get("pk"), item.get("sk"))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return rows


def compute_v2_horizon_xps(
    *,
    bootstrap: Bootstrap,
    fixtures: Iterable[Fixture],
    history_rows: list[PlayerHistoryRow],
    horizon_gw_ids: list[int],
    coefs: V2Coefficients | None = None,
    priors: PositionPriors | None = None,
    window: FeatureWindow | None = None,
) -> dict[int, float]:
    """Per-player horizon-summed v2 xP, keyed by player_id.

    The features pipeline is run with ``as_of_gw`` set to the FIRST GW
    in the horizon — i.e. "today's knowledge". We don't refresh
    features per-future-GW because that would peek at outcomes that
    haven't happened yet.

    DGW handling falls out naturally: ``xp_for_horizon`` calls
    ``xp_for_gameweek`` per GW, which sums components across however
    many fixtures the team has that GW (1 normal, 2 DGW, 0 blank).
    """
    if not horizon_gw_ids:
        return {}

    coefs = coefs or load_default_coefficients()
    priors = priors or load_default_priors()
    window = window or FeatureWindow()

    fixtures_list = list(fixtures)
    as_of = horizon_gw_ids[0]

    # Group history rows once for O(1) per-player and per-team lookups
    # inside the per-player loop. Same pattern as the v2 writer.
    rows_by_player: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    rows_by_team: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    player_team = {p.id: p.team for p in bootstrap.players}
    for row in history_rows:
        rows_by_player[row.element].append(row)
        team_id = player_team.get(row.element)
        if team_id is not None:
            rows_by_team[team_id].append(row)

    # team_xgc is per-team and shared across team-mates — about 20
    # unique teams vs ~700 players, so caching avoids ~680 redundant calls.
    team_xgc_cache: dict[int, float] = {}

    horizon_xps: dict[int, float] = {}
    for player in bootstrap.players:
        if player.team not in team_xgc_cache:
            team_xgc_cache[player.team] = compute_team_xgc_at_gw(
                team_history_rows=rows_by_team[player.team],
                as_of_gw=as_of,
                priors=priors,
                window=window,
            )
        team_xgc = team_xgc_cache[player.team]

        rates = compute_rates_at_gw(
            history=rows_by_player[player.id],
            position=player.element_type,
            as_of_gw=as_of,
            priors=priors,
            window=window,
        )
        rates = merge_team_xgc(rates, team_xgc)

        # fixtures_by_gw drops blank GWs naturally — empty list yields
        # 0 contribution from xp_for_gameweek inside the horizon call.
        fixtures_by_gw: dict[int, list[FixtureContext]] = {}
        for gw in horizon_gw_ids:
            team_fixtures = fixtures_in_gw_for_team(
                fixtures_list, player.team, gw,
            )
            fixtures_by_gw[gw] = [
                _build_fixture_context(fx, player.team)
                for fx in team_fixtures
            ]

        # Pass the player's *current* cop signal as base; xp_for_horizon
        # decays it across the window per AVAILABILITY_DECAY_CURVE so a
        # short-term knock doesn't pin the player at 0% across all 5 GWs.
        base_mins_prob = minutes_probability(player)

        per_gw = xp_for_horizon(
            position=player.element_type,
            rates=rates,
            fixtures_by_gw=fixtures_by_gw,
            base_minutes_prob=base_mins_prob,
            coefs=coefs,
            rules=DEFAULT_RULES,
        )
        horizon_xps[player.id] = sum(c.total for c in per_gw.values())

    return horizon_xps
