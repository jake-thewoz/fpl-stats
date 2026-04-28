"""Snapshot tests for the backtest report renderer."""
from __future__ import annotations

from backtest import BacktestRow, evaluate_pass_criteria
from backtest_report import render_backtest_report
from xp_v2 import DEF, FWD, GKP, MID


def _row(*, round_=1, position=MID, v1=0.0, v2=0.0, actual=0.0) -> BacktestRow:
    return BacktestRow(
        player_id=1, round=round_, position=position,
        v1_pred=v1, v2_pred=v2, actual_total=actual,
    )


def test_report_renders_pass_verdict_when_all_criteria_pass() -> None:
    rows = [_row(round_=r, v1=2.0, v2=3.0, actual=3.0) for r in (1, 2, 3)]
    pc = evaluate_pass_criteria(
        mae_v1=1.0, mae_v2=0.5,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={MID: 1.0}, mae_v2_by_pos={MID: 0.5},
        captain_v1=10.0, captain_v2=15.0,
    )
    report = render_backtest_report(
        rows=rows, pass_criteria=pc,
        backtest_date="2026-04-28",
        coefficients_model_version="bundled JSON",
    )
    assert "v2 PASSES all criteria" in report
    assert "Phase 5" in report  # readiness call-out
    assert "## Per-model overall metrics" in report
    assert "## Per-position MAE" in report
    assert "## Approximations to keep in mind" in report
    # All four criteria checkmarks present.
    for label in ("MAE overall", "Spearman", "regress", "Captain pick"):
        assert label in report


def test_report_renders_fail_verdict_with_failure_list() -> None:
    rows = [_row(round_=1, v1=2.0, v2=2.0, actual=3.0)]
    pc = evaluate_pass_criteria(
        mae_v1=0.5, mae_v2=1.5,                         # fails
        spearman_v1=0.6, spearman_v2=0.4,               # fails
        mae_v1_by_pos={}, mae_v2_by_pos={},
        captain_v1=10.0, captain_v2=15.0,
    )
    report = render_backtest_report(
        rows=rows, pass_criteria=pc,
        backtest_date="2026-04-28",
        coefficients_model_version="bundled JSON",
    )
    assert "v2 FAILS" in report
    assert "mae_overall" in report
    assert "spearman_overall" in report


def test_report_marks_regressing_positions() -> None:
    """Per-position MAE table should flag positions that regressed >5%.

    Setup: MID gets better in v2, DEF gets meaningfully worse — both
    in the rows themselves (the renderer recomputes from rows, not from
    pre-aggregated pass_criteria values, so the test data has to really
    show the regression)."""
    rows = [
        # MID improves: v1 off by 1, v2 off by 0.5.
        _row(round_=1, position=MID, v1=3.0, v2=2.5, actual=2.0),
        # DEF regresses: v1 off by 0.5, v2 off by 2.5.
        _row(round_=1, position=DEF, v1=2.0, v2=4.0, actual=1.5),
    ]
    pc = evaluate_pass_criteria(
        mae_v1=0.75, mae_v2=1.5,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={MID: 1.0, DEF: 0.5},
        mae_v2_by_pos={MID: 0.5, DEF: 2.5},  # DEF +400%, well over 5%
        captain_v1=10.0, captain_v2=15.0,
    )
    report = render_backtest_report(
        rows=rows, pass_criteria=pc,
        backtest_date="2026-04-28",
        coefficients_model_version="bundled JSON",
    )
    # ⚠ marker on DEF row
    assert "⚠" in report


def test_report_handles_empty_rows() -> None:
    """Edge case: no scorable rows. Renderer shouldn't crash."""
    pc = evaluate_pass_criteria(
        mae_v1=0.0, mae_v2=0.0,
        spearman_v1=0.0, spearman_v2=0.0,
        mae_v1_by_pos={}, mae_v2_by_pos={},
        captain_v1=0.0, captain_v2=0.0,
    )
    report = render_backtest_report(
        rows=[], pass_criteria=pc,
        backtest_date="2026-04-28",
        coefficients_model_version="bundled JSON",
    )
    assert "GW range**: (none)" in report
    assert "Rows backtested**: 0" in report
