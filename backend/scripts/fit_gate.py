"""Checks a fit must pass before its weights are written.

Two layers: sanity checks on the weights themselves (no sign flip,
nothing absurd), and the ship gate, which compares old and new weights
on the validation set and only lets the new ones through if they are
better overall without hurting any position.
"""
from __future__ import annotations

from dataclasses import dataclass

from fit import (
    FIT_COMPONENTS,
    POSITION_NAMES,
    FitPair,
    mae_overall,
    mae_per_position,
    spearman_overall,
    spearman_per_position,
)
from xp_v2 import V2Coefficients

MIN_PLAUSIBLE_WEIGHT = 0.05
MAX_PLAUSIBLE_WEIGHT = 5.0

# Largest relative MAE increase allowed for any single position.
MAX_POSITION_MAE_REGRESSION = 0.01
# Largest drop in overall Spearman ρ allowed.
MAX_SPEARMAN_DROP = 0.005


@dataclass(frozen=True)
class SanityCheck:
    label: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class ValidationMetrics:
    mae_overall: float | None
    spearman_overall: float | None
    mae_by_position: dict[int, float]
    spearman_by_position: dict[int, float]


@dataclass(frozen=True)
class ShipGate:
    failures: list[str]

    @property
    def ok(self) -> bool:
        return not self.failures


def validation_metrics(pairs: list[FitPair]) -> ValidationMetrics:
    return ValidationMetrics(
        mae_overall=mae_overall(pairs),
        spearman_overall=spearman_overall(pairs),
        mae_by_position=mae_per_position(pairs),
        spearman_by_position=spearman_per_position(pairs),
    )


def sanity_checks(before: V2Coefficients, after: V2Coefficients) -> list[SanityCheck]:
    sign_flips: list[str] = []
    extreme: list[str] = []
    for component in FIT_COMPONENTS:
        before_weights = getattr(before, f"{component}_w")
        after_weights = getattr(after, f"{component}_w")
        for position, before_weight in before_weights.items():
            after_weight = after_weights[position]
            if before_weight * after_weight < 0:
                sign_flips.append(f"{component}_w[{position}]: {before_weight}→{after_weight}")
            # Already 0 means an ineligible position (e.g. saves_w[DEF]);
            # a weight that only just reached 0 must still be flagged.
            if after_weight == 0 and before_weight == 0:
                continue
            if not MIN_PLAUSIBLE_WEIGHT <= abs(after_weight) <= MAX_PLAUSIBLE_WEIGHT:
                extreme.append(f"{component}_w[{position}]={after_weight:.3f}")
    return [
        SanityCheck("No weight flipped sign", not sign_flips, ", ".join(sign_flips)),
        SanityCheck(
            f"All weights in plausible range "
            f"({MIN_PLAUSIBLE_WEIGHT} ≤ |w| ≤ {MAX_PLAUSIBLE_WEIGHT:g})",
            not extreme,
            ", ".join(extreme),
        ),
    ]


def evaluate_ship_gate(
    *,
    before: ValidationMetrics,
    after: ValidationMetrics,
    checks: list[SanityCheck],
) -> ShipGate:
    """Every rule the new weights broke, as a sentence. Empty means ship."""
    failures: list[str] = []

    if before.mae_overall is None or after.mae_overall is None:
        failures.append("No validation rows, so the fit cannot be judged.")
        return ShipGate(failures)

    if after.mae_overall >= before.mae_overall:
        failures.append(
            f"Overall MAE did not improve ({before.mae_overall:.3f} → {after.mae_overall:.3f})."
        )

    for position, mae_before in sorted(before.mae_by_position.items()):
        mae_after = after.mae_by_position.get(position)
        if mae_after is None:
            continue
        if mae_after > mae_before * (1 + MAX_POSITION_MAE_REGRESSION):
            failures.append(
                f"{POSITION_NAMES.get(position, position)} MAE worsened by more than "
                f"{MAX_POSITION_MAE_REGRESSION:.0%} ({mae_before:.3f} → {mae_after:.3f})."
            )

    if before.spearman_overall is not None and after.spearman_overall is not None:
        if after.spearman_overall < before.spearman_overall - MAX_SPEARMAN_DROP:
            failures.append(
                f"Overall Spearman ρ dropped by more than {MAX_SPEARMAN_DROP} "
                f"({before.spearman_overall:.3f} → {after.spearman_overall:.3f})."
            )

    for check in checks:
        if not check.ok:
            failures.append(f"Sanity check failed: {check.label} ({check.detail}).")

    return ShipGate(failures)
