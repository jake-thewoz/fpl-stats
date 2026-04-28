"""Pure xP-v2 (expected points, version 2) computation.

Successor to ``xp_compute.py``. The v1 model is `form × easiness × minutes
× num_fixtures` — a single product driven by recent actual points.
v2 decomposes xP into FPL's actual scoring components (appearance, goals,
assists, clean sheets, defcon, bonus, saves, concessions, discipline)
and sums them, where each component has its own per-90 input rate and
fixture-aware multiplier. Output is in real points units.

Inputs
------
- ``ScoringRules``: 25/26 FPL scoring rules. Single source of truth.
- ``PerNinetyRates``: smoothed per-90 rates per player (npxg, xa, defcon
  match-rate, etc.). Computed by Phase 2's feature pipeline.
- ``FixtureContext``: home/away + ``opponent_strength`` ∈ [0, 1] (higher =
  stronger opponent). Centered at 0.5 so a mid-tier opponent leaves
  fixture factors untouched.
- ``V2Coefficients``: per-position multipliers + per-component opponent
  weights + home advantage + an overall per-position scale. Hand-tuned
  defaults bundled in ``xp_v2_coefficients.json``; Phase 3 replaces with
  offline-fitted values.

Component math (per fixture)
----------------------------
- appearance:  p60 · 2 + (p_any − p60) · 1
- goals:       goal_pts[pos] · p60 · npxg_p90 · goals_w[pos] · factor_goals
- assists:     3 · p60 · xa_p90 · assists_w[pos] · factor_assists
- clean sheet: cs_pts[pos] · p60 · exp(−team_xgc_p90 · factor_cs) · cs_w[pos]
- concede:     −1 · p60 · (team_xgc_p90 · factor_concede) / 2 · concede_w[pos]   (GK/DEF only)
- saves:       (saves_p90 · factor_saves) / 3 · p_any · saves_w[GKP]            (GK only)
- defcon:      2 · p_any · defcon_per_match_rate · defcon_w[pos] · factor_defcon (DEF/MID/FWD)
- bonus:       min(3, bonus_p90 · p60 · bonus_w[pos] · factor_bonus)
- discipline:  −1 · yc_p90 · p_any + −3 · rc_p90 · p_any

DGW: ``xp_for_gameweek`` sums the per-fixture xP, so each component scales
with the number of fixtures (2 fixtures → up to 2× appearance, 2× CS
chance, 2× bonus, etc.). Blank GW: empty fixtures → all zeros.

Horizon: ``xp_for_horizon`` returns per-GW components keyed by GW id.
The minutes-probability decay (``AVAILABILITY_DECAY_CURVE``) interpolates
the cop signal from "next GW only" toward 1.0 across the window — a
flagged-50% player gets 0.5 next GW but ~1.0 by GW+5, capturing typical
short-term injury recovery without modeling per-injury detail.

Phase 1 status
--------------
This module is the math. Phase 2 wires up the feature pipeline that
turns history rows into ``PerNinetyRates``. Phase 3 fits coefficients
offline. Phase 4 backtests against actual points. Phase 5 introduces
the v2-writer Lambda. No live consumer reads from xp_v2 yet.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Sequence

# FPL element_type constants — mirror what bootstrap returns.
GKP, DEF, MID, FWD = 1, 2, 3, 4
ALL_POSITIONS: tuple[int, ...] = (GKP, DEF, MID, FWD)
DEFCON_ELIGIBLE: tuple[int, ...] = (DEF, MID, FWD)

# Decay curve for minutes-probability across a multi-GW horizon. Index
# is the GW offset from the earliest GW in the horizon (offset 0 = next
# GW). Each weight is the share of "1.0 (fully recovered)" we mix into
# the player's current cop signal: at offset 0 we use cop verbatim, at
# offset 4 we treat the player as fully recovered. Tunable; Phase 3 may
# calibrate from historical short-term-injury recovery patterns.
AVAILABILITY_DECAY_CURVE: tuple[float, ...] = (0.0, 0.4, 0.7, 0.9, 1.0)


@dataclass(frozen=True)
class ScoringRules:
    """25/26 FPL scoring rules. Single source of truth for both the
    compute layer and downstream calibration."""

    appearance_short: int = 1   # played 1-59 minutes
    appearance_long: int = 2    # played ≥60 minutes
    goal_pts: dict[int, int] = field(
        default_factory=lambda: {GKP: 6, DEF: 6, MID: 5, FWD: 4}
    )
    assist_pts: int = 3
    clean_sheet_pts: dict[int, int] = field(
        default_factory=lambda: {GKP: 4, DEF: 4, MID: 1, FWD: 0}
    )
    saves_per_point: int = 3            # 1 pt per 3 saves (GK only)
    concede_per_penalty: int = 2        # −1 per 2 conceded (GK/DEF only)
    yc_pts: int = -1
    rc_pts: int = -3
    own_goal_pts: int = -2
    pen_miss_pts: int = -2
    pen_save_pts: int = 5
    defcon_pts: int = 2                 # +2 when threshold met
    # Threshold is the value of FPL's pre-computed `defensive_contribution`
    # field at which the +2 triggers. DEF: CBI+T ≥ 10. MID/FWD: CBI+T+R ≥ 12.
    # The compute layer doesn't apply these directly (Phase 2 features turn
    # them into a per-match probability), but they're parked here as the
    # canonical record so all consumers agree on the rule.
    defcon_threshold_def: int = 10
    defcon_threshold_outfield: int = 12


DEFAULT_RULES = ScoringRules()


@dataclass(frozen=True)
class PerNinetyRates:
    """Smoothed per-90 rates for one player. Outputs of Phase 2."""

    npxg_p90: float = 0.0
    xa_p90: float = 0.0
    # Team-side: expected goals conceded per 90 by the player's team.
    # Used for both clean-sheet and concede math. ~1.3 league average.
    team_xgc_p90: float = 1.3
    saves_p90: float = 0.0              # GK only; 0 for outfield
    bonus_p90: float = 0.0
    # P(player meets defcon threshold in any given match they play).
    # Phase 2 may compute this from a sigmoid on cbit_p90 (more responsive
    # to fixture context) or just the historical match-share rate; either
    # produces a [0, 1] value here.
    defcon_per_match_rate: float = 0.0
    yc_p90: float = 0.0
    rc_p90: float = 0.0
    # P(plays ≥60 mins | plays at all) — historical rate, used to project
    # p60 from minutes_prob.
    historical_p60: float = 0.85


@dataclass(frozen=True)
class FixtureContext:
    """One fixture's context for xP compute.

    ``opponent_strength`` is the model's continuous fixture-quality signal
    in [0, 1], where higher = stronger opponent (so harder for attackers,
    easier for the opponent's defenders). Centered at 0.5 — a mid-tier
    opponent leaves all fixture factors at 1.0.

    ``elo_expected_score`` and ``fpl_difficulty`` are kept for diagnostic
    output only; v2 does not multiplex on them. The Phase 2 pipeline
    derives ``opponent_strength`` from whichever upstream signal is
    cleanest (likely a normalized ClubELO win-prob).
    """

    home: bool
    opponent_strength: float
    elo_expected_score: float | None = None
    fpl_difficulty: int | None = None


@dataclass(frozen=True)
class XpV2Components:
    """Component breakdown of a single xP estimate.

    ``total`` is the post-scale sum (after ``overall_scale[position]``);
    summing the individual component fields gives the pre-scale value,
    which the Phase 3 fit report uses to attribute mean differences.
    """

    minutes_prob: float
    p60: float
    appearance_xp: float
    goals_xp: float
    assists_xp: float
    cs_xp: float
    concede_xp: float
    saves_xp: float
    bonus_xp: float
    defcon_xp: float
    discipline_xp: float
    total: float


@dataclass(frozen=True)
class V2Coefficients:
    """Per-position multipliers + fixture-factor controls.

    ``<component>_w[pos]`` is a multiplier on the component's base rate.
    1.0 = no adjustment. Hand-tuned v2.0 defaults are 1.0 for all
    in-position components, 0.0 for ineligible positions (e.g.
    saves_w[DEF]=0). Phase 3 replaces with fitted values.

    ``opp_strength_w_<component>`` is the slope on (opp_strength − 0.5).
    Sign convention: negative for attacking components (stronger opp →
    less output), positive for defensive ones (stronger opp → more
    saves/defcon work, more conceded). Bonus is treated as attacking-ish.

    ``home_advantage`` is added when ``home=True`` and subtracted when
    ``home=False`` — symmetric so an even fixture has factor=1.0.

    ``overall_scale[pos]`` is a final per-position rescaling so v2 means
    track actual-points means. Hand-tuned 1.0; Phase 3 sets per fit.
    """

    goals_w: dict[int, float]
    assists_w: dict[int, float]
    cs_w: dict[int, float]
    concede_w: dict[int, float]
    saves_w: dict[int, float]
    defcon_w: dict[int, float]
    bonus_w: dict[int, float]
    home_advantage: float
    opp_strength_w_goals: float
    opp_strength_w_assists: float
    opp_strength_w_cs: float
    opp_strength_w_concede: float
    opp_strength_w_saves: float
    opp_strength_w_defcon: float
    opp_strength_w_bonus: float
    overall_scale: dict[int, float]


_COEFFICIENTS_FILE = Path(__file__).parent / "xp_v2_coefficients.json"

# Field name on V2Coefficients that holds the opp_strength slope for each
# component — looked up by `_factor` so the per-component sign convention
# stays declared in one place.
_OPP_STRENGTH_FIELD: dict[str, str] = {
    "goals": "opp_strength_w_goals",
    "assists": "opp_strength_w_assists",
    "cs": "opp_strength_w_cs",
    "concede": "opp_strength_w_concede",
    "saves": "opp_strength_w_saves",
    "defcon": "opp_strength_w_defcon",
    "bonus": "opp_strength_w_bonus",
}


def load_default_coefficients() -> V2Coefficients:
    """Read the bundled coefficients JSON and parse into V2Coefficients.

    JSON object keys are strings; per-position dicts are converted to
    int-keyed at parse time. Extra keys (e.g. ``_comment``) are ignored.
    """
    with _COEFFICIENTS_FILE.open() as fh:
        data = json.load(fh)

    def _int_keyed(name: str) -> dict[int, float]:
        return {int(k): float(v) for k, v in data[name].items()}

    return V2Coefficients(
        goals_w=_int_keyed("goals_w"),
        assists_w=_int_keyed("assists_w"),
        cs_w=_int_keyed("cs_w"),
        concede_w=_int_keyed("concede_w"),
        saves_w=_int_keyed("saves_w"),
        defcon_w=_int_keyed("defcon_w"),
        bonus_w=_int_keyed("bonus_w"),
        home_advantage=float(data["home_advantage"]),
        opp_strength_w_goals=float(data["opp_strength_w_goals"]),
        opp_strength_w_assists=float(data["opp_strength_w_assists"]),
        opp_strength_w_cs=float(data["opp_strength_w_cs"]),
        opp_strength_w_concede=float(data["opp_strength_w_concede"]),
        opp_strength_w_saves=float(data["opp_strength_w_saves"]),
        opp_strength_w_defcon=float(data["opp_strength_w_defcon"]),
        opp_strength_w_bonus=float(data["opp_strength_w_bonus"]),
        overall_scale=_int_keyed("overall_scale"),
    )


def _factor(component: str, fixture: FixtureContext, coefs: V2Coefficients) -> float:
    """Multiplicative fixture factor for one component.

    factor = 1 + home_term + opp_w · (opp_strength − 0.5)

    where ``home_term = +home_advantage`` at home, ``−home_advantage``
    away. Centering opp_strength at 0.5 means a mid-tier opponent leaves
    the factor at 1.0, so component math reads cleanly when fixture is
    "average".
    """
    home_term = coefs.home_advantage if fixture.home else -coefs.home_advantage
    opp_w = getattr(coefs, _OPP_STRENGTH_FIELD[component])
    return 1.0 + home_term + opp_w * (fixture.opponent_strength - 0.5)


def _appearance_xp(*, p60: float, p_any: float, rules: ScoringRules) -> float:
    """E[appearance points] = P(60+ min) · 2 + P(0–59 min) · 1.

    ``p_any − p60`` is the "stub appearance" probability — coming on as
    a sub for less than an hour. Floored at 0 so a numerical drift in
    feature smoothing can't produce negative appearance xP.
    """
    p_short = max(0.0, p_any - p60)
    return p60 * rules.appearance_long + p_short * rules.appearance_short


def _goals_xp(
    *,
    position: int,
    p60: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    factor = _factor("goals", fixture, coefs)
    return rules.goal_pts[position] * p60 * rates.npxg_p90 * coefs.goals_w[position] * factor


def _assists_xp(
    *,
    position: int,
    p60: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    factor = _factor("assists", fixture, coefs)
    return rules.assist_pts * p60 * rates.xa_p90 * coefs.assists_w[position] * factor


def _cs_xp(
    *,
    position: int,
    p60: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    """Clean-sheet xP via Poisson P(0 conceded) ≈ exp(−team_xgc_p90 · factor).

    FWD short-circuits to 0 (no CS points awarded). For GK/DEF/MID, CS
    pts = 4/4/1. The factor is signed so a stronger opponent reduces CS
    probability below the team's intrinsic baseline.
    """
    cs_pts = rules.clean_sheet_pts[position]
    if cs_pts == 0:
        return 0.0
    factor = _factor("cs", fixture, coefs)
    lam = max(0.0, rates.team_xgc_p90 * factor)
    p_cs = math.exp(-lam)
    return cs_pts * p60 * p_cs * coefs.cs_w[position]


def _concede_xp(
    *,
    position: int,
    p60: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    """−1 per 2 conceded for GK/DEF (when ≥60 min played). Outfield others 0."""
    if position not in (GKP, DEF):
        return 0.0
    factor = _factor("concede", fixture, coefs)
    expected_pairs = max(0.0, rates.team_xgc_p90 * factor) / rules.concede_per_penalty
    return -1.0 * p60 * expected_pairs * coefs.concede_w[position]


def _saves_xp(
    *,
    position: int,
    p_any: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    """1 pt per 3 saves, GK only. Backup GKs naturally have saves_p90 ≈ 0
    and a low p_any, so they earn near-zero saves xP without special-case
    logic."""
    if position != GKP:
        return 0.0
    factor = _factor("saves", fixture, coefs)
    return (rates.saves_p90 * factor / rules.saves_per_point) * p_any * coefs.saves_w[position]


def _defcon_xp(
    *,
    position: int,
    p_any: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    rules: ScoringRules,
    coefs: V2Coefficients,
) -> float:
    """+2 when the position threshold is met. GK ineligible.

    p_any rather than p60: defcon trigger is per-match attendance,
    not per ≥60-min performance. A defender substituted at 75' can
    still have crossed CBI+T=10 by then.
    """
    if position not in DEFCON_ELIGIBLE:
        return 0.0
    factor = _factor("defcon", fixture, coefs)
    return rules.defcon_pts * p_any * rates.defcon_per_match_rate * coefs.defcon_w[position] * factor


def _bonus_xp(
    *,
    position: int,
    p60: float,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    coefs: V2Coefficients,
) -> float:
    """Bonus is BPS-rank driven and capped at 3 per fixture in real FPL,
    so the same cap applies here. Capping post-factor preserves the
    fixture-quality signal at the high end (a 90th-percentile match
    can't accumulate above 3 even with a positive home/opp boost)."""
    factor = _factor("bonus", fixture, coefs)
    return min(3.0, rates.bonus_p90 * p60 * coefs.bonus_w[position] * factor)


def _discipline_xp(
    *,
    p_any: float,
    rates: PerNinetyRates,
    rules: ScoringRules,
) -> float:
    """Yellow + red card penalty. Card rates are tiny — linear in p_any
    is sufficient at v2.0 precision."""
    return (
        rules.yc_pts * rates.yc_p90 * p_any
        + rules.rc_pts * rates.rc_p90 * p_any
    )


def xp_for_fixture(
    *,
    position: int,
    rates: PerNinetyRates,
    fixture: FixtureContext,
    minutes_prob: float,
    p60: float,
    coefs: V2Coefficients,
    rules: ScoringRules = DEFAULT_RULES,
) -> XpV2Components:
    """Single fixture xP for one player.

    ``minutes_prob`` = P(plays at all). ``p60`` = P(plays ≥60 min). The two
    are independently estimated by the feature pipeline; consumers that
    don't have a separate p60 model can pass
    ``p60 = minutes_prob × rates.historical_p60``.
    """
    appearance_xp = _appearance_xp(p60=p60, p_any=minutes_prob, rules=rules)
    goals_xp = _goals_xp(
        position=position, p60=p60, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    assists_xp = _assists_xp(
        position=position, p60=p60, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    cs_xp = _cs_xp(
        position=position, p60=p60, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    concede_xp = _concede_xp(
        position=position, p60=p60, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    saves_xp = _saves_xp(
        position=position, p_any=minutes_prob, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    bonus_xp = _bonus_xp(
        position=position, p60=p60, rates=rates, fixture=fixture, coefs=coefs,
    )
    defcon_xp = _defcon_xp(
        position=position, p_any=minutes_prob, rates=rates, fixture=fixture,
        rules=rules, coefs=coefs,
    )
    discipline_xp = _discipline_xp(p_any=minutes_prob, rates=rates, rules=rules)

    pre_scale_total = (
        appearance_xp + goals_xp + assists_xp + cs_xp + concede_xp
        + saves_xp + bonus_xp + defcon_xp + discipline_xp
    )
    total = pre_scale_total * coefs.overall_scale[position]
    return XpV2Components(
        minutes_prob=minutes_prob,
        p60=p60,
        appearance_xp=appearance_xp,
        goals_xp=goals_xp,
        assists_xp=assists_xp,
        cs_xp=cs_xp,
        concede_xp=concede_xp,
        saves_xp=saves_xp,
        bonus_xp=bonus_xp,
        defcon_xp=defcon_xp,
        discipline_xp=discipline_xp,
        total=total,
    )


def _zero_components(*, minutes_prob: float, p60: float) -> XpV2Components:
    return XpV2Components(
        minutes_prob=minutes_prob,
        p60=p60,
        appearance_xp=0.0,
        goals_xp=0.0,
        assists_xp=0.0,
        cs_xp=0.0,
        concede_xp=0.0,
        saves_xp=0.0,
        bonus_xp=0.0,
        defcon_xp=0.0,
        discipline_xp=0.0,
        total=0.0,
    )


def _sum_components(
    parts: Sequence[XpV2Components],
    *,
    minutes_prob: float,
    p60: float,
) -> XpV2Components:
    """Component-wise sum across multiple fixtures (DGW or horizon).

    ``minutes_prob`` and ``p60`` are passed through from the caller —
    they describe the player's per-match availability, not a sum.
    """
    return XpV2Components(
        minutes_prob=minutes_prob,
        p60=p60,
        appearance_xp=sum(p.appearance_xp for p in parts),
        goals_xp=sum(p.goals_xp for p in parts),
        assists_xp=sum(p.assists_xp for p in parts),
        cs_xp=sum(p.cs_xp for p in parts),
        concede_xp=sum(p.concede_xp for p in parts),
        saves_xp=sum(p.saves_xp for p in parts),
        bonus_xp=sum(p.bonus_xp for p in parts),
        defcon_xp=sum(p.defcon_xp for p in parts),
        discipline_xp=sum(p.discipline_xp for p in parts),
        total=sum(p.total for p in parts),
    )


def xp_for_gameweek(
    *,
    position: int,
    rates: PerNinetyRates,
    gw_fixtures: Sequence[FixtureContext],
    minutes_prob: float,
    p60: float,
    coefs: V2Coefficients,
    rules: ScoringRules = DEFAULT_RULES,
) -> XpV2Components:
    """xP for one gameweek.

    DGW: ``gw_fixtures`` has 2 entries → component-wise sum across both
    fixtures. Blank GW: empty → all zeros.
    """
    if not gw_fixtures:
        return _zero_components(minutes_prob=minutes_prob, p60=p60)
    per_fixture = [
        xp_for_fixture(
            position=position,
            rates=rates,
            fixture=fx,
            minutes_prob=minutes_prob,
            p60=p60,
            coefs=coefs,
            rules=rules,
        )
        for fx in gw_fixtures
    ]
    return _sum_components(per_fixture, minutes_prob=minutes_prob, p60=p60)


def availability_curve(*, base_minutes_prob: float, gw_offset: int) -> float:
    """Decay an injury / unavailability signal toward 1.0 over the horizon.

    ``base_minutes_prob`` is P(plays this GW) at offset 0 (next GW). For
    later GWs we mix in some weight of "fully recovered" per
    ``AVAILABILITY_DECAY_CURVE``: a flagged-50% player gets 0.5 next GW
    but ~1.0 by GW+5.

    Beyond the curve length we treat the player as fully recovered.
    """
    if gw_offset >= len(AVAILABILITY_DECAY_CURVE):
        return 1.0
    weight = AVAILABILITY_DECAY_CURVE[gw_offset]
    return base_minutes_prob * (1.0 - weight) + 1.0 * weight


def xp_for_horizon(
    *,
    position: int,
    rates: PerNinetyRates,
    fixtures_by_gw: Mapping[int, Sequence[FixtureContext]],
    base_minutes_prob: float,
    coefs: V2Coefficients,
    rules: ScoringRules = DEFAULT_RULES,
) -> dict[int, XpV2Components]:
    """xP per GW across the horizon, returned keyed by GW id.

    ``fixtures_by_gw[gw]`` is a list of fixtures (1 normal, 2 DGW, 0
    blank). ``base_minutes_prob`` is P(plays) for the EARLIEST GW in the
    horizon; later GWs get ``availability_curve(base_minutes_prob, gw_offset)``
    so a flagged player isn't pinned at 0% for the entire window. ``p60``
    for each GW = decayed minutes_prob × rates.historical_p60.

    Total horizon xP = sum(c.total for c in result.values()) — kept
    per-GW so consumers can show "next GW" / "next 3" / "horizon" breakdowns.
    """
    sorted_gws = sorted(fixtures_by_gw.keys())
    out: dict[int, XpV2Components] = {}
    for offset, gw in enumerate(sorted_gws):
        cop = availability_curve(
            base_minutes_prob=base_minutes_prob, gw_offset=offset
        )
        p60 = cop * rates.historical_p60
        out[gw] = xp_for_gameweek(
            position=position,
            rates=rates,
            gw_fixtures=fixtures_by_gw[gw],
            minutes_prob=cop,
            p60=p60,
            coefs=coefs,
            rules=rules,
        )
    return out
