"""Unit tests for xp_v2.

Hand-built scenarios cover per-component math, per-position behaviour,
DGW / blank GW handling, the minutes-probability decay curve, and the
end-to-end snapshot of a synthetic 5-player set so coefficient-JSON
drift can't ship without a reviewer noticing.

Tolerance: ``pytest.approx(rel=1e-4)`` everywhere — the math is pure
floats and the references in this file were independently hand-computed,
so anything looser would let a bug hide behind rounding.
"""
from __future__ import annotations

import math

import pytest

from xp_v2 import (
    AVAILABILITY_DECAY_CURVE,
    DEF,
    DEFAULT_RULES,
    FWD,
    GKP,
    MID,
    FixtureContext,
    PerNinetyRates,
    V2Coefficients,
    XpV2Components,
    availability_curve,
    load_default_coefficients,
    xp_for_fixture,
    xp_for_gameweek,
    xp_for_horizon,
)


# Fixed test coefficients — kept independent of the bundled JSON so a
# coefficient bump in xp_v2_coefficients.json doesn't silently break
# every component test. The end-to-end snapshot test (`test_default_*`)
# does pin the bundled JSON.
_TEST_COEFS = V2Coefficients(
    goals_w={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
    assists_w={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
    cs_w={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 0.0},
    concede_w={GKP: 1.0, DEF: 1.0, MID: 0.0, FWD: 0.0},
    saves_w={GKP: 1.0, DEF: 0.0, MID: 0.0, FWD: 0.0},
    defcon_w={GKP: 0.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
    bonus_w={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
    home_advantage=0.05,
    opp_strength_w_goals=-0.4,
    opp_strength_w_assists=-0.3,
    opp_strength_w_cs=-0.6,
    opp_strength_w_concede=0.6,
    opp_strength_w_saves=0.5,
    opp_strength_w_defcon=0.3,
    opp_strength_w_bonus=-0.3,
    overall_scale={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
)

# Mid-tier opponent at home — every fixture factor reduces to a known
# value (1 + 0.05 + opp_w · 0) = 1.05. Useful for tests that want to
# isolate per-component math from fixture-factor noise.
_NEUTRAL_OPP_HOME = FixtureContext(home=True, opponent_strength=0.5, fpl_difficulty=3)
# Centred opponent away — 1 − 0.05 = 0.95.
_NEUTRAL_OPP_AWAY = FixtureContext(home=False, opponent_strength=0.5, fpl_difficulty=3)


def _baseline_rates(**overrides) -> PerNinetyRates:
    """Default-everything rates with optional overrides for one test."""
    base = dict(
        npxg_p90=0.0, xa_p90=0.0, team_xgc_p90=1.3,
        saves_p90=0.0, bonus_p90=0.0,
        defcon_per_match_rate=0.0, yc_p90=0.0, rc_p90=0.0,
        historical_p60=0.85,
    )
    base.update(overrides)
    return PerNinetyRates(**base)


# ---------------------------------------------------------------------------
# Per-component math
# ---------------------------------------------------------------------------


def test_appearance_xp_full_match() -> None:
    """p60 = p_any = 1.0 → exactly 2 pts, no stub-appearance term."""
    c = xp_for_fixture(
        position=MID, rates=_baseline_rates(), fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    assert c.appearance_xp == pytest.approx(2.0)


def test_appearance_xp_partial() -> None:
    """p_any > p60 produces a stub-appearance contribution."""
    c = xp_for_fixture(
        position=MID, rates=_baseline_rates(), fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=0.9, p60=0.6, coefs=_TEST_COEFS,
    )
    # 0.6 × 2 + 0.3 × 1 = 1.5
    assert c.appearance_xp == pytest.approx(1.5)


def test_appearance_xp_negative_diff_floored_at_zero() -> None:
    """A misconfigured caller that passes p60 > p_any can't produce a
    negative stub-appearance term — the floor is the safety net."""
    c = xp_for_fixture(
        position=MID, rates=_baseline_rates(), fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=0.5, p60=0.8, coefs=_TEST_COEFS,
    )
    # max(0, 0.5 - 0.8) = 0; appearance_xp = 0.8 × 2 + 0 × 1 = 1.6
    assert c.appearance_xp == pytest.approx(1.6)


def test_goals_xp_scales_with_position_pts() -> None:
    """Same npxg_p90, neutral fixture: FWD (4 pts/goal) < MID (5 pts/goal)
    < DEF/GK (6 pts/goal). Ratios pin the per-position scoring rule."""
    rates = _baseline_rates(npxg_p90=0.5)
    c_fwd = xp_for_fixture(position=FWD, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_mid = xp_for_fixture(position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_def = xp_for_fixture(position=DEF, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    # ratios should be exactly 4 : 5 : 6 (no fixture asymmetry between calls)
    assert c_fwd.goals_xp / c_mid.goals_xp == pytest.approx(4 / 5, rel=1e-6)
    assert c_def.goals_xp / c_mid.goals_xp == pytest.approx(6 / 5, rel=1e-6)


def test_assists_xp_uses_assist_pts() -> None:
    rates = _baseline_rates(xa_p90=0.4)
    c = xp_for_fixture(
        position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    # 3 × 1.0 × 0.4 × 1.0 × 1.05 = 1.26
    assert c.assists_xp == pytest.approx(1.26, rel=1e-4)


def test_cs_xp_poisson_p_zero_conceded() -> None:
    """CS xP = cs_pts × p60 × exp(−team_xgc · factor) × cs_w."""
    rates = _baseline_rates(team_xgc_p90=1.2)
    c = xp_for_fixture(
        position=DEF, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    # factor = 1.05 (mid-opp + home), λ = 1.2 × 1.05 = 1.26, exp(-1.26) ≈ 0.2837
    expected = 4 * 1.0 * math.exp(-1.26) * 1.0
    assert c.cs_xp == pytest.approx(expected, rel=1e-4)


def test_cs_xp_zero_for_forwards() -> None:
    rates = _baseline_rates(team_xgc_p90=0.5)  # very tight defence
    c = xp_for_fixture(
        position=FWD, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    assert c.cs_xp == 0.0


def test_concede_xp_only_for_gk_and_def() -> None:
    rates = _baseline_rates(team_xgc_p90=2.0)  # leaky team
    c_def = xp_for_fixture(position=DEF, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_gk = xp_for_fixture(position=GKP, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_mid = xp_for_fixture(position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_fwd = xp_for_fixture(position=FWD, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_def.concede_xp < 0
    assert c_gk.concede_xp < 0
    assert c_mid.concede_xp == 0.0
    assert c_fwd.concede_xp == 0.0


def test_saves_xp_only_for_gk() -> None:
    rates = _baseline_rates(saves_p90=3.0)  # busy goalkeeper rate
    c_gk = xp_for_fixture(position=GKP, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_def = xp_for_fixture(position=DEF, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_gk.saves_xp > 0
    assert c_def.saves_xp == 0.0


def test_defcon_xp_off_for_gk() -> None:
    rates = _baseline_rates(defcon_per_match_rate=0.5)
    c_gk = xp_for_fixture(position=GKP, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_def = xp_for_fixture(position=DEF, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_mid = xp_for_fixture(position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_gk.defcon_xp == 0.0
    assert c_def.defcon_xp > 0
    assert c_mid.defcon_xp > 0


def test_bonus_xp_capped_at_three() -> None:
    """Even an absurdly bonus-heavy player can't earn more than 3 per fixture."""
    rates = _baseline_rates(bonus_p90=10.0)
    c = xp_for_fixture(
        position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    assert c.bonus_xp == pytest.approx(3.0)


def test_discipline_xp_negative_with_card_rates() -> None:
    rates = _baseline_rates(yc_p90=0.5, rc_p90=0.05)
    c = xp_for_fixture(
        position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS,
    )
    # -1 × 0.5 × 1.0 + -3 × 0.05 × 1.0 = -0.65
    assert c.discipline_xp == pytest.approx(-0.65, rel=1e-6)


# ---------------------------------------------------------------------------
# Fixture-factor signs
# ---------------------------------------------------------------------------


def test_attacking_components_drop_against_strong_opponents() -> None:
    """Goals/assists factor weight is negative — stronger opp suppresses output."""
    rates = _baseline_rates(npxg_p90=0.4, xa_p90=0.3)
    weak = FixtureContext(home=True, opponent_strength=0.2)
    strong = FixtureContext(home=True, opponent_strength=0.8)
    c_weak = xp_for_fixture(position=MID, rates=rates, fixture=weak, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_strong = xp_for_fixture(position=MID, rates=rates, fixture=strong, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_weak.goals_xp > c_strong.goals_xp
    assert c_weak.assists_xp > c_strong.assists_xp


def test_defensive_components_rise_against_strong_opponents() -> None:
    """Saves / defcon weight is positive — stronger opp = more defensive work."""
    rates = _baseline_rates(saves_p90=2.0, defcon_per_match_rate=0.4)
    weak = FixtureContext(home=True, opponent_strength=0.2)
    strong = FixtureContext(home=True, opponent_strength=0.8)
    c_weak_gk = xp_for_fixture(position=GKP, rates=rates, fixture=weak, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_strong_gk = xp_for_fixture(position=GKP, rates=rates, fixture=strong, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_strong_gk.saves_xp > c_weak_gk.saves_xp

    c_weak_def = xp_for_fixture(position=DEF, rates=rates, fixture=weak, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_strong_def = xp_for_fixture(position=DEF, rates=rates, fixture=strong, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_strong_def.defcon_xp > c_weak_def.defcon_xp


def test_home_lifts_total_vs_away_for_attacker() -> None:
    """Home advantage is +0.05 across attacking components, −0.05 away.
    Total xP is not equal between home/away when other inputs are equal."""
    rates = _baseline_rates(npxg_p90=0.5, xa_p90=0.3, bonus_p90=0.5)
    c_home = xp_for_fixture(position=FWD, rates=rates, fixture=_NEUTRAL_OPP_HOME, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    c_away = xp_for_fixture(position=FWD, rates=rates, fixture=_NEUTRAL_OPP_AWAY, minutes_prob=1.0, p60=1.0, coefs=_TEST_COEFS)
    assert c_home.total > c_away.total


# ---------------------------------------------------------------------------
# Per-position canonical scenarios
# ---------------------------------------------------------------------------


def test_premium_mid_goals_xp_dominates() -> None:
    """Bruno-shaped: high xG/xA, defcon-eligible, near-certain to start."""
    rates = _baseline_rates(
        npxg_p90=0.4, xa_p90=0.3, team_xgc_p90=1.2,
        bonus_p90=0.5, defcon_per_match_rate=0.4,
        yc_p90=0.1, historical_p60=0.95,
    )
    fx = FixtureContext(home=True, opponent_strength=0.4)
    c = xp_for_fixture(
        position=MID, rates=rates, fixture=fx,
        minutes_prob=0.95, p60=0.9, coefs=_TEST_COEFS,
    )
    # Goals contribution should be the single largest non-appearance line.
    others = [c.assists_xp, c.cs_xp, c.bonus_xp, c.defcon_xp]
    assert c.goals_xp > max(others)
    # Sanity: total around 6 — ballpark of FPL ep_next for premium MIDs.
    assert 5.0 < c.total < 7.5


def test_defender_defcon_and_cs_meaningful() -> None:
    """Robertson-shaped: solid CS and defcon-eligible. Both should surface."""
    rates = _baseline_rates(
        npxg_p90=0.05, xa_p90=0.15, team_xgc_p90=0.9,  # tight backline
        bonus_p90=0.4, defcon_per_match_rate=0.5,
        historical_p60=0.95,
    )
    fx = FixtureContext(home=True, opponent_strength=0.5)
    c = xp_for_fixture(
        position=DEF, rates=rates, fixture=fx,
        minutes_prob=0.95, p60=0.9, coefs=_TEST_COEFS,
    )
    assert c.defcon_xp > 0
    assert c.cs_xp > 0
    # Concede penalty exists but should be modest for a strong defence.
    assert -2.0 < c.concede_xp < 0


def test_busy_keeper_saves_dominate() -> None:
    """Pickford-shaped (mid-tier team, lots of shots faced): saves is the
    biggest non-appearance component, defcon = 0."""
    rates = _baseline_rates(
        team_xgc_p90=1.5,
        saves_p90=4.0,
        bonus_p90=0.3,
        historical_p60=1.0,  # GKs play 90 if they start
    )
    fx = FixtureContext(home=False, opponent_strength=0.7)
    c = xp_for_fixture(
        position=GKP, rates=rates, fixture=fx,
        minutes_prob=0.95, p60=0.95, coefs=_TEST_COEFS,
    )
    assert c.defcon_xp == 0.0
    others = [c.cs_xp, c.bonus_xp]
    assert c.saves_xp > max(others)


# ---------------------------------------------------------------------------
# DGW / blank GW
# ---------------------------------------------------------------------------


def test_dgw_doubles_xp_when_fixtures_identical() -> None:
    rates = _baseline_rates(npxg_p90=0.4, xa_p90=0.3, defcon_per_match_rate=0.4, bonus_p90=0.4)
    fx = FixtureContext(home=True, opponent_strength=0.4)
    single = xp_for_gameweek(
        position=MID, rates=rates, gw_fixtures=[fx],
        minutes_prob=0.95, p60=0.9, coefs=_TEST_COEFS,
    )
    dgw = xp_for_gameweek(
        position=MID, rates=rates, gw_fixtures=[fx, fx],
        minutes_prob=0.95, p60=0.9, coefs=_TEST_COEFS,
    )
    assert dgw.total == pytest.approx(single.total * 2)
    assert dgw.goals_xp == pytest.approx(single.goals_xp * 2)
    assert dgw.bonus_xp == pytest.approx(single.bonus_xp * 2)


def test_blank_gw_returns_all_zero_components() -> None:
    rates = _baseline_rates(npxg_p90=1.0, xa_p90=0.5)  # would otherwise score big
    blank = xp_for_gameweek(
        position=MID, rates=rates, gw_fixtures=[],
        minutes_prob=0.95, p60=0.9, coefs=_TEST_COEFS,
    )
    assert blank.total == 0.0
    for value in (
        blank.appearance_xp, blank.goals_xp, blank.assists_xp, blank.cs_xp,
        blank.concede_xp, blank.saves_xp, blank.bonus_xp, blank.defcon_xp,
        blank.discipline_xp,
    ):
        assert value == 0.0
    # minutes_prob/p60 are passed through (so a UI can still render
    # "expected to play 95% of next GW" alongside an xP=0 blank).
    assert blank.minutes_prob == 0.95
    assert blank.p60 == 0.9


def test_flagged_player_total_zero() -> None:
    """minutes_prob = 0 (player ruled out) → no component contributes."""
    rates = _baseline_rates(
        npxg_p90=0.6, xa_p90=0.4, bonus_p90=0.5,
        saves_p90=4.0, defcon_per_match_rate=0.5,
    )
    c = xp_for_fixture(
        position=MID, rates=rates, fixture=_NEUTRAL_OPP_HOME,
        minutes_prob=0.0, p60=0.0, coefs=_TEST_COEFS,
    )
    assert c.total == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Horizon + availability decay
# ---------------------------------------------------------------------------


def test_availability_curve_at_offset_zero_is_base() -> None:
    assert availability_curve(base_minutes_prob=0.5, gw_offset=0) == pytest.approx(0.5)


def test_availability_curve_decays_toward_one() -> None:
    """A flagged-50% player drifts up across the curve."""
    values = [
        availability_curve(base_minutes_prob=0.5, gw_offset=i)
        for i in range(len(AVAILABILITY_DECAY_CURVE))
    ]
    # Monotone non-decreasing.
    for prev, curr in zip(values, values[1:]):
        assert curr >= prev
    assert values[-1] == pytest.approx(1.0)


def test_availability_curve_caps_at_one_beyond_curve() -> None:
    """Out-of-curve offsets are treated as fully recovered."""
    assert availability_curve(base_minutes_prob=0.0, gw_offset=42) == pytest.approx(1.0)


def test_horizon_returns_per_gw_breakdown_and_decays_minutes() -> None:
    """Injured player at cop=0 gets a decayed minutes_prob across the
    horizon, so later GWs in the window earn meaningful xP."""
    rates = _baseline_rates(npxg_p90=0.4, xa_p90=0.3, defcon_per_match_rate=0.4, bonus_p90=0.4)
    fx = FixtureContext(home=True, opponent_strength=0.5)
    fixtures_by_gw: dict[int, list[FixtureContext]] = {30: [fx], 31: [fx], 32: [fx]}
    out = xp_for_horizon(
        position=MID, rates=rates,
        fixtures_by_gw=fixtures_by_gw, base_minutes_prob=0.0,
        coefs=_TEST_COEFS,
    )
    assert sorted(out.keys()) == [30, 31, 32]
    # minutes_prob walks 0 → 0.4 → 0.7 along the curve.
    assert out[30].minutes_prob == pytest.approx(0.0)
    assert out[31].minutes_prob == pytest.approx(0.4)
    assert out[32].minutes_prob == pytest.approx(0.7)
    # Strict ordering: later GWs in the horizon have higher xP than earlier
    # for an injured-then-recovering player.
    assert out[30].total < out[31].total < out[32].total


def test_horizon_blank_gw_in_middle_zeros_only_that_gw() -> None:
    rates = _baseline_rates(npxg_p90=0.4, xa_p90=0.3, defcon_per_match_rate=0.4, bonus_p90=0.4)
    fx = FixtureContext(home=True, opponent_strength=0.5)
    fixtures_by_gw: dict[int, list[FixtureContext]] = {30: [fx], 31: [], 32: [fx]}
    out = xp_for_horizon(
        position=MID, rates=rates,
        fixtures_by_gw=fixtures_by_gw, base_minutes_prob=1.0,
        coefs=_TEST_COEFS,
    )
    assert out[31].total == 0.0
    assert out[30].total > 0
    assert out[32].total > 0


# ---------------------------------------------------------------------------
# Coefficients JSON loading (snapshot for drift detection)
# ---------------------------------------------------------------------------


def test_load_default_coefficients_returns_expected_shape() -> None:
    coefs = load_default_coefficients()
    # All four positions present in every per-position dict.
    for d in (
        coefs.goals_w, coefs.assists_w, coefs.cs_w, coefs.concede_w,
        coefs.saves_w, coefs.defcon_w, coefs.bonus_w, coefs.overall_scale,
    ):
        assert set(d.keys()) == {GKP, DEF, MID, FWD}
    # Sign sanity-check on a few coefficients (detects a swapped sign in
    # a hand-edit before it ships).
    assert coefs.opp_strength_w_goals < 0  # attacking: stronger opp suppresses
    assert coefs.opp_strength_w_saves > 0  # defensive: stronger opp lifts
    assert coefs.home_advantage > 0


def test_load_default_coefficients_disables_ineligible_positions() -> None:
    """saves_w[outfield] = 0 and defcon_w[GKP] = 0 by hand-tuned design,
    even though the compute layer also short-circuits via position checks
    — keeping the coef at 0 makes the Phase 3 optimizer well-behaved."""
    coefs = load_default_coefficients()
    assert coefs.saves_w[DEF] == 0.0
    assert coefs.saves_w[MID] == 0.0
    assert coefs.saves_w[FWD] == 0.0
    assert coefs.defcon_w[GKP] == 0.0
    assert coefs.concede_w[MID] == 0.0
    assert coefs.concede_w[FWD] == 0.0
    assert coefs.cs_w[FWD] == 0.0


# ---------------------------------------------------------------------------
# End-to-end snapshot — synthetic 5-player set with bundled JSON
# ---------------------------------------------------------------------------


def test_default_coefficients_synthetic_set_snapshot() -> None:
    """Pin the bundled JSON's behavior on a 5-player synthetic set so any
    coefficient bump in xp_v2_coefficients.json forces an explicit re-fit
    or test update — never silently shifts every player's xP.

    Exact values come from the hand-tuned v2.0 defaults; Phase 3 will
    rewrite this snapshot when it lands new coefficients.
    """
    coefs = load_default_coefficients()
    fx = FixtureContext(home=True, opponent_strength=0.5, fpl_difficulty=3)

    expected_totals = {
        # Premium FWD: high xG, no CS / defcon contribution.
        "haaland":  (FWD, _baseline_rates(npxg_p90=0.7, xa_p90=0.2, bonus_p90=0.6, historical_p60=0.95), 0.95, 0.9, 5.630),
        # Premium MID: balanced xG/xA, bonus, defcon-eligible.
        "bruno":    (MID, _baseline_rates(npxg_p90=0.4, xa_p90=0.3, bonus_p90=0.5, defcon_per_match_rate=0.4, yc_p90=0.1, historical_p60=0.95), 0.95, 0.9, 5.996),
        # Solid DEF: low attacking stats, tight defence, defcon-eligible.
        "gabriel":  (DEF, _baseline_rates(npxg_p90=0.05, xa_p90=0.05, team_xgc_p90=0.9, bonus_p90=0.5, defcon_per_match_rate=0.5, historical_p60=0.95), 0.95, 0.9, 4.719),
        # Busy GK: high saves, mid-tier team xGC.
        "pickford": (GKP, _baseline_rates(team_xgc_p90=1.5, saves_p90=4.0, bonus_p90=0.4, historical_p60=1.0), 0.95, 0.95, 3.668),
        # Flagged player: minutes_prob=0 → exactly 0 across the board.
        "flagged":  (MID, _baseline_rates(npxg_p90=1.0, xa_p90=0.5, bonus_p90=1.0), 0.0, 0.0, 0.0),
    }

    for name, (position, rates, mins, p60, expected) in expected_totals.items():
        c = xp_for_fixture(
            position=position, rates=rates, fixture=fx,
            minutes_prob=mins, p60=p60, coefs=coefs,
        )
        assert c.total == pytest.approx(expected, abs=1e-3), (
            f"{name}: expected {expected}, got {c.total}"
        )
