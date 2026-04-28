"""Markdown fit-report generator.

Output goes to ``backend/scripts/fit_reports/<date>.md`` so the PR diff
shows the human-readable summary alongside the coefficient JSON change.
The reviewer reads the report and sanity-checks before merging.

Three things every report must surface
--------------------------------------
1. **Coefficient diffs** — what the fit changed. A ratio column makes
   wild swings (>3x or <0.3x) easy to eyeball.
2. **Validation metrics** per position — MAE and Spearman ρ. Not
   training metrics, since training mean-matching trivially zeroes the
   bias on its own data; only validation tells us whether we're
   overfitting.
3. **Sanity checks** — assertions the reviewer wants to confirm at a
   glance: no weight has flipped sign, no per-position multiplier is
   absurdly large, etc.
"""
from __future__ import annotations

from typing import Iterable

from fit import FitPair, mae_per_position, spearman_per_position
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients

_POSITION_NAMES = {GKP: "GK", DEF: "DEF", MID: "MID", FWD: "FWD"}


def render_fit_report(
    *,
    train: list[FitPair],
    validation: list[FitPair],
    coefs_before: V2Coefficients,
    coefs_after: V2Coefficients,
    metrics_before: dict[str, dict[int, float]],
    metrics_after: dict[str, dict[int, float]],
    fit_date: str,
) -> str:
    """Compose the markdown body. Inputs are pre-computed metric dicts
    so the renderer stays a pure-format function.

    ``metrics_before`` / ``metrics_after`` shape:
        {"mae": {pos: value, ...}, "spearman": {pos: value, ...}}
    """
    lines: list[str] = []
    lines.append(f"# xP v2 fit report — {fit_date}")
    lines.append("")
    train_rounds = _round_range(train)
    val_rounds = _round_range(validation)
    lines.append(f"- **Training**: {len(train)} pairs, GW {train_rounds}")
    lines.append(f"- **Validation**: {len(validation)} pairs, GW {val_rounds}")
    lines.append("")

    lines.append("## Coefficient changes")
    lines.append("")
    diffs = _coefficient_diffs(coefs_before, coefs_after)
    if not diffs:
        lines.append("No weights changed. (Either an empty training set or every "
                     "component already mean-matched to its target.)")
    else:
        lines.append("| weight | position | before | after | ratio |")
        lines.append("|---|---|---|---|---|")
        for name, pos, b, a in diffs:
            ratio = a / b if b != 0 else float("inf")
            ratio_str = f"{ratio:.3f}" if b != 0 else "—"
            lines.append(
                f"| `{name}` | {_POSITION_NAMES.get(pos, pos)} | "
                f"{b:.4f} | {a:.4f} | {ratio_str} |"
            )
    lines.append("")

    lines.append("## Validation metrics (per position)")
    lines.append("")
    lines.append("| position | MAE before | MAE after | ρ before | ρ after |")
    lines.append("|---|---|---|---|---|")
    for pos in (GKP, DEF, MID, FWD):
        mb = metrics_before["mae"].get(pos)
        ma = metrics_after["mae"].get(pos)
        sb = metrics_before["spearman"].get(pos)
        sa = metrics_after["spearman"].get(pos)
        lines.append(
            f"| {_POSITION_NAMES[pos]} | "
            f"{_fmt(mb)} | {_fmt(ma)} | "
            f"{_fmt(sb)} | {_fmt(sa)} |"
        )
    lines.append("")

    lines.append("## Sanity checks")
    lines.append("")
    checks = _sanity_checks(coefs_before, coefs_after)
    for label, ok, detail in checks:
        marker = "✓" if ok else "✗"
        suffix = f" — {detail}" if detail else ""
        lines.append(f"- {marker} {label}{suffix}")
    lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append(
        "- `opp_strength_w_*` and `home_advantage` were **not** re-fit "
        "in this run — see `backend/scripts/README.md` for the deferred "
        "Phase 3.x plan."
    )
    lines.append(
        "- `overall_scale` was **not** re-fit. Per-component "
        "mean-matching already calibrates absolute level; "
        "`overall_scale` will be revisited if Phase 4 backtest shows "
        "residual bias."
    )
    lines.append(
        "- Position priors in `xp_v2_priors.json` were **not** re-fit. "
        "They control feature smoothing, not predictions; Phase 3.x "
        "will re-fit them from history aggregates."
    )
    return "\n".join(lines)


def _round_range(pairs: Iterable[FitPair]) -> str:
    pair_list = list(pairs)
    if not pair_list:
        return "(none)"
    rounds = sorted({p.round for p in pair_list})
    return f"{rounds[0]}–{rounds[-1]}"


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"


def _coefficient_diffs(
    before: V2Coefficients,
    after: V2Coefficients,
) -> list[tuple[str, int, float, float]]:
    """Same shape as ``fit.coefficient_diffs`` — duplicated locally to
    keep the report self-contained for snapshot testing."""
    components = ("goals", "assists", "cs", "concede", "saves", "defcon", "bonus")
    rows: list[tuple[str, int, float, float]] = []
    for component in components:
        before_w = getattr(before, f"{component}_w")
        after_w = getattr(after, f"{component}_w")
        for pos in sorted(before_w.keys()):
            b = before_w[pos]
            a = after_w[pos]
            if b != a:
                rows.append((f"{component}_w", pos, b, a))
    return rows


def _sanity_checks(
    before: V2Coefficients,
    after: V2Coefficients,
) -> list[tuple[str, bool, str]]:
    """Return (label, ok, detail-when-not-ok) triples."""
    out: list[tuple[str, bool, str]] = []

    sign_flips: list[str] = []
    for component in ("goals", "assists", "cs", "concede", "saves", "defcon", "bonus"):
        before_w = getattr(before, f"{component}_w")
        after_w = getattr(after, f"{component}_w")
        for pos, b in before_w.items():
            a = after_w[pos]
            if (b > 0 and a < 0) or (b < 0 and a > 0):
                sign_flips.append(f"{component}_w[{pos}]: {b}→{a}")
    out.append((
        "No weight flipped sign",
        not sign_flips,
        ", ".join(sign_flips),
    ))

    extreme: list[str] = []
    for component in ("goals", "assists", "cs", "concede", "saves", "defcon", "bonus"):
        after_w = getattr(after, f"{component}_w")
        for pos, a in after_w.items():
            if a == 0:
                continue
            if abs(a) > 5.0 or abs(a) < 0.05:
                extreme.append(f"{component}_w[{pos}]={a:.3f}")
    out.append((
        "All weights in plausible range (0.05 ≤ |w| ≤ 5)",
        not extreme,
        ", ".join(extreme),
    ))

    return out
