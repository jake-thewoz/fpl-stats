"""Snapshot tests for the markdown fit-report renderer."""
from __future__ import annotations

from dataclasses import replace

from fit import KEPT_TOO_FEW_EVENTS, FitPair, KeptWeight
from fit_gate import SanityCheck, ShipGate, ValidationMetrics
from report import render_fit_report
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients, XpV2Components

FIT_DATE = "2026-04-28"
CURRENT_SEASON = "2026-27"
ARCHIVE_SEASON = "2025-26"


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


def _pair(*, round_: int = 5, season: str = CURRENT_SEASON) -> FitPair:
    blank = XpV2Components(
        minutes_prob=1.0, p60=1.0,
        appearance_xp=2.0, goals_xp=0.0, assists_xp=0.0, cs_xp=0.0,
        concede_xp=0.0, saves_xp=0.0, bonus_xp=0.0, defcon_xp=0.0,
        discipline_xp=0.0, total=2.0,
    )
    return FitPair(
        season=season, player_id=1, round=round_, position=MID,
        predicted=replace(blank, total=5.0),
        actual=replace(blank, total=5.0),
    )


EMPTY_METRICS = ValidationMetrics(None, None, {}, {})


def _render(**overrides) -> str:
    arguments = dict(
        train=[],
        validation=[],
        rows_loaded_by_season={},
        coefs_before=_coefs(),
        coefs_after=_coefs(),
        kept=[],
        metrics_before=EMPTY_METRICS,
        metrics_after=EMPTY_METRICS,
        checks=[SanityCheck("No weight flipped sign", True, "")],
        gate=ShipGate([]),
        fit_date=FIT_DATE,
    )
    arguments.update(overrides)
    return render_fit_report(**arguments)


def test_render_includes_header_data_diff_and_metrics() -> None:
    report = _render(
        train=[_pair(round_=5, season=ARCHIVE_SEASON), _pair(round_=6)],
        validation=[_pair(round_=10)],
        rows_loaded_by_season={ARCHIVE_SEASON: 100, CURRENT_SEASON: 40},
        coefs_before=_coefs(goals_mid=1.0),
        coefs_after=_coefs(goals_mid=1.5),
        metrics_before=ValidationMetrics(0.8, 0.4, {MID: 0.8}, {MID: 0.4}),
        metrics_after=ValidationMetrics(0.5, 0.7, {MID: 0.5}, {MID: 0.7}),
    )

    assert f"# xP v2 fit report — {FIT_DATE}" in report
    assert "**Ship gate: PASS**" in report
    assert f"| {ARCHIVE_SEASON} | 100 | 1 | 0 |" in report
    assert f"| {CURRENT_SEASON} | 40 | 1 | 1 |" in report
    assert "| **total** | 140 | 2 | 1 |" in report
    assert "| `goals_w` | MID | 1.0000 | 1.5000 | 1.500 |" in report
    assert "| MID | 0.800 | 0.500 | 0.400 | 0.700 |" in report
    assert "| **overall** | 0.800 | 0.500 | 0.400 | 0.700 |" in report
    assert "✓ No weight flipped sign" in report


def test_render_handles_empty_diff() -> None:
    assert "No weights changed" in _render()


def test_render_lists_failed_gate_rules() -> None:
    report = _render(gate=ShipGate(["Overall MAE did not improve (1.000 → 1.100)."]))

    assert "**Ship gate: FAIL**" in report
    assert "- Overall MAE did not improve (1.000 → 1.100)." in report


def test_render_lists_kept_weights_with_reason() -> None:
    report = _render(kept=[KeptWeight("assists", GKP, KEPT_TOO_FEW_EVENTS, 12)])

    assert f"| `assists_w` | GK | 12 | {KEPT_TOO_FEW_EVENTS} |" in report


def test_render_flags_failed_sanity_check() -> None:
    report = _render(checks=[SanityCheck("No weight flipped sign", False, "goals_w[3]: 1→-1")])

    assert "✗ No weight flipped sign — goals_w[3]: 1→-1" in report
