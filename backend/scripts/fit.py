"""Pure fit functions for xp-v2 calibration.

Phase 3 v2.0 does **mean-matching per (component, position)**:

    new_w[component][pos] = old_w[component][pos]
                            × sum(actual_component_xp_for_pos)
                            / sum(predicted_component_xp_for_pos)

This is the simplest calibration that produces per-position-correct
component contributions on the training set. It assumes the existing
fixture-factor coefficients (``home_advantage``, ``opp_strength_w_*``)
are good enough — those are not re-fit here because the training rows
don't carry an ``opponent_strength`` signal yet, so any "fit" of the
opp slopes would be uninformed (see README for the deferred plan).

If the predicted contribution is zero (component disabled for that
position, or no historical exposure to it), the weight is left at
its prior value rather than divided-by-zero.

Decompose actual outcomes into per-component points
---------------------------------------------------
``decompose_actual_xp`` walks an FPL history row and returns the same
``XpV2Components`` shape that ``xp_for_fixture`` produces — so a fit
loop can directly compare predicted and actual component-by-component.
``minutes_prob`` is set to 1.0 / 0.0 from observed minutes; we know
exactly whether the player played, so the historical fit isolates the
per-90 rates and component weights from the (separate) availability
problem.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from typing import Iterable, Mapping

from schemas import PlayerHistoryRow
from xp_v2 import (
    DEF,
    DEFAULT_RULES,
    DEFCON_ELIGIBLE,
    GKP,
    ScoringRules,
    V2Coefficients,
    XpV2Components,
)


# Components the fit operates on. Ordering only affects report layout.
FIT_COMPONENTS: tuple[str, ...] = (
    "goals", "assists", "cs", "concede", "saves", "defcon", "bonus",
)


@dataclass(frozen=True)
class FitPair:
    """One training/validation pair: features → predictions paired with
    the actual outcomes for the same (player, GW)."""

    player_id: int
    round: int
    position: int
    predicted: XpV2Components
    actual: XpV2Components


def decompose_actual_xp(
    *,
    position: int,
    row: PlayerHistoryRow,
    rules: ScoringRules = DEFAULT_RULES,
) -> XpV2Components:
    """Reduce an actual FPL history row to ``XpV2Components`` so the fit
    can compare predicted vs actual per component.

    ``minutes_prob`` and ``p60`` are set to 1.0 / 0.0 from observed minutes.
    The total field is the FPL-rule-implied total of the per-component
    points (NOT ``row.total_points`` — bonus is BPS-driven and doesn't
    line up perfectly with our component decomposition; the test report
    surfaces both numbers for sanity-checking).
    """
    minutes = row.minutes
    p60 = 1.0 if minutes >= 60 else 0.0
    p_any = 1.0 if minutes > 0 else 0.0

    appearance = (
        p60 * rules.appearance_long
        + max(0.0, p_any - p60) * rules.appearance_short
    )
    goals = row.goals_scored * rules.goal_pts[position]
    assists = row.assists * rules.assist_pts
    cs = (
        rules.clean_sheet_pts[position]
        if (row.clean_sheets and minutes >= 60)
        else 0.0
    )
    if position in (GKP, DEF) and minutes >= 60:
        concede = -1.0 * (row.goals_conceded // rules.concede_per_penalty)
    else:
        concede = 0.0
    saves = (row.saves // rules.saves_per_point) if position == GKP else 0.0
    bonus = float(row.bonus)

    if position in DEFCON_ELIGIBLE and minutes > 0:
        threshold = (
            rules.defcon_threshold_def if position == DEF
            else rules.defcon_threshold_outfield
        )
        defcon = (
            rules.defcon_pts
            if (row.defensive_contribution or 0) >= threshold
            else 0.0
        )
    else:
        defcon = 0.0

    discipline = (
        rules.yc_pts * row.yellow_cards
        + rules.rc_pts * row.red_cards
    )

    total = (
        appearance + goals + assists + cs + concede
        + saves + bonus + defcon + discipline
    )
    return XpV2Components(
        minutes_prob=p_any,
        p60=p60,
        appearance_xp=appearance,
        goals_xp=goals,
        assists_xp=assists,
        cs_xp=cs,
        concede_xp=concede,
        saves_xp=saves,
        bonus_xp=bonus,
        defcon_xp=defcon,
        discipline_xp=discipline,
        total=total,
    )


def _component_value(components: XpV2Components, name: str) -> float:
    """Pull the component's value off an ``XpV2Components`` by name —
    saves a long if/elif chain in the fit loop."""
    return getattr(components, f"{name}_xp")


def fit_per_component_weights(
    *,
    pairs: Iterable[FitPair],
    coefs: V2Coefficients,
) -> V2Coefficients:
    """Mean-match each ``<component>_w[position]`` to the training pairs.

    For each (component, position) bucket: the predicted contributions
    sum to P, the actual contributions sum to A, and we set the new
    weight to ``old_w × A / P``. If the bucket has no exposure
    (e.g. saves for outfield positions, or zero predicted contribution
    on the training data), the weight is left untouched.

    Concede points are negative — both actual and predicted come out
    negative — so the ratio is well-defined and the result has the same
    sign convention.
    """
    pair_list = list(pairs)
    sums_pred: dict[tuple[str, int], float] = defaultdict(float)
    sums_actual: dict[tuple[str, int], float] = defaultdict(float)
    for pair in pair_list:
        for component in FIT_COMPONENTS:
            sums_pred[(component, pair.position)] += _component_value(
                pair.predicted, component
            )
            sums_actual[(component, pair.position)] += _component_value(
                pair.actual, component
            )

    new_weights: dict[str, dict[int, float]] = {
        component: dict(getattr(coefs, f"{component}_w"))
        for component in FIT_COMPONENTS
    }
    for (component, position), pred in sums_pred.items():
        if pred == 0:
            continue  # leave weight at prior — no signal to update from
        ratio = sums_actual[(component, position)] / pred
        new_weights[component][position] = (
            new_weights[component][position] * ratio
        )

    return replace(
        coefs,
        goals_w=new_weights["goals"],
        assists_w=new_weights["assists"],
        cs_w=new_weights["cs"],
        concede_w=new_weights["concede"],
        saves_w=new_weights["saves"],
        defcon_w=new_weights["defcon"],
        bonus_w=new_weights["bonus"],
    )


def predicted_total_per_position(pairs: Iterable[FitPair]) -> dict[int, float]:
    """Sum predicted total xP per position — used by the report to
    compute level metrics."""
    out: dict[int, float] = defaultdict(float)
    for pair in pairs:
        out[pair.position] += pair.predicted.total
    return dict(out)


def actual_total_per_position(pairs: Iterable[FitPair]) -> dict[int, float]:
    """Sum actual total xP per position — same shape as above for the
    actual side. ``actual.total`` is the FPL-rule-implied total
    (decompose_actual_xp), not ``row.total_points``."""
    out: dict[int, float] = defaultdict(float)
    for pair in pairs:
        out[pair.position] += pair.actual.total
    return dict(out)


def time_series_split(
    pairs: Iterable[FitPair],
    *,
    holdout_last_n_rounds: int,
) -> tuple[list[FitPair], list[FitPair]]:
    """Split pairs into (train, validation) by GW number.

    All pairs whose ``round`` is in the last ``holdout_last_n_rounds``
    of the dataset go to validation; the rest to train. Random splits
    leak future info into the past, so always use a temporal split.
    """
    pair_list = sorted(pairs, key=lambda p: p.round)
    if not pair_list:
        return [], []
    last_round = pair_list[-1].round
    cutoff = last_round - holdout_last_n_rounds
    train = [p for p in pair_list if p.round <= cutoff]
    validation = [p for p in pair_list if p.round > cutoff]
    return train, validation


def mae_per_position(pairs: Iterable[FitPair]) -> dict[int, float]:
    """Mean absolute error of predicted vs actual total xP, per position."""
    by_pos: dict[int, list[float]] = defaultdict(list)
    for pair in pairs:
        by_pos[pair.position].append(
            abs(pair.predicted.total - pair.actual.total)
        )
    return {pos: sum(v) / len(v) for pos, v in by_pos.items() if v}


def spearman_per_position(pairs: Iterable[FitPair]) -> dict[int, float]:
    """Spearman rank correlation between predicted and actual total xP,
    per position. Implemented inline (no scipy dep) — the data is small
    and Spearman is just Pearson on ranks."""
    by_pos: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for pair in pairs:
        by_pos[pair.position].append((pair.predicted.total, pair.actual.total))
    out: dict[int, float] = {}
    for pos, points in by_pos.items():
        if len(points) < 2:
            continue
        out[pos] = _spearman(points)
    return out


def _spearman(points: list[tuple[float, float]]) -> float:
    """Spearman ρ on a list of (x, y) tuples. Tied ranks averaged."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    rx = _rank_with_ties(xs)
    ry = _rank_with_ties(ys)
    n = len(rx)
    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n
    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    den_x = (sum((rx[i] - mean_rx) ** 2 for i in range(n))) ** 0.5
    den_y = (sum((ry[i] - mean_ry) ** 2 for i in range(n))) ** 0.5
    if den_x == 0 or den_y == 0:
        return 0.0
    return num / (den_x * den_y)


def _rank_with_ties(values: list[float]) -> list[float]:
    """Assign average ranks to tied values — same definition as
    scipy.stats.rankdata with method='average'."""
    indexed = sorted(enumerate(values), key=lambda iv: iv[1])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        while j + 1 < len(indexed) and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j) / 2 + 1  # 1-indexed
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    return ranks


def coefficient_diffs(
    *,
    before: V2Coefficients,
    after: V2Coefficients,
) -> list[tuple[str, int, float, float]]:
    """Return (name, position, before_value, after_value) for each
    per-component-per-position weight that changed. Used by the report
    to summarize the effect of one fit run."""
    rows: list[tuple[str, int, float, float]] = []
    for component in FIT_COMPONENTS:
        before_w = getattr(before, f"{component}_w")
        after_w = getattr(after, f"{component}_w")
        for pos in sorted(before_w.keys()):
            b = before_w[pos]
            a = after_w[pos]
            if b != a:
                rows.append((f"{component}_w", pos, b, a))
    return rows
