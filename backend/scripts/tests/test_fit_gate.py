"""Tests for the fit's sanity checks and ship gate."""
from __future__ import annotations

from fit_gate import (
    MAX_POSITION_MAE_REGRESSION,
    MAX_SPEARMAN_DROP,
    SanityCheck,
    ValidationMetrics,
    evaluate_ship_gate,
    sanity_checks,
)
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients

BASE_MAE = 2.0
BASE_SPEARMAN = 0.5
SMALL_IMPROVEMENT = 0.1


def _coefs(goals_mid: float = 1.0) -> V2Coefficients:
    return V2Coefficients(
        goals_w={GKP: 1.0, DEF: 1.0, MID: goals_mid, FWD: 1.0},
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


def _metrics(
    *,
    mae: float = BASE_MAE,
    spearman: float = BASE_SPEARMAN,
    mae_by_position: dict[int, float] | None = None,
) -> ValidationMetrics:
    return ValidationMetrics(
        mae_overall=mae,
        spearman_overall=spearman,
        mae_by_position=mae_by_position or {position: mae for position in (GKP, DEF, MID, FWD)},
        spearman_by_position={},
    )


PASSING_CHECKS = [SanityCheck("fine", True, "")]


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------


def _check(checks: list[SanityCheck], label_start: str) -> SanityCheck:
    return next(check for check in checks if check.label.startswith(label_start))


def test_sanity_flags_sign_flip() -> None:
    checks = sanity_checks(_coefs(goals_mid=1.0), _coefs(goals_mid=-0.5))

    assert not _check(checks, "No weight flipped sign").ok


def test_sanity_flags_extreme_weight() -> None:
    checks = sanity_checks(_coefs(), _coefs(goals_mid=10.0))

    assert not _check(checks, "All weights in plausible range").ok


def test_sanity_flags_weight_that_collapsed_to_zero() -> None:
    """A weight that was non-zero and is now exactly 0 must fail, not be
    mistaken for an ineligible position."""
    check = _check(sanity_checks(_coefs(), _coefs(goals_mid=0.0)), "All weights in plausible range")

    assert not check.ok
    assert "goals_w[3]=0.000" in check.detail


def test_sanity_ignores_weight_that_was_already_zero() -> None:
    """Ineligible positions (cs_w[FWD], saves_w[DEF], ...) sit at 0 on both sides."""
    checks = sanity_checks(_coefs(), _coefs())

    assert all(check.ok for check in checks)


# ---------------------------------------------------------------------------
# Ship gate
# ---------------------------------------------------------------------------


def test_gate_passes_when_every_rule_holds() -> None:
    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(mae=BASE_MAE - SMALL_IMPROVEMENT),
        checks=PASSING_CHECKS,
    )

    assert gate.ok
    assert gate.failures == []


def test_gate_fails_when_overall_mae_does_not_improve() -> None:
    gate = evaluate_ship_gate(before=_metrics(), after=_metrics(), checks=PASSING_CHECKS)

    assert not gate.ok
    assert any("Overall MAE" in failure for failure in gate.failures)


def test_gate_fails_when_one_position_regresses_past_tolerance() -> None:
    worse_gk = BASE_MAE * (1 + 2 * MAX_POSITION_MAE_REGRESSION)
    after_by_position = {GKP: worse_gk, DEF: 1.0, MID: 1.0, FWD: 1.0}

    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(mae=BASE_MAE - SMALL_IMPROVEMENT, mae_by_position=after_by_position),
        checks=PASSING_CHECKS,
    )

    assert gate.failures == [
        f"GK MAE worsened by more than 1% ({BASE_MAE:.3f} → {worse_gk:.3f})."
    ]


def test_gate_allows_position_regression_within_tolerance() -> None:
    slightly_worse_gk = BASE_MAE * (1 + MAX_POSITION_MAE_REGRESSION / 2)
    after_by_position = {GKP: slightly_worse_gk, DEF: 1.0, MID: 1.0, FWD: 1.0}

    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(mae=BASE_MAE - SMALL_IMPROVEMENT, mae_by_position=after_by_position),
        checks=PASSING_CHECKS,
    )

    assert gate.ok


def test_gate_fails_when_spearman_drops_past_tolerance() -> None:
    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(
            mae=BASE_MAE - SMALL_IMPROVEMENT,
            spearman=BASE_SPEARMAN - 2 * MAX_SPEARMAN_DROP,
        ),
        checks=PASSING_CHECKS,
    )

    assert len(gate.failures) == 1
    assert "Spearman" in gate.failures[0]


def test_gate_allows_spearman_drop_within_tolerance() -> None:
    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(
            mae=BASE_MAE - SMALL_IMPROVEMENT,
            spearman=BASE_SPEARMAN - MAX_SPEARMAN_DROP / 2,
        ),
        checks=PASSING_CHECKS,
    )

    assert gate.ok


def test_gate_fails_on_a_failed_sanity_check() -> None:
    gate = evaluate_ship_gate(
        before=_metrics(),
        after=_metrics(mae=BASE_MAE - SMALL_IMPROVEMENT),
        checks=[SanityCheck("No weight flipped sign", False, "goals_w[3]: 1.0→-0.5")],
    )

    assert gate.failures == [
        "Sanity check failed: No weight flipped sign (goals_w[3]: 1.0→-0.5)."
    ]


def test_gate_fails_without_validation_rows() -> None:
    empty = ValidationMetrics(None, None, {}, {})

    gate = evaluate_ship_gate(before=empty, after=empty, checks=PASSING_CHECKS)

    assert not gate.ok
