"""Unit tests for v1_replay — pure functions, synthetic data."""
from __future__ import annotations

import pytest

from schemas import Fixture, PlayerHistoryRow
from v1_replay import (
    DEFAULT_FIXTURE_EASINESS,
    FORM_WEIGHTS,
    fixture_easiness,
    find_fixture_difficulty,
    predict_v1_for_row,
    recent_points_before_round,
    weighted_form_score,
)


def _row(*, round_=1, fixture=None, minutes=90, total_points=2,
         opponent=2, was_home=True) -> PlayerHistoryRow:
    return PlayerHistoryRow(
        element=1, fixture=fixture if fixture is not None else round_,
        opponent_team=opponent, was_home=was_home, round=round_,
        minutes=minutes, goals_scored=0, assists=0, clean_sheets=0,
        goals_conceded=1, saves=0, bonus=0, bps=20, yellow_cards=0,
        red_cards=0, own_goals=0, penalties_saved=0, penalties_missed=0,
        total_points=total_points,
    )


def _fx(*, id_, event, team_h, team_a,
        team_h_difficulty=3, team_a_difficulty=3) -> Fixture:
    return Fixture(
        id=id_, event=event, kickoff_time="2026-01-01T15:00:00Z",
        team_h=team_h, team_a=team_a, finished=True, started=True,
        team_h_difficulty=team_h_difficulty, team_a_difficulty=team_a_difficulty,
    )


# ---------------------------------------------------------------------------
# weighted_form_score
# ---------------------------------------------------------------------------


def test_weighted_form_score_full_window() -> None:
    """5 GWs of points: weighted average uses all of FORM_WEIGHTS."""
    points = [10, 5, 8, 6, 12]
    # weights [5,4,3,2,1] sum 15. Expected:
    # (10*5 + 5*4 + 8*3 + 6*2 + 12*1) / 15 = (50+20+24+12+12)/15 = 118/15 = 7.866...
    assert weighted_form_score(points) == pytest.approx(118 / 15, rel=1e-6)


def test_weighted_form_score_partial_window_uses_suffix() -> None:
    """3 GWs: use the most-recent-heavy suffix [3, 2, 1] renormalized."""
    points = [10, 5, 8]
    # suffix [3,2,1] sum 6. (10*3 + 5*2 + 8*1)/6 = (30+10+8)/6 = 48/6 = 8.0
    assert weighted_form_score(points) == pytest.approx(8.0, rel=1e-6)


def test_weighted_form_score_empty_returns_zero() -> None:
    """Player with no prior GWs (round 1 of season) gets v1 form 0."""
    assert weighted_form_score([]) == 0.0


def test_weighted_form_score_more_points_than_weights_raises() -> None:
    """Caller is responsible for pre-slicing to RECENT_GW_COUNT."""
    with pytest.raises(ValueError):
        weighted_form_score([1, 2, 3, 4, 5, 6])


# ---------------------------------------------------------------------------
# fixture_easiness
# ---------------------------------------------------------------------------


def test_fixture_easiness_maps_difficulty_to_multiplier() -> None:
    """1 (easiest) → 1.0, 5 (hardest) → 0.2; (6-d)/5."""
    assert fixture_easiness(1) == 1.0
    assert fixture_easiness(2) == 0.8
    assert fixture_easiness(3) == 0.6
    assert fixture_easiness(4) == 0.4
    assert fixture_easiness(5) == 0.2


def test_fixture_easiness_none_falls_back_to_default() -> None:
    assert fixture_easiness(None) == DEFAULT_FIXTURE_EASINESS == 0.6


# ---------------------------------------------------------------------------
# recent_points_before_round
# ---------------------------------------------------------------------------


def test_recent_points_filters_to_prior_rounds() -> None:
    """Strict anti-leakage: only round < as_of_round."""
    history = [
        _row(round_=1, total_points=5),
        _row(round_=3, total_points=8),
        _row(round_=5, total_points=10),
        _row(round_=7, total_points=4),  # >= as_of_round=7 → excluded
    ]
    points = recent_points_before_round(history, as_of_round=7)
    assert points == [5, 8, 10]


def test_recent_points_takes_last_n_only() -> None:
    """With more than 5 prior GWs, only the most recent 5 are returned."""
    history = [_row(round_=r, total_points=r) for r in range(1, 8)]
    points = recent_points_before_round(history, as_of_round=10, n=5)
    # Rounds 3-7 → points [3,4,5,6,7]
    assert points == [3, 4, 5, 6, 7]


def test_recent_points_dgw_summed_per_round() -> None:
    """A DGW yields two rows in the same round; their points sum into
    one per-GW total so the form weights line up with FPL's per-GW
    points.

    Points: GW1 single, GW2 DGW (4 + 6 = 10), GW3 single
    """
    history = [
        _row(round_=1, fixture=1, total_points=5),
        _row(round_=2, fixture=10, total_points=4),  # DGW leg 1
        _row(round_=2, fixture=11, total_points=6),  # DGW leg 2
        _row(round_=3, fixture=20, total_points=8),
    ]
    points = recent_points_before_round(history, as_of_round=10, n=5)
    assert points == [5, 10, 8]


def test_recent_points_empty_history_returns_empty() -> None:
    assert recent_points_before_round([], as_of_round=5) == []


# ---------------------------------------------------------------------------
# find_fixture_difficulty
# ---------------------------------------------------------------------------


def test_find_fixture_difficulty_home() -> None:
    """Player team plays at home → difficulty is team_h_difficulty."""
    fixtures = [_fx(id_=1, event=10, team_h=1, team_a=2,
                     team_h_difficulty=3, team_a_difficulty=4)]
    diff = find_fixture_difficulty(
        fixtures, player_team=1, opponent_team=2, round_=10, was_home=True,
    )
    assert diff == 3


def test_find_fixture_difficulty_away() -> None:
    """Player team plays away → difficulty is team_a_difficulty."""
    fixtures = [_fx(id_=1, event=10, team_h=2, team_a=1,
                     team_h_difficulty=4, team_a_difficulty=3)]
    diff = find_fixture_difficulty(
        fixtures, player_team=1, opponent_team=2, round_=10, was_home=False,
    )
    assert diff == 3


def test_find_fixture_difficulty_no_match_returns_none() -> None:
    """No fixture for that (round, teams) combo → None, replay falls
    back to mid-easiness."""
    fixtures = [_fx(id_=1, event=10, team_h=1, team_a=2)]
    diff = find_fixture_difficulty(
        fixtures, player_team=3, opponent_team=4, round_=10, was_home=True,
    )
    assert diff is None


# ---------------------------------------------------------------------------
# predict_v1_for_row (end-to-end)
# ---------------------------------------------------------------------------


def test_predict_v1_zero_minutes_returns_zero() -> None:
    """Observed-minutes oracle: didn't play → 0 prediction, even if form
    was high. Avoids a divide-through that would still be 0 anyway."""
    target = _row(round_=5, minutes=0, total_points=0)
    history = [_row(round_=r, total_points=10) for r in (1, 2, 3, 4)]
    fixtures = [_fx(id_=99, event=5, team_h=1, team_a=2)]
    pred = predict_v1_for_row(
        target_row=target, player_history=history,
        player_team=1, fixtures=fixtures,
    )
    assert pred == 0.0


def test_predict_v1_known_scenario() -> None:
    """End-to-end with all inputs known so the math is verifiable.

    Form: rounds 1-4 with [5, 5, 5, 5] → suffix [4,3,2,1] / sum 10:
        (5*4 + 5*3 + 5*2 + 5*1)/10 = 50/10 = 5.0
    Easiness: difficulty 2 (home) → (6-2)/5 = 0.8
    minutes_prob: 1.0 (player played 90)
    num_fixtures: 1
    Expected v1 xP: 5.0 × 0.8 × 1.0 × 1 = 4.0
    """
    target = _row(round_=5, minutes=90, opponent=2, was_home=True)
    history = [_row(round_=r, total_points=5) for r in (1, 2, 3, 4)]
    fixtures = [_fx(
        id_=99, event=5, team_h=1, team_a=2,
        team_h_difficulty=2, team_a_difficulty=4,
    )]
    pred = predict_v1_for_row(
        target_row=target, player_history=history,
        player_team=1, fixtures=fixtures,
    )
    assert pred == pytest.approx(4.0, rel=1e-6)


def test_predict_v1_uses_anti_leakage_form() -> None:
    """Future rows (at or after target.round) must not leak into form."""
    target = _row(round_=5, minutes=90)
    # Same form-shaping past, plus a "future" row that should be ignored.
    history = [_row(round_=r, total_points=5) for r in (1, 2, 3, 4)] + [
        _row(round_=5, total_points=20),  # the target round itself
        _row(round_=6, total_points=15),
    ]
    fixtures = [_fx(id_=99, event=5, team_h=1, team_a=2,
                     team_h_difficulty=2, team_a_difficulty=4)]
    pred = predict_v1_for_row(
        target_row=target, player_history=history,
        player_team=1, fixtures=fixtures,
    )
    # Same as the previous test — leaked rows should produce no change.
    assert pred == pytest.approx(4.0, rel=1e-6)


def test_predict_v1_no_history_returns_zero() -> None:
    """First GW of season, no prior history → form_score=0 → v1=0."""
    target = _row(round_=1, minutes=90)
    fixtures = [_fx(id_=99, event=1, team_h=1, team_a=2)]
    pred = predict_v1_for_row(
        target_row=target, player_history=[],
        player_team=1, fixtures=fixtures,
    )
    assert pred == 0.0


def test_predict_v1_missing_fixture_uses_fallback_easiness() -> None:
    """Fixture not in cache → easiness defaults to 0.6, form still applies.
    Form 5.0 × 0.6 × 1.0 × 1 = 3.0.
    """
    target = _row(round_=5, minutes=90, opponent=99)  # no fixture matches
    history = [_row(round_=r, total_points=5) for r in (1, 2, 3, 4)]
    pred = predict_v1_for_row(
        target_row=target, player_history=history,
        player_team=1, fixtures=[],  # empty cache
    )
    assert pred == pytest.approx(3.0, rel=1e-6)
