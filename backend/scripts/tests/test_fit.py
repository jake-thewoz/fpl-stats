"""Unit tests for fit.py — pure functions, synthetic data, no DDB."""
from __future__ import annotations

import pytest

from fit import (
    FIT_COMPONENTS,
    KEPT_NO_EVENTS,
    KEPT_NO_PREDICTION,
    KEPT_TOO_FEW_EVENTS,
    MIN_NONZERO_ACTUAL_ROWS,
    FitPair,
    capped_holdout_rounds,
    coefficient_diffs,
    component_uses_season,
    decompose_actual_xp,
    drop_early_rounds,
    fit_per_component_weights,
    mae_overall,
    mae_per_position,
    multi_season_split,
    spearman_overall,
    spearman_per_position,
    time_series_split,
)
from schemas import PlayerHistoryRow
from xp_v2 import (
    DEF,
    DEFAULT_RULES,
    FWD,
    GKP,
    MID,
    V2Coefficients,
    XpV2Components,
)


def _coefs(**overrides) -> V2Coefficients:
    """V2Coefficients with all-1.0 defaults; override individual fields per test."""
    base = dict(
        goals_w={GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0},
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
    base.update(overrides)
    return V2Coefficients(**base)


def _row(*, minutes=90, goals=0, assists=0, cs=0, conceded=1, saves=0,
         bonus=0, yc=0, rc=0, defcon=0, round_=1) -> PlayerHistoryRow:
    return PlayerHistoryRow(
        element=1, fixture=round_, opponent_team=2, was_home=True,
        round=round_, minutes=minutes,
        goals_scored=goals, assists=assists, clean_sheets=cs,
        goals_conceded=conceded, saves=saves, bonus=bonus, bps=20,
        yellow_cards=yc, red_cards=rc, own_goals=0,
        penalties_saved=0, penalties_missed=0, total_points=0,
        defensive_contribution=defcon,
    )


def _components(**overrides) -> XpV2Components:
    base = dict(
        minutes_prob=1.0, p60=1.0,
        appearance_xp=2.0, goals_xp=0.0, assists_xp=0.0, cs_xp=0.0,
        concede_xp=0.0, saves_xp=0.0, bonus_xp=0.0, defcon_xp=0.0,
        discipline_xp=0.0, total=2.0,
    )
    base.update(overrides)
    return XpV2Components(**base)


CURRENT_SEASON = "2026-27"
LAST_SEASON = "2025-26"
OLD_SEASON = "2023-24"


def _pair(*, position=MID, predicted=None, actual=None, round_=1, season=CURRENT_SEASON) -> FitPair:
    return FitPair(
        season=season, player_id=1, round=round_, position=position,
        predicted=predicted or _components(),
        actual=actual or _components(),
    )


# ---------------------------------------------------------------------------
# decompose_actual_xp
# ---------------------------------------------------------------------------


def test_decompose_full_match_no_events_appearance_only() -> None:
    """A 90' appearance with nothing else scored: 2 pts appearance only."""
    row = _row(minutes=90)
    actual = decompose_actual_xp(position=MID, row=row)
    assert actual.appearance_xp == 2.0
    assert actual.goals_xp == 0.0
    assert actual.total == 2.0


def test_decompose_substitute_appearance_one_point() -> None:
    """1-59 minute sub: 1 pt appearance, no ≥60 bonus."""
    row = _row(minutes=20)
    actual = decompose_actual_xp(position=MID, row=row)
    assert actual.appearance_xp == 1.0


def test_decompose_goals_use_position_pts() -> None:
    """Goal pts: GK/DEF=6, MID=5, FWD=4."""
    row = _row(minutes=90, goals=1)
    assert decompose_actual_xp(position=DEF, row=row).goals_xp == 6.0
    assert decompose_actual_xp(position=MID, row=row).goals_xp == 5.0
    assert decompose_actual_xp(position=FWD, row=row).goals_xp == 4.0


def test_decompose_clean_sheet_only_when_60_plus() -> None:
    """A defender who plays 45' and the team gets a CS earns the
    appearance pt but not the CS pt."""
    short = decompose_actual_xp(
        position=DEF, row=_row(minutes=45, cs=1, conceded=0),
    )
    long = decompose_actual_xp(
        position=DEF, row=_row(minutes=90, cs=1, conceded=0),
    )
    assert short.cs_xp == 0.0
    assert long.cs_xp == 4.0


def test_decompose_concede_pairs_for_def() -> None:
    """DEF concedes 3 → -1 (one pair). DEF concedes 4 → -2 (two pairs)."""
    three = decompose_actual_xp(
        position=DEF, row=_row(minutes=90, conceded=3),
    )
    four = decompose_actual_xp(
        position=DEF, row=_row(minutes=90, conceded=4),
    )
    assert three.concede_xp == -1.0
    assert four.concede_xp == -2.0


def test_decompose_saves_only_for_gk() -> None:
    row = _row(minutes=90, saves=6)
    assert decompose_actual_xp(position=GKP, row=row).saves_xp == 2.0  # 6 // 3
    assert decompose_actual_xp(position=DEF, row=row).saves_xp == 0.0


def test_decompose_defcon_def_threshold_ten() -> None:
    """DEF defcon triggers at CBI+T ≥ 10."""
    nine = decompose_actual_xp(
        position=DEF, row=_row(minutes=90, defcon=9),
    )
    ten = decompose_actual_xp(
        position=DEF, row=_row(minutes=90, defcon=10),
    )
    assert nine.defcon_xp == 0.0
    assert ten.defcon_xp == 2.0


def test_decompose_defcon_outfield_threshold_twelve() -> None:
    """MID/FWD trigger at 12 (CBI+T+R)."""
    eleven = decompose_actual_xp(
        position=MID, row=_row(minutes=90, defcon=11),
    )
    twelve = decompose_actual_xp(
        position=MID, row=_row(minutes=90, defcon=12),
    )
    assert eleven.defcon_xp == 0.0
    assert twelve.defcon_xp == 2.0


def test_decompose_defcon_zero_for_gk() -> None:
    """GK is ineligible for defcon regardless of value."""
    row = _row(minutes=90, defcon=20)
    assert decompose_actual_xp(position=GKP, row=row).defcon_xp == 0.0


def test_decompose_discipline_uses_card_pts() -> None:
    row = _row(minutes=90, yc=1, rc=0)
    actual = decompose_actual_xp(position=MID, row=row)
    assert actual.discipline_xp == -1.0


# ---------------------------------------------------------------------------
# fit_per_component_weights — mean-matching
# ---------------------------------------------------------------------------


def test_fit_doubles_weight_when_actual_is_double_predicted() -> None:
    """sum_actual_goals_xp = 2 × sum_predicted_goals_xp → goals_w doubles."""
    coefs = _coefs()  # all 1.0
    pairs = [
        _pair(predicted=_components(goals_xp=1.0), actual=_components(goals_xp=2.0)),
        _pair(predicted=_components(goals_xp=1.5), actual=_components(goals_xp=3.0)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.goals_w[MID] == pytest.approx(2.0)
    # Untouched components keep their prior weight.
    assert fitted.assists_w[MID] == pytest.approx(1.0)


def test_fit_no_change_when_actual_matches_predicted() -> None:
    coefs = _coefs()
    pairs = [
        _pair(predicted=_components(goals_xp=1.5, assists_xp=0.8),
              actual=_components(goals_xp=1.5, assists_xp=0.8)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.goals_w[MID] == pytest.approx(1.0)
    assert fitted.assists_w[MID] == pytest.approx(1.0)


def test_fit_zero_predicted_keeps_prior() -> None:
    """Component disabled (saves for outfield, predicted always 0):
    leave the weight alone — no signal to fit from."""
    coefs = _coefs(saves_w={GKP: 1.0, DEF: 0.5, MID: 0.0, FWD: 0.0})
    pairs = [
        _pair(position=DEF, predicted=_components(saves_xp=0.0),
              actual=_components(saves_xp=0.0)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.saves_w[DEF] == 0.5  # unchanged


def test_fit_zero_actual_keeps_prior() -> None:
    """No events in the sample: keep the weight rather than zeroing it.
    A zeroed weight predicts 0 forever, so later fits could never
    move it again."""
    coefs = _coefs()
    pairs = [
        _pair(position=FWD, predicted=_components(defcon_xp=0.3),
              actual=_components(defcon_xp=0.0)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.defcon_w[FWD] == pytest.approx(1.0)


def test_fit_per_position_independent() -> None:
    """A goals shift in MID doesn't affect the FWD weight."""
    coefs = _coefs()
    pairs = [
        _pair(position=MID, predicted=_components(goals_xp=1.0), actual=_components(goals_xp=2.0)),
        _pair(position=FWD, predicted=_components(goals_xp=1.0), actual=_components(goals_xp=1.0)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.goals_w[MID] == pytest.approx(2.0)
    assert fitted.goals_w[FWD] == pytest.approx(1.0)


def test_fit_concede_negative_ratio_well_defined() -> None:
    """Concede points are negative on both sides; the ratio still works
    out cleanly because both sums have the same sign."""
    coefs = _coefs()
    pairs = [
        _pair(position=DEF, predicted=_components(concede_xp=-0.5),
              actual=_components(concede_xp=-1.0)),
    ] * MIN_NONZERO_ACTUAL_ROWS
    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs
    assert fitted.concede_w[DEF] == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# Per-component season filter
# ---------------------------------------------------------------------------


def test_component_uses_season_respects_first_valid_season() -> None:
    assert component_uses_season("goals", OLD_SEASON)
    assert not component_uses_season("defcon", OLD_SEASON)
    assert component_uses_season("defcon", LAST_SEASON)
    assert not component_uses_season("bonus", LAST_SEASON)
    assert component_uses_season("bonus", CURRENT_SEASON)


def test_fit_ignores_defcon_from_seasons_before_the_rule() -> None:
    """Pre-2025-26 rows carry no defcon actuals; counting them would drag
    the weight towards zero."""
    coefs = _coefs()
    old = [_pair(season=OLD_SEASON, predicted=_components(defcon_xp=1.0),
                 actual=_components(defcon_xp=0.0))] * MIN_NONZERO_ACTUAL_ROWS
    recent = [_pair(season=LAST_SEASON, predicted=_components(defcon_xp=1.0),
                    actual=_components(defcon_xp=2.0))] * MIN_NONZERO_ACTUAL_ROWS

    fitted = fit_per_component_weights(pairs=old + recent, coefs=coefs).coefs

    assert fitted.defcon_w[MID] == pytest.approx(2.0)


def test_fit_uses_old_seasons_for_unlisted_components() -> None:
    coefs = _coefs()
    pairs = [_pair(season=OLD_SEASON, predicted=_components(goals_xp=1.0),
                   actual=_components(goals_xp=3.0))] * MIN_NONZERO_ACTUAL_ROWS

    fitted = fit_per_component_weights(pairs=pairs, coefs=coefs).coefs

    assert fitted.goals_w[MID] == pytest.approx(3.0)


def test_fit_bonus_only_from_current_season() -> None:
    coefs = _coefs()
    pairs = [_pair(season=LAST_SEASON, predicted=_components(bonus_xp=1.0),
                   actual=_components(bonus_xp=3.0))] * MIN_NONZERO_ACTUAL_ROWS

    result = fit_per_component_weights(pairs=pairs, coefs=coefs)

    assert result.coefs.bonus_w[MID] == pytest.approx(1.0)
    kept_bonus_mid = [k for k in result.kept if (k.component, k.position) == ("bonus", MID)]
    assert kept_bonus_mid[0].reason == KEPT_NO_PREDICTION


# ---------------------------------------------------------------------------
# Rare-event guard
# ---------------------------------------------------------------------------


def test_rare_event_guard_keeps_weight_below_threshold() -> None:
    """One goalkeeper assist in a GW10 fit pushed assists_w[GK] to 10.4."""
    coefs = _coefs()
    events = [_pair(position=GKP, predicted=_components(assists_xp=0.1),
                    actual=_components(assists_xp=3.0))] * (MIN_NONZERO_ACTUAL_ROWS - 1)
    quiet = [_pair(position=GKP, predicted=_components(assists_xp=0.1))] * 100

    result = fit_per_component_weights(pairs=events + quiet, coefs=coefs)

    assert result.coefs.assists_w[GKP] == pytest.approx(1.0)
    kept = [k for k in result.kept if (k.component, k.position) == ("assists", GKP)]
    assert kept[0].reason == KEPT_TOO_FEW_EVENTS
    assert kept[0].nonzero_actual_rows == MIN_NONZERO_ACTUAL_ROWS - 1


def test_rare_event_guard_fits_at_threshold() -> None:
    coefs = _coefs()
    pairs = [_pair(position=GKP, predicted=_components(assists_xp=1.0),
                   actual=_components(assists_xp=2.0))] * MIN_NONZERO_ACTUAL_ROWS

    result = fit_per_component_weights(pairs=pairs, coefs=coefs)

    assert result.coefs.assists_w[GKP] == pytest.approx(2.0)
    assert ("assists", GKP) not in {(k.component, k.position) for k in result.kept}


def test_kept_reports_no_events_and_skips_ineligible_positions() -> None:
    coefs = _coefs()
    pairs = [_pair(position=FWD, predicted=_components(defcon_xp=0.3))]

    kept = fit_per_component_weights(pairs=pairs, coefs=coefs).kept

    reasons = {(k.component, k.position): k.reason for k in kept}
    assert reasons[("defcon", FWD)] == KEPT_NO_EVENTS
    # cs_w[FWD] is 0 (ineligible), so it isn't reported.
    assert ("cs", FWD) not in reasons


# ---------------------------------------------------------------------------
# Min-round filter and the multi-season split
# ---------------------------------------------------------------------------


def test_drop_early_rounds_keeps_min_round_and_later() -> None:
    pairs = [_pair(round_=r) for r in (1, 4, 5, 6)]

    assert [p.round for p in drop_early_rounds(pairs, 5)] == [5, 6]


def test_multi_season_split_validates_on_current_season_tail_only() -> None:
    archive = [_pair(season=LAST_SEASON, round_=r) for r in (2, 5, 38)]
    current = [_pair(round_=r) for r in (2, 5, 6, 7, 8, 9, 10)]

    train, validation = multi_season_split(
        archive_pairs=archive, current_pairs=current,
        holdout_rounds=3, min_train_round=5,
    )

    assert sorted((p.season, p.round) for p in train) == [
        (LAST_SEASON, 5), (LAST_SEASON, 38),
        (CURRENT_SEASON, 5), (CURRENT_SEASON, 6), (CURRENT_SEASON, 7),
    ]
    assert [(p.season, p.round) for p in validation] == [
        (CURRENT_SEASON, 8), (CURRENT_SEASON, 9), (CURRENT_SEASON, 10),
    ]


def test_multi_season_split_does_not_filter_validation_rounds() -> None:
    current = [_pair(round_=r) for r in (1, 2, 3)]

    train, validation = multi_season_split(
        archive_pairs=[], current_pairs=current,
        holdout_rounds=2, min_train_round=5,
    )

    assert train == []
    assert [p.round for p in validation] == [2, 3]


# ---------------------------------------------------------------------------
# Time-series split
# ---------------------------------------------------------------------------


def test_time_series_split_holds_out_last_n_rounds() -> None:
    pairs = [_pair(round_=r) for r in range(1, 11)]
    train, val = time_series_split(pairs, holdout_last_n_rounds=3)
    assert {p.round for p in train} == {1, 2, 3, 4, 5, 6, 7}
    assert {p.round for p in val} == {8, 9, 10}


def test_time_series_split_empty_input() -> None:
    train, val = time_series_split([], holdout_last_n_rounds=5)
    assert train == [] and val == []


def test_time_series_split_holdout_larger_than_data() -> None:
    """If holdout is bigger than the data spans, training becomes empty —
    the caller is responsible for handling that, but the split itself
    shouldn't crash."""
    pairs = [_pair(round_=r) for r in (5, 6, 7)]
    train, val = time_series_split(pairs, holdout_last_n_rounds=10)
    assert train == []
    assert {p.round for p in val} == {5, 6, 7}


def test_capped_holdout_keeps_requested_when_data_is_long_enough() -> None:
    pairs = [_pair(round_=r) for r in range(1, 11)]
    assert capped_holdout_rounds(pairs, 5) == 5


def test_capped_holdout_leaves_one_training_round_early_season() -> None:
    """GW1–5 with the default holdout of 5 would leave nothing to train
    on; cap at 4 so GW1 trains and GW2–5 validate."""
    pairs = [_pair(round_=r) for r in range(1, 6)]
    holdout = capped_holdout_rounds(pairs, 5)
    assert holdout == 4
    train, _ = time_series_split(pairs, holdout_last_n_rounds=holdout)
    assert {p.round for p in train} == {1}


def test_capped_holdout_single_round_is_zero() -> None:
    assert capped_holdout_rounds([_pair(round_=3)], 5) == 0


def test_capped_holdout_empty_input_is_zero() -> None:
    assert capped_holdout_rounds([], 5) == 0


# ---------------------------------------------------------------------------
# Ranking + level metrics
# ---------------------------------------------------------------------------


def test_mae_per_position_grouped_correctly() -> None:
    pairs = [
        _pair(position=MID, predicted=_components(total=5.0), actual=_components(total=5.5)),
        _pair(position=MID, predicted=_components(total=3.0), actual=_components(total=2.0)),
        _pair(position=FWD, predicted=_components(total=4.0), actual=_components(total=4.0)),
    ]
    out = mae_per_position(pairs)
    # MID errors: 0.5, 1.0 → mean 0.75
    assert out[MID] == pytest.approx(0.75)
    assert out[FWD] == pytest.approx(0.0)


def test_spearman_perfect_rank_correlation() -> None:
    """If predictions and actuals rank players in the same order, ρ=1."""
    pairs = [
        _pair(position=MID, predicted=_components(total=t), actual=_components(total=t * 2 + 1))
        for t in (1.0, 2.0, 3.0, 4.0)
    ]
    out = spearman_per_position(pairs)
    assert out[MID] == pytest.approx(1.0)


def test_spearman_inverse_rank_correlation() -> None:
    """Predictions in reverse order of actuals → ρ = -1."""
    pairs = [
        _pair(position=MID, predicted=_components(total=p), actual=_components(total=a))
        for p, a in [(1.0, 4.0), (2.0, 3.0), (3.0, 2.0), (4.0, 1.0)]
    ]
    out = spearman_per_position(pairs)
    assert out[MID] == pytest.approx(-1.0)


def test_spearman_skips_singleton_positions() -> None:
    """Need at least 2 points to define a ranking."""
    pairs = [_pair(position=MID, predicted=_components(total=1.0), actual=_components(total=2.0))]
    out = spearman_per_position(pairs)
    assert MID not in out


def test_overall_metrics_pool_every_position() -> None:
    pairs = [
        _pair(position=MID, predicted=_components(total=1.0), actual=_components(total=2.0)),
        _pair(position=FWD, predicted=_components(total=3.0), actual=_components(total=6.0)),
    ]

    assert mae_overall(pairs) == pytest.approx(2.0)
    assert spearman_overall(pairs) == pytest.approx(1.0)


def test_overall_metrics_empty_are_none() -> None:
    assert mae_overall([]) is None
    assert spearman_overall([]) is None


# ---------------------------------------------------------------------------
# Coefficient diffs
# ---------------------------------------------------------------------------


def test_coefficient_diffs_lists_only_changed_weights() -> None:
    before = _coefs()
    after = _coefs(goals_w={GKP: 1.0, DEF: 1.0, MID: 1.5, FWD: 0.8})
    diffs = coefficient_diffs(before=before, after=after)
    names = {(name, pos): (b, a) for name, pos, b, a in diffs}
    assert ("goals_w", MID) in names
    assert ("goals_w", FWD) in names
    assert ("goals_w", DEF) not in names  # unchanged
    assert names[("goals_w", MID)] == (1.0, 1.5)


def test_fit_components_constant_includes_all_seven() -> None:
    """Defensive: fit, decompose, and report all assume the same set of
    components. If FIT_COMPONENTS is bumped, everything else needs to
    match."""
    assert set(FIT_COMPONENTS) == {
        "goals", "assists", "cs", "concede", "saves", "defcon", "bonus",
    }
