"""Markdown renderer for the v1-vs-v2 backtest.

The report's first section is the **pass/fail verdict** so the human
reviewer can see at a glance whether v2 is ready to ship. The metric
tables that follow let the reviewer drill in on *why*.
"""
from __future__ import annotations

from typing import Iterable

from backtest import (
    BacktestRow,
    PassCriteria,
    captain_pick_actual_total,
    mae_by_position,
    mae_overall,
    spearman_by_position,
    spearman_overall,
    top_k_hit_rate,
)
from xp_v2 import DEF, FWD, GKP, MID

_POSITION_NAMES = {GKP: "GK", DEF: "DEF", MID: "MID", FWD: "FWD"}


def render_backtest_report(
    *,
    rows: list[BacktestRow],
    pass_criteria: PassCriteria,
    backtest_date: str,
    coefficients_model_version: str,
) -> str:
    lines: list[str] = []
    lines.append(f"# xP v2 backtest report — {backtest_date}")
    lines.append("")
    lines.append(f"- **Coefficients evaluated**: `{coefficients_model_version}`")
    lines.append(f"- **Rows backtested**: {len(rows)}")
    lines.append(f"- **GW range**: {_round_range(rows)}")
    lines.append("")

    lines.append("## Verdict")
    lines.append("")
    if pass_criteria.ok:
        lines.append("**v2 PASSES all criteria.** Safe to proceed to Phase 5 (#116).")
    else:
        failed = ", ".join(pass_criteria.failures)
        lines.append(
            f"**v2 FAILS {len(pass_criteria.failures)} criterion(a):** {failed}. "
            "Iterate on Phase 1 (math), Phase 2 (features), or Phase 3 (fit) "
            "before promoting."
        )
    lines.append("")

    lines.append("### Criterion summary")
    lines.append("")
    lines.append("| # | criterion | result | detail |")
    lines.append("|---|---|---|---|")
    criteria_in_order = (
        ("mae_overall", "MAE overall (v2 strictly < v1)"),
        ("spearman_overall", "Spearman ρ overall (v2 ≥ v1)"),
        ("per_position_regression", "No position regresses >5% on MAE"),
        ("captain_pick_total", "Captain pick total (v2 ≥ v1)"),
    )
    for idx, (key, label) in enumerate(criteria_in_order, start=1):
        marker = "✓" if key not in pass_criteria.failures else "✗"
        detail = pass_criteria.detail.get(key, "")
        lines.append(f"| {idx} | {label} | {marker} | {detail} |")
    lines.append("")

    lines.append("## Per-model overall metrics")
    lines.append("")
    mae_v1 = mae_overall(rows, model="v1")
    mae_v2 = mae_overall(rows, model="v2")
    sp_v1 = spearman_overall(rows, model="v1")
    sp_v2 = spearman_overall(rows, model="v2")
    top_v1 = top_k_hit_rate(rows, model="v1")
    top_v2 = top_k_hit_rate(rows, model="v2")
    cap_v1 = captain_pick_actual_total(rows, model="v1")
    cap_v2 = captain_pick_actual_total(rows, model="v2")
    lines.append("| metric | v1 | v2 | delta |")
    lines.append("|---|---|---|---|")
    lines.append(f"| MAE | {mae_v1:.4f} | {mae_v2:.4f} | {mae_v2 - mae_v1:+.4f} |")
    lines.append(f"| Spearman ρ | {sp_v1:.4f} | {sp_v2:.4f} | {sp_v2 - sp_v1:+.4f} |")
    lines.append(f"| Top-10 hit rate (≥6 actual) | {top_v1:.3f} | {top_v2:.3f} | {top_v2 - top_v1:+.3f} |")
    lines.append(f"| Captain pick total | {cap_v1:.2f} | {cap_v2:.2f} | {cap_v2 - cap_v1:+.2f} |")
    lines.append("")

    lines.append("## Per-position MAE")
    lines.append("")
    mae_v1_by_pos = mae_by_position(rows, model="v1")
    mae_v2_by_pos = mae_by_position(rows, model="v2")
    lines.append("| position | v1 MAE | v2 MAE | delta | regression? |")
    lines.append("|---|---|---|---|---|")
    for pos in (GKP, DEF, MID, FWD):
        m1 = mae_v1_by_pos.get(pos)
        m2 = mae_v2_by_pos.get(pos)
        if m1 is None or m2 is None:
            lines.append(f"| {_POSITION_NAMES[pos]} | — | — | — | — |")
            continue
        delta = m2 - m1
        regression = ""
        if m1 > 0:
            pct = (m2 - m1) / m1
            if pct > 0.05:
                regression = f"⚠ +{pct:.1%}"
            elif pct < -0.05:
                regression = f"↓ {pct:.1%}"
        lines.append(
            f"| {_POSITION_NAMES[pos]} | {m1:.4f} | {m2:.4f} | {delta:+.4f} | {regression} |"
        )
    lines.append("")

    lines.append("## Per-position Spearman ρ")
    lines.append("")
    sp_v1_by_pos = spearman_by_position(rows, model="v1")
    sp_v2_by_pos = spearman_by_position(rows, model="v2")
    lines.append("| position | v1 ρ | v2 ρ | delta |")
    lines.append("|---|---|---|---|")
    for pos in (GKP, DEF, MID, FWD):
        s1 = sp_v1_by_pos.get(pos)
        s2 = sp_v2_by_pos.get(pos)
        if s1 is None or s2 is None:
            lines.append(f"| {_POSITION_NAMES[pos]} | — | — | — |")
            continue
        lines.append(
            f"| {_POSITION_NAMES[pos]} | {s1:.4f} | {s2:.4f} | {s2 - s1:+.4f} |"
        )
    lines.append("")

    lines.append("## Approximations to keep in mind")
    lines.append("")
    lines.append(
        "- v1's `minutes_prob` uses the **observed-minutes oracle** "
        "(1.0 if the player played, 0.0 otherwise) — we don't have "
        "historical snapshots of FPL's `chance_of_playing_next_round`. "
        "v2 uses the same oracle in this backtest, so the comparison "
        "is apples-to-apples."
    )
    lines.append(
        "- Fixture difficulty pulled from the **current** `fpl#fixtures` "
        "cache. FPL adjusts these rarely, but values may have shifted "
        "between the original GW and the time of this backtest run. "
        "Phase 3.x can fix this by archiving fixture snapshots, but "
        "the bias is small and applies symmetrically to v1 and v2 "
        "within this report."
    )
    lines.append("")
    return "\n".join(lines)


def _round_range(rows: Iterable[BacktestRow]) -> str:
    rows_list = list(rows)
    if not rows_list:
        return "(none)"
    rounds = sorted({r.round for r in rows_list})
    return f"{rounds[0]}–{rounds[-1]}"
