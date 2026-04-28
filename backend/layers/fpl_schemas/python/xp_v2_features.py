"""Point-in-time feature pipeline for xp_v2.

Turns a player's per-fixture history (the rows landed by ingest_player_history
in #111) into the smoothed ``PerNinetyRates`` that ``xp_v2.xp_for_fixture``
consumes. Pure compute — no I/O. Runs offline (Phase 3 fit, Phase 4
backtest) and at request time inside the Phase 5 v2 analyzer Lambda.

The load-bearing invariant
--------------------------
**No future leakage.** When asked "what did we know about this player as
of GW=t?", every row used must have ``round < as_of_gw``. The defensive
assertion after the filter catches any future bug that weakens the
filter — silent leakage poisons the backtest report (Phase 4) without
any obvious symptom, so a hard fail is the right safety net.

Bayesian shrinkage
------------------
A player with thin history shouldn't dominate predictions on a single
hot match. Each per-90 rate is shrunk toward a position-level prior:

    smoothed_p90 = 90 · (sum_stat + prior_strength · prior_p90)
                   / (total_minutes + prior_strength · 90)

With ``prior_strength_matches = 4`` (default), a player with 2 starts
(180 min) has a denominator of 540 with the prior contributing 360 —
so the prior dominates ~67%. By 10 starts the player's own data wins
~71%. Cold start (0 matches) collapses to the pure prior.

Match-share rates (``defcon_per_match_rate``, ``historical_p60``) shrink
the same way but in match units rather than 90-minute units.

What's deferred
---------------
- **Prior-season aggregate blending.** ``PlayerHistoryPast`` rows are
  available but unused here. v2.0 relies only on current-season rows +
  position prior. If Phase 4 backtest shows the cold-start months are
  noisy, Phase 3 / 3.5 can reintroduce ``history_past`` as additional
  Bayesian sample — the wiring already exists in the ingest schema.
- **Exponential decay of older matches.** Currently uniform-weighted
  across the in-window history. Phase 3 may add half-life decay if it
  beats uniform-weighted on the backtest.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable

from schemas import PlayerHistoryRow
from xp_v2 import (
    ALL_POSITIONS,
    DEF,
    DEFAULT_RULES,
    DEFCON_ELIGIBLE,
    GKP,
    PerNinetyRates,
)


@dataclass(frozen=True)
class PositionPriors:
    """Position-level prior rates used as Bayesian shrinkage targets.

    Per-90 rates are dicts keyed by position id (``GKP, DEF, MID, FWD``).
    Single-value priors apply across positions.
    """

    npxg_p90: dict[int, float]
    xa_p90: dict[int, float]
    bonus_p90: dict[int, float]
    defcon_per_match_rate: dict[int, float]
    yc_p90: dict[int, float]
    saves_p90_gkp: float
    rc_p90: float
    team_xgc_p90: float
    historical_p60: float


@dataclass(frozen=True)
class FeatureWindow:
    """Config for the smoothing window.

    ``prior_strength_matches`` controls how aggressively early-season
    rates are pulled toward the position prior. Higher = more shrinkage.
    """

    prior_strength_matches: int = 4


_PRIORS_FILE = Path(__file__).parent / "xp_v2_priors.json"


def load_default_priors() -> PositionPriors:
    """Read the bundled priors JSON and parse into PositionPriors.

    JSON object keys are strings; per-position dicts are converted to
    int-keyed at parse time. Extra keys (``_comment``) are ignored.
    """
    with _PRIORS_FILE.open() as fh:
        data = json.load(fh)

    def _int_keyed(name: str) -> dict[int, float]:
        return {int(k): float(v) for k, v in data[name].items()}

    return PositionPriors(
        npxg_p90=_int_keyed("npxg_p90"),
        xa_p90=_int_keyed("xa_p90"),
        bonus_p90=_int_keyed("bonus_p90"),
        defcon_per_match_rate=_int_keyed("defcon_per_match_rate"),
        yc_p90=_int_keyed("yc_p90"),
        saves_p90_gkp=float(data["saves_p90_gkp"]),
        rc_p90=float(data["rc_p90"]),
        team_xgc_p90=float(data["team_xgc_p90"]),
        historical_p60=float(data["historical_p60"]),
    )


def _to_float(value: str | None) -> float:
    """FPL ships xG/xA-family fields as decimal strings (``'0.42'``).
    Missing → 0.0; unparseable → 0.0. Conservative default mirrors the
    ingest-side behavior (see ``schemas.PlayerHistoryRow`` field comments)."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _filter_rows_before(
    rows: Iterable[PlayerHistoryRow],
    as_of_gw: int,
) -> list[PlayerHistoryRow]:
    """Anti-leakage filter: rows strictly before ``as_of_gw``.

    The defensive ``assert`` is the load-bearing invariant of this whole
    module. A silent leak here would pass every test that doesn't
    specifically check it and quietly inflate the backtest's reported
    accuracy. Hard-fail by raising if a future row sneaks past.
    """
    filtered = [r for r in rows if r.round < as_of_gw]
    if filtered:
        max_round = max(r.round for r in filtered)
        if max_round >= as_of_gw:
            raise AssertionError(
                f"Anti-leakage filter let through round {max_round} >= {as_of_gw}"
            )
    return filtered


def _smoothed_p90(
    *,
    total_stat: float,
    total_minutes: int,
    prior_p90: float,
    prior_strength_matches: int,
) -> float:
    """Bayesian shrinkage of a per-90 rate toward the prior.

    With ``prior_strength_matches = 4`` and a player who's played 2
    matches (180 min), the denominator is 180 + 4·90 = 540, so the
    prior contributes 360/540 ≈ 67% of the smoothed value. After ~10
    matches (900 min), the player's own data wins ~71%.

    No matches at all → returns ``prior_p90`` (the pure-prior fallback
    that handles rookies and pre-season).
    """
    prior_minutes = prior_strength_matches * 90
    return 90.0 * (
        total_stat + prior_strength_matches * prior_p90
    ) / (total_minutes + prior_minutes)


def _smoothed_match_share(
    *,
    success_count: int,
    total_matches: int,
    prior_rate: float,
    prior_strength_matches: int,
) -> float:
    """Bayesian shrinkage of a 0–1 per-match probability toward the prior.

    Used for match-share rates (defcon trigger, ≥60-min plays) where the
    natural unit is matches, not minutes. Same shrinkage shape as
    ``_smoothed_p90`` but in match units.
    """
    return (
        success_count + prior_strength_matches * prior_rate
    ) / (total_matches + prior_strength_matches)


def compute_rates_at_gw(
    *,
    history: Iterable[PlayerHistoryRow],
    position: int,
    as_of_gw: int,
    priors: PositionPriors,
    window: FeatureWindow,
) -> PerNinetyRates:
    """Smoothed per-90 rates for one player as of ``as_of_gw``.

    ``history`` is the player's own per-fixture rows (FPL's
    ``/element-summary/{id}/.history`` slice we cached in #111). Caller
    is responsible for filtering by player; this function handles the
    point-in-time filter.

    Note: ``team_xgc_p90`` on the returned struct is set to the position
    prior — a placeholder. The team-side stat needs the union of every
    player on the same team's history rows (computed once per team via
    ``compute_team_xgc_at_gw``); merge it in afterwards via ``replace``.
    """
    if position not in ALL_POSITIONS:
        raise ValueError(f"Unknown position id: {position}")

    filtered = _filter_rows_before(history, as_of_gw)
    total_minutes = sum(r.minutes for r in filtered)
    matches_played = sum(1 for r in filtered if r.minutes > 0)
    prior_strength = window.prior_strength_matches

    # Per-90 rates derived from raw counters.
    npxg_p90 = _smoothed_p90(
        total_stat=sum(_to_float(r.expected_goals) for r in filtered),
        total_minutes=total_minutes,
        prior_p90=priors.npxg_p90[position],
        prior_strength_matches=prior_strength,
    )
    xa_p90 = _smoothed_p90(
        total_stat=sum(_to_float(r.expected_assists) for r in filtered),
        total_minutes=total_minutes,
        prior_p90=priors.xa_p90[position],
        prior_strength_matches=prior_strength,
    )
    bonus_p90 = _smoothed_p90(
        total_stat=sum(r.bonus for r in filtered),
        total_minutes=total_minutes,
        prior_p90=priors.bonus_p90[position],
        prior_strength_matches=prior_strength,
    )
    yc_p90 = _smoothed_p90(
        total_stat=sum(r.yellow_cards for r in filtered),
        total_minutes=total_minutes,
        prior_p90=priors.yc_p90[position],
        prior_strength_matches=prior_strength,
    )
    rc_p90 = _smoothed_p90(
        total_stat=sum(r.red_cards for r in filtered),
        total_minutes=total_minutes,
        prior_p90=priors.rc_p90,
        prior_strength_matches=prior_strength,
    )
    # Saves are GK-only. For outfield positions the prior is 0 and the
    # actual sum will also be 0, so the smoothed value collapses to 0
    # cleanly — but force to 0 explicitly to avoid any rounding artifact.
    if position == GKP:
        saves_p90 = _smoothed_p90(
            total_stat=sum(r.saves for r in filtered),
            total_minutes=total_minutes,
            prior_p90=priors.saves_p90_gkp,
            prior_strength_matches=prior_strength,
        )
    else:
        saves_p90 = 0.0

    # Defcon: per-match probability, position-stratified threshold.
    if position in DEFCON_ELIGIBLE:
        threshold = (
            DEFAULT_RULES.defcon_threshold_def if position == DEF
            else DEFAULT_RULES.defcon_threshold_outfield
        )
        successes = sum(
            1 for r in filtered
            if r.minutes > 0 and (r.defensive_contribution or 0) >= threshold
        )
        defcon_per_match_rate = _smoothed_match_share(
            success_count=successes,
            total_matches=matches_played,
            prior_rate=priors.defcon_per_match_rate[position],
            prior_strength_matches=prior_strength,
        )
    else:
        defcon_per_match_rate = 0.0

    # historical_p60: P(plays ≥60 min | played at all) — conditional on
    # actually appearing, since a substituted-on player was given a
    # chance to make 60 minutes. With no matches at all we fall back to
    # the league-wide prior rather than the smoothed-toward-prior value
    # (which would otherwise be undefined for matches_played=0).
    if matches_played > 0:
        historical_p60 = _smoothed_match_share(
            success_count=sum(1 for r in filtered if r.minutes >= 60),
            total_matches=matches_played,
            prior_rate=priors.historical_p60,
            prior_strength_matches=prior_strength,
        )
    else:
        historical_p60 = priors.historical_p60

    return PerNinetyRates(
        npxg_p90=npxg_p90,
        xa_p90=xa_p90,
        team_xgc_p90=priors.team_xgc_p90,  # placeholder — see compute_team_xgc_at_gw
        saves_p90=saves_p90,
        bonus_p90=bonus_p90,
        defcon_per_match_rate=defcon_per_match_rate,
        yc_p90=yc_p90,
        rc_p90=rc_p90,
        historical_p60=historical_p60,
    )


def compute_team_xgc_at_gw(
    *,
    team_history_rows: Iterable[PlayerHistoryRow],
    as_of_gw: int,
    priors: PositionPriors,
    window: FeatureWindow,
) -> float:
    """Team-side expected goals conceded per 90, smoothed.

    ``team_history_rows`` is the union of every team-member player's
    history rows. FPL ships ``expected_goals_conceded`` as a per-match
    team-side value, identical for every player on the team in that
    match — so we dedupe by ``fixture`` id and take one xGC per match.

    Empty history (a newly-promoted side at season start, or pre-season)
    → returns ``priors.team_xgc_p90`` (league mean).
    """
    filtered = _filter_rows_before(team_history_rows, as_of_gw)

    seen_fixtures: set[int] = set()
    sum_xgc = 0.0
    n_matches = 0
    for row in filtered:
        if row.fixture in seen_fixtures:
            continue
        seen_fixtures.add(row.fixture)
        xgc_value = _to_float(row.expected_goals_conceded)
        sum_xgc += xgc_value
        n_matches += 1

    prior_strength = window.prior_strength_matches
    return (
        sum_xgc + prior_strength * priors.team_xgc_p90
    ) / (n_matches + prior_strength)


def merge_team_xgc(rates: PerNinetyRates, team_xgc_p90: float) -> PerNinetyRates:
    """Replace the placeholder ``team_xgc_p90`` on a per-player rates
    struct with the team-level computed value.

    Convenience for the realistic call pattern: compute team xGC once
    per team, then ``merge_team_xgc(rates, t)`` for each player on it.
    """
    return replace(rates, team_xgc_p90=team_xgc_p90)
