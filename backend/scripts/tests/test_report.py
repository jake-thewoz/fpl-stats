"""Snapshot tests for the markdown fit-report renderer."""
from __future__ import annotations

from fit import FitPair
from report import render_fit_report
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients, XpV2Components


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


def _pair(*, round_: int = 5, total_pred: float = 5.0, total_act: float = 5.0) -> FitPair:
    blank = XpV2Components(
        minutes_prob=1.0, p60=1.0,
        appearance_xp=2.0, goals_xp=0.0, assists_xp=0.0, cs_xp=0.0,
        concede_xp=0.0, saves_xp=0.0, bonus_xp=0.0, defcon_xp=0.0,
        discipline_xp=0.0, total=2.0,
    )
    from dataclasses import replace
    return FitPair(
        player_id=1, round=round_, position=MID,
        predicted=replace(blank, total=total_pred),
        actual=replace(blank, total=total_act),
    )


def test_render_includes_header_train_validation_and_diff_table() -> None:
    """Smoke-render and confirm the major sections are present."""
    report = render_fit_report(
        train=[_pair(round_=1), _pair(round_=2)],
        validation=[_pair(round_=10)],
        coefs_before=_coefs(goals_mid=1.0),
        coefs_after=_coefs(goals_mid=1.5),
        metrics_before={"mae": {MID: 0.8}, "spearman": {MID: 0.4}},
        metrics_after={"mae": {MID: 0.5}, "spearman": {MID: 0.7}},
        fit_date="2026-04-28",
    )
    assert "# xP v2 fit report — 2026-04-28" in report
    assert "Training**: 2 pairs, GW 1–2" in report
    assert "Validation**: 1 pairs, GW 10" in report
    assert "## Coefficient changes" in report
    assert "goals_w" in report
    assert "## Validation metrics (per position)" in report
    assert "## Sanity checks" in report
    # The diff row reflects the 1.0 → 1.5 change with a 1.500 ratio.
    assert "| `goals_w` | MID | 1.0000 | 1.5000 | 1.500 |" in report


def test_render_handles_empty_diff() -> None:
    """No fit happened (or every weight already mean-matched) → friendly
    fallback, not an empty table."""
    report = render_fit_report(
        train=[],
        validation=[],
        coefs_before=_coefs(),
        coefs_after=_coefs(),
        metrics_before={"mae": {}, "spearman": {}},
        metrics_after={"mae": {}, "spearman": {}},
        fit_date="2026-04-28",
    )
    assert "No weights changed" in report


def test_render_flags_sign_flip_in_sanity_checks() -> None:
    """A sign-flipped weight should fail the 'No weight flipped sign'
    check — the reviewer needs to see this immediately."""
    before = _coefs(goals_mid=1.0)
    after = _coefs(goals_mid=-0.5)
    report = render_fit_report(
        train=[], validation=[],
        coefs_before=before, coefs_after=after,
        metrics_before={"mae": {}, "spearman": {}},
        metrics_after={"mae": {}, "spearman": {}},
        fit_date="2026-04-28",
    )
    assert "✗ No weight flipped sign" in report


def test_render_flags_extreme_weight() -> None:
    """A weight outside [0.05, 5.0] should trigger the plausible-range
    sanity check."""
    after = _coefs(goals_mid=10.0)
    report = render_fit_report(
        train=[], validation=[],
        coefs_before=_coefs(), coefs_after=after,
        metrics_before={"mae": {}, "spearman": {}},
        metrics_after={"mae": {}, "spearman": {}},
        fit_date="2026-04-28",
    )
    assert "✗ All weights in plausible range" in report
