"""Markdown fit-report generator.

Output goes to ``backend/scripts/fit_reports/<date>.md`` so the PR diff
shows the human-readable summary alongside the coefficient JSON change.
The reviewer reads the report and sanity-checks before merging.

What every report must surface
------------------------------
1. **Ship gate** — PASS or FAIL, and which rule failed.
2. **Data** — seasons used, rows per season, and the train/validation split.
3. **Coefficient diffs** — what the fit changed, with a ratio column so
   wild swings (>3x or <0.3x) are easy to eyeball, plus the buckets that
   kept their old weight and why.
4. **Validation metrics** — MAE and Spearman ρ, overall and per position.
   Not training metrics: mean-matching trivially zeroes the bias on its
   own data, so only validation shows whether the fit generalizes.
5. **Sanity checks** — no sign flip, no absurd weight.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable

from fit import POSITION_NAMES, FitPair, KeptWeight, coefficient_diffs
from fit_gate import SanityCheck, ShipGate, ValidationMetrics
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients

_REPORT_POSITIONS = (GKP, DEF, MID, FWD)


def render_fit_report(
    *,
    train: list[FitPair],
    validation: list[FitPair],
    rows_loaded_by_season: dict[str, int],
    coefs_before: V2Coefficients,
    coefs_after: V2Coefficients,
    kept: list[KeptWeight],
    metrics_before: ValidationMetrics,
    metrics_after: ValidationMetrics,
    checks: list[SanityCheck],
    gate: ShipGate,
    fit_date: str,
) -> str:
    lines: list[str] = []
    lines.append(f"# xP v2 fit report — {fit_date}")
    lines.append("")
    lines.append(f"**Ship gate: {'PASS' if gate.ok else 'FAIL'}**")
    for failure in gate.failures:
        lines.append(f"- {failure}")
    lines.append("")

    lines.append("## Data")
    lines.append("")
    train_pairs_by_season = Counter(pair.season for pair in train)
    validation_pairs_by_season = Counter(pair.season for pair in validation)
    lines.append("| season | rows loaded | training pairs | validation pairs |")
    lines.append("|---|---|---|---|")
    for season, rows_loaded in sorted(rows_loaded_by_season.items()):
        lines.append(
            f"| {season} | {rows_loaded} | {train_pairs_by_season[season]} | "
            f"{validation_pairs_by_season[season]} |"
        )
    lines.append(
        f"| **total** | {sum(rows_loaded_by_season.values())} | {len(train)} | "
        f"{len(validation)} |"
    )
    lines.append("")
    lines.append(f"- **Training**: {len(train)} pairs, GW {_round_range(train)} per season")
    lines.append(f"- **Validation**: {len(validation)} pairs, GW {_round_range(validation)}")
    lines.append("")

    lines.append("## Coefficient changes")
    lines.append("")
    diffs = coefficient_diffs(before=coefs_before, after=coefs_after)
    if not diffs:
        lines.append("No weights changed. (Either an empty training set or every "
                     "component already mean-matched to its target.)")
    else:
        lines.append("| weight | position | before | after | ratio |")
        lines.append("|---|---|---|---|---|")
        for name, position, before_value, after_value in diffs:
            ratio = f"{after_value / before_value:.3f}" if before_value != 0 else "—"
            lines.append(
                f"| `{name}` | {POSITION_NAMES.get(position, position)} | "
                f"{before_value:.4f} | {after_value:.4f} | {ratio} |"
            )
    lines.append("")

    lines.append("## Weights kept unchanged")
    lines.append("")
    if not kept:
        lines.append("None: every eligible weight was fitted.")
    else:
        lines.append("| weight | position | rows with an event | reason |")
        lines.append("|---|---|---|---|")
        for bucket in kept:
            lines.append(
                f"| `{bucket.component}_w` | {POSITION_NAMES.get(bucket.position, bucket.position)} | "
                f"{bucket.nonzero_actual_rows} | {bucket.reason} |"
            )
    lines.append("")

    lines.append("## Validation metrics")
    lines.append("")
    lines.append("| position | MAE before | MAE after | ρ before | ρ after |")
    lines.append("|---|---|---|---|---|")
    for position in _REPORT_POSITIONS:
        lines.append(
            f"| {POSITION_NAMES[position]} | "
            f"{_fmt(metrics_before.mae_by_position.get(position))} | "
            f"{_fmt(metrics_after.mae_by_position.get(position))} | "
            f"{_fmt(metrics_before.spearman_by_position.get(position))} | "
            f"{_fmt(metrics_after.spearman_by_position.get(position))} |"
        )
    lines.append(
        f"| **overall** | {_fmt(metrics_before.mae_overall)} | "
        f"{_fmt(metrics_after.mae_overall)} | {_fmt(metrics_before.spearman_overall)} | "
        f"{_fmt(metrics_after.spearman_overall)} |"
    )
    lines.append("")

    lines.append("## Sanity checks")
    lines.append("")
    for check in checks:
        marker = "✓" if check.ok else "✗"
        suffix = f" — {check.detail}" if check.detail else ""
        lines.append(f"- {marker} {check.label}{suffix}")
    lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append(
        "- `opp_strength_w_*` and `home_advantage` were **not** re-fit "
        "in this run (see #226)."
    )
    lines.append(
        "- `overall_scale` was **not** re-fit. Per-component "
        "mean-matching already calibrates absolute level."
    )
    lines.append(
        "- Position priors in `xp_v2_priors.json` were **not** re-fit. "
        "They control feature smoothing, not predictions."
    )
    return "\n".join(lines)


def _round_range(pairs: Iterable[FitPair]) -> str:
    rounds = sorted({pair.round for pair in pairs})
    if not rounds:
        return "(none)"
    return f"{rounds[0]}–{rounds[-1]}"


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"
