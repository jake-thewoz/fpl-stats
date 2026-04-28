"""Backtest core: BacktestRow + per-position metrics + pass criteria.

The backtest evaluates v1 and v2 against actual outcomes on the same
historical rows. ``BacktestRow`` carries both predictions side-by-side
so each metric can be computed once across both models without
threading parallel data structures.

Pass criteria for v2 to ship (v2 must beat v1)
----------------------------------------------
1. **MAE overall**: v2 strictly < v1
2. **Spearman ρ overall**: v2 ≥ v1 (rank correlation drives transfer
   suggestions and captain picks; small ties are acceptable)
3. **Per-position MAE regression**: no position regresses by >5%
4. **Captain pick total**: v2 ≥ v1 (sum of actual points scored by
   each model's top-ranked player per GW, across the backtest window)

A model can fail (1) but pass (2-4) — useful diagnostic. The report
surfaces every check so the human reviewer can see *why* a fail
happened, not just that it did.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from fit import _spearman

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class BacktestRow:
    """One historical fixture row with both models' predictions and the
    actual total. ``actual_total`` uses ``decompose_actual_xp`` (FPL-rule
    sum) rather than ``row.total_points`` so v1/v2/actual share the same
    per-component arithmetic — bonus points especially are BPS-rank-
    driven and don't decompose perfectly into our component bucket
    structure, but reporting the same total convention everywhere keeps
    metrics interpretable."""

    player_id: int
    round: int
    position: int
    v1_pred: float
    v2_pred: float
    actual_total: float


def mae_overall(rows: Iterable[BacktestRow], *, model: str) -> float:
    """Mean absolute error across every row, for one model.

    ``model`` is ``"v1"`` or ``"v2"`` — picks which prediction to score.
    """
    pred_attr = f"{model}_pred"
    errs = [abs(getattr(r, pred_attr) - r.actual_total) for r in rows]
    if not errs:
        return 0.0
    return sum(errs) / len(errs)


def spearman_overall(rows: Iterable[BacktestRow], *, model: str) -> float:
    """Spearman ρ across every row (no position split), for one model."""
    rows_list = list(rows)
    if len(rows_list) < 2:
        return 0.0
    pred_attr = f"{model}_pred"
    points = [(getattr(r, pred_attr), r.actual_total) for r in rows_list]
    return _spearman(points)


def mae_by_position(
    rows: Iterable[BacktestRow], *, model: str,
) -> dict[int, float]:
    """Per-position MAE for one model. Same shape as ``fit.mae_per_position``
    but takes BacktestRow (which has both predictions) and selects one."""
    pred_attr = f"{model}_pred"
    by_pos: dict[int, list[float]] = defaultdict(list)
    for row in rows:
        by_pos[row.position].append(
            abs(getattr(row, pred_attr) - row.actual_total)
        )
    return {pos: sum(v) / len(v) for pos, v in by_pos.items() if v}


def spearman_by_position(
    rows: Iterable[BacktestRow], *, model: str,
) -> dict[int, float]:
    """Per-position Spearman ρ for one model."""
    pred_attr = f"{model}_pred"
    by_pos: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for row in rows:
        by_pos[row.position].append(
            (getattr(row, pred_attr), row.actual_total)
        )
    out: dict[int, float] = {}
    for pos, points in by_pos.items():
        if len(points) < 2:
            continue
        out[pos] = _spearman(points)
    return out


def top_k_hit_rate(
    rows: Iterable[BacktestRow], *, model: str,
    k: int = 10, threshold: float = 6.0,
) -> float:
    """Fraction of (per-GW) top-K predictions that scored ≥ ``threshold``.

    For each GW, take the model's top-K predictions, count how many
    actually scored at least ``threshold`` points. Average across GWs.
    Captures the "if you blindly picked the model's top picks for the
    week, how often did you get a haul?" signal — closer to how a real
    user consumes xP than overall MAE.
    """
    pred_attr = f"{model}_pred"
    by_round: dict[int, list[BacktestRow]] = defaultdict(list)
    for row in rows:
        by_round[row.round].append(row)

    if not by_round:
        return 0.0

    per_gw_rates: list[float] = []
    for gw_rows in by_round.values():
        ranked = sorted(gw_rows, key=lambda r: getattr(r, pred_attr), reverse=True)
        top = ranked[:k]
        if not top:
            continue
        hits = sum(1 for r in top if r.actual_total >= threshold)
        per_gw_rates.append(hits / len(top))
    if not per_gw_rates:
        return 0.0
    return sum(per_gw_rates) / len(per_gw_rates)


def captain_pick_actual_total(
    rows: Iterable[BacktestRow], *, model: str,
) -> float:
    """Sum of actual points scored by each model's #1 prediction per GW.

    The "captain test": if you blindly captained this model's top-ranked
    player every GW, what's your total return across the backtest
    window? FPL captaincy doubles, but for relative comparison we use
    raw actuals (the ratio between v1 and v2 is the same either way).
    """
    pred_attr = f"{model}_pred"
    by_round: dict[int, list[BacktestRow]] = defaultdict(list)
    for row in rows:
        by_round[row.round].append(row)

    total = 0.0
    for gw_rows in by_round.values():
        ranked = sorted(gw_rows, key=lambda r: getattr(r, pred_attr), reverse=True)
        if not ranked:
            continue
        total += ranked[0].actual_total
    return total


@dataclass(frozen=True)
class PassCriteria:
    """Result of evaluating each pass criterion.

    ``ok`` is the conjunction; ``failures`` lists the failed criterion
    names so the report can call them out specifically."""

    ok: bool
    failures: list[str]
    detail: dict[str, str]


def evaluate_pass_criteria(
    *,
    mae_v1: float,
    mae_v2: float,
    spearman_v1: float,
    spearman_v2: float,
    mae_v1_by_pos: dict[int, float],
    mae_v2_by_pos: dict[int, float],
    captain_v1: float,
    captain_v2: float,
    per_position_regression_tolerance: float = 0.05,
) -> PassCriteria:
    """Apply the four pass criteria and return a structured result.

    ``per_position_regression_tolerance``: max acceptable relative
    increase in MAE for any single position (0.05 = 5%)."""

    failures: list[str] = []
    detail: dict[str, str] = {}

    # 1. MAE overall: v2 strictly < v1.
    detail["mae_overall"] = (
        f"v1={mae_v1:.4f}, v2={mae_v2:.4f}, "
        f"delta={mae_v2 - mae_v1:+.4f}"
    )
    if mae_v2 >= mae_v1:
        failures.append("mae_overall")

    # 2. Spearman overall: v2 ≥ v1.
    detail["spearman_overall"] = (
        f"v1={spearman_v1:.4f}, v2={spearman_v2:.4f}, "
        f"delta={spearman_v2 - spearman_v1:+.4f}"
    )
    if spearman_v2 < spearman_v1:
        failures.append("spearman_overall")

    # 3. Per-position regression: no position's MAE regresses >tolerance.
    regressions: list[str] = []
    for pos, mae_v1_pos in mae_v1_by_pos.items():
        mae_v2_pos = mae_v2_by_pos.get(pos)
        if mae_v2_pos is None:
            continue
        if mae_v1_pos == 0:
            continue
        regression = (mae_v2_pos - mae_v1_pos) / mae_v1_pos
        if regression > per_position_regression_tolerance:
            regressions.append(
                f"pos {pos}: v1={mae_v1_pos:.4f} → v2={mae_v2_pos:.4f} "
                f"({regression:+.1%})"
            )
    detail["per_position_regression"] = (
        "all positions within tolerance" if not regressions
        else "; ".join(regressions)
    )
    if regressions:
        failures.append("per_position_regression")

    # 4. Captain pick total: v2 ≥ v1.
    detail["captain_pick_total"] = (
        f"v1={captain_v1:.2f}, v2={captain_v2:.2f}, "
        f"delta={captain_v2 - captain_v1:+.2f}"
    )
    if captain_v2 < captain_v1:
        failures.append("captain_pick_total")

    return PassCriteria(
        ok=not failures,
        failures=failures,
        detail=detail,
    )
