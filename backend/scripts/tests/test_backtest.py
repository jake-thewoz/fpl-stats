"""Unit tests for backtest.py — metrics + pass criteria."""
from __future__ import annotations

import pytest

from backtest import (
    BacktestRow,
    captain_pick_actual_total,
    evaluate_pass_criteria,
    mae_by_position,
    mae_overall,
    spearman_by_position,
    spearman_overall,
    top_k_hit_rate,
)
from xp_v2 import DEF, FWD, GKP, MID


def _row(*, player_id=1, round_=1, position=MID,
         v1=0.0, v2=0.0, actual=0.0) -> BacktestRow:
    return BacktestRow(
        player_id=player_id, round=round_, position=position,
        v1_pred=v1, v2_pred=v2, actual_total=actual,
    )


# ---------------------------------------------------------------------------
# Per-model overall + per-position metrics
# ---------------------------------------------------------------------------


def test_mae_overall_picks_correct_model_column() -> None:
    """MAE for v1 and v2 should differ when the predictions differ."""
    rows = [
        _row(v1=1.0, v2=3.0, actual=2.0),  # |v1-2|=1, |v2-2|=1
        _row(v1=4.0, v2=4.5, actual=4.0),  # |v1-4|=0, |v2-4|=0.5
    ]
    assert mae_overall(rows, model="v1") == pytest.approx(0.5)
    assert mae_overall(rows, model="v2") == pytest.approx(0.75)


def test_mae_by_position_groups_correctly() -> None:
    rows = [
        _row(position=MID, v2=5.0, actual=6.0),
        _row(position=MID, v2=3.0, actual=2.0),
        _row(position=FWD, v2=4.0, actual=4.0),
    ]
    out = mae_by_position(rows, model="v2")
    assert out[MID] == pytest.approx(1.0)  # mean of 1.0, 1.0
    assert out[FWD] == pytest.approx(0.0)


def test_spearman_overall_perfect_rank() -> None:
    rows = [_row(v2=t, actual=t * 2 + 1) for t in (1.0, 2.0, 3.0, 4.0)]
    assert spearman_overall(rows, model="v2") == pytest.approx(1.0)


def test_spearman_by_position_skips_singletons() -> None:
    rows = [_row(position=MID, v2=1.0, actual=2.0)]
    assert MID not in spearman_by_position(rows, model="v2")


# ---------------------------------------------------------------------------
# top_k_hit_rate
# ---------------------------------------------------------------------------


def test_top_k_hit_rate_counts_per_gw() -> None:
    """Per-GW top-K, then average across GWs.

    GW1: predict order [a, b, c, d] with actuals [10, 8, 3, 2].
    Top 2 = [a, b], both ≥ 6 → hit rate 1.0.
    GW2: predict order [e, f] with actuals [5, 1].
    Top 2 = [e, f], one ≥ 6 (no, 5<6) → hit rate 0.0.
    Average across GWs = 0.5.
    """
    rows = [
        _row(round_=1, v2=10, actual=10),
        _row(round_=1, v2=9, actual=8),
        _row(round_=1, v2=5, actual=3),
        _row(round_=1, v2=4, actual=2),
        _row(round_=2, v2=8, actual=5),
        _row(round_=2, v2=2, actual=1),
    ]
    assert top_k_hit_rate(rows, model="v2", k=2, threshold=6.0) == pytest.approx(0.5)


def test_top_k_hit_rate_empty_returns_zero() -> None:
    assert top_k_hit_rate([], model="v2") == 0.0


def test_top_k_hit_rate_uses_predicted_for_ranking() -> None:
    """Same actuals, swap predictions → ranking flips, hit rate flips.

    Actuals [10, 1]. v1 thinks ranking is [a, b]: top 1 hits.
    v2 thinks ranking is [b, a]: top 1 misses.
    """
    rows = [
        _row(round_=1, v1=10, v2=1, actual=10),  # actual high
        _row(round_=1, v1=1, v2=10, actual=1),   # actual low
    ]
    assert top_k_hit_rate(rows, model="v1", k=1, threshold=6.0) == 1.0
    assert top_k_hit_rate(rows, model="v2", k=1, threshold=6.0) == 0.0


# ---------------------------------------------------------------------------
# captain_pick_actual_total
# ---------------------------------------------------------------------------


def test_captain_pick_picks_top_predicted_each_gw() -> None:
    """For each GW, sum the actual total of the model's #1 predicted player.
    Across the window, sum these totals.

    GW1: top is row[0] with v2=10, actual=12.
    GW2: top is row[2] with v2=8, actual=4.
    Total = 12 + 4 = 16.
    """
    rows = [
        _row(round_=1, v2=10, actual=12),
        _row(round_=1, v2=5, actual=20),  # higher actual but lower predicted
        _row(round_=2, v2=8, actual=4),
        _row(round_=2, v2=3, actual=15),
    ]
    assert captain_pick_actual_total(rows, model="v2") == pytest.approx(16.0)


def test_captain_pick_v1_v2_differ_on_same_data() -> None:
    """Different rankings → different captains → different totals."""
    rows = [
        _row(round_=1, v1=10, v2=1, actual=12),
        _row(round_=1, v1=1, v2=10, actual=4),
    ]
    assert captain_pick_actual_total(rows, model="v1") == 12.0
    assert captain_pick_actual_total(rows, model="v2") == 4.0


# ---------------------------------------------------------------------------
# evaluate_pass_criteria
# ---------------------------------------------------------------------------


def test_pass_criteria_all_pass_when_v2_strictly_better() -> None:
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.2,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={MID: 1.5, FWD: 1.4},
        mae_v2_by_pos={MID: 1.2, FWD: 1.3},
        captain_v1=100.0, captain_v2=120.0,
    )
    assert result.ok
    assert result.failures == []


def test_pass_criteria_fails_on_mae_tie() -> None:
    """Criterion 1 requires STRICTLY less. Equality fails."""
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.5,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={}, mae_v2_by_pos={},
        captain_v1=100.0, captain_v2=120.0,
    )
    assert not result.ok
    assert "mae_overall" in result.failures


def test_pass_criteria_passes_on_spearman_tie() -> None:
    """Criterion 2 requires v2 ≥ v1 — equality is acceptable."""
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.2,
        spearman_v1=0.5, spearman_v2=0.5,  # exactly equal
        mae_v1_by_pos={}, mae_v2_by_pos={},
        captain_v1=100.0, captain_v2=120.0,
    )
    assert result.ok
    assert "spearman_overall" not in result.failures


def test_pass_criteria_fails_on_position_regression() -> None:
    """A position regressing >5% on MAE fails criterion 3."""
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.2,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={MID: 1.0, FWD: 1.5},
        mae_v2_by_pos={MID: 1.5, FWD: 1.0},  # MID regresses 50%
        captain_v1=100.0, captain_v2=120.0,
    )
    assert not result.ok
    assert "per_position_regression" in result.failures
    assert "MID" not in result.detail["per_position_regression"]  # uses pos id (3)
    assert "pos 3" in result.detail["per_position_regression"]


def test_pass_criteria_tolerates_4_percent_regression() -> None:
    """Default tolerance is 5%, so a 4% per-position regression passes."""
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.2,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={MID: 1.0},
        mae_v2_by_pos={MID: 1.04},  # +4% — within tolerance
        captain_v1=100.0, captain_v2=120.0,
    )
    assert result.ok


def test_pass_criteria_fails_on_captain_regression() -> None:
    result = evaluate_pass_criteria(
        mae_v1=1.5, mae_v2=1.2,
        spearman_v1=0.5, spearman_v2=0.6,
        mae_v1_by_pos={}, mae_v2_by_pos={},
        captain_v1=120.0, captain_v2=100.0,  # v2 captains worse
    )
    assert not result.ok
    assert "captain_pick_total" in result.failures


def test_pass_criteria_lists_all_failures() -> None:
    """When multiple criteria fail, the report should be able to list
    every one — failures is a complete list, not just the first."""
    result = evaluate_pass_criteria(
        mae_v1=1.0, mae_v2=2.0,                         # fails (1)
        spearman_v1=0.6, spearman_v2=0.4,               # fails (2)
        mae_v1_by_pos={MID: 1.0}, mae_v2_by_pos={MID: 2.0},  # regression (3)
        captain_v1=120.0, captain_v2=100.0,             # fails (4)
    )
    assert not result.ok
    assert set(result.failures) == {
        "mae_overall", "spearman_overall",
        "per_position_regression", "captain_pick_total",
    }
