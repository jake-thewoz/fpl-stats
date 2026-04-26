from __future__ import annotations

import pytest

from compute import (
    CaptainEvCandidate,
    CaptainEvComponents,
    expected_points,
    fixture_easiness,
    fixtures_in_gw_for_team,
    gw_easiness,
    minutes_probability,
    rank_top_n,
    upcoming_gameweek,
)
from schemas import Fixture, Gameweek, Player


def _gw(id_: int, *, finished: bool = False, is_next: bool = False) -> Gameweek:
    return Gameweek(
        id=id_,
        name=f"Gameweek {id_}",
        deadline_time=f"2026-01-{id_:02d}T00:00:00Z",
        is_current=False,
        is_next=is_next,
        finished=finished,
    )


def _fx(
    id_: int,
    event: int | None,
    team_h: int,
    team_a: int,
    *,
    finished: bool = False,
    team_h_difficulty: int | None = None,
    team_a_difficulty: int | None = None,
) -> Fixture:
    return Fixture(
        id=id_,
        event=event,
        kickoff_time="2026-01-01T15:00:00Z",
        team_h=team_h,
        team_a=team_a,
        finished=finished,
        started=False,
        team_h_difficulty=team_h_difficulty,
        team_a_difficulty=team_a_difficulty,
    )


def _player(id_: int, *, status: str | None = "a", cop: int | None = None) -> Player:
    return Player(
        id=id_,
        first_name="Test",
        second_name=f"Player{id_}",
        web_name=f"P{id_}",
        team=1,
        element_type=3,
        total_points=100,
        form="5.0",
        now_cost=80,
        status=status,
        chance_of_playing_next_round=cop,
    )


# ---------------------------------------------------------------------------
# upcoming_gameweek
# ---------------------------------------------------------------------------


class TestUpcomingGameweek:
    def test_prefers_is_next_flag(self):
        gws = [_gw(30, finished=True), _gw(31, is_next=True), _gw(32)]
        assert upcoming_gameweek(gws) == 31

    def test_falls_back_to_smallest_unfinished(self):
        # No is_next set — pre-season or mid-season FPL inconsistency.
        gws = [_gw(30, finished=True), _gw(31), _gw(32)]
        assert upcoming_gameweek(gws) == 31

    def test_returns_none_when_all_finished(self):
        gws = [_gw(37, finished=True), _gw(38, finished=True)]
        assert upcoming_gameweek(gws) is None

    def test_empty_returns_none(self):
        assert upcoming_gameweek([]) is None


# ---------------------------------------------------------------------------
# fixtures_in_gw_for_team
# ---------------------------------------------------------------------------


def test_fixtures_in_gw_matches_home_and_away():
    fixtures = [
        _fx(1, event=33, team_h=3, team_a=7),  # home for team 3
        _fx(2, event=33, team_h=5, team_a=3),  # away for team 3
        _fx(3, event=33, team_h=1, team_a=2),  # neither
    ]
    result = fixtures_in_gw_for_team(fixtures, team_id=3, gw=33)
    assert [fx.id for fx in result] == [1, 2]


def test_fixtures_in_gw_skips_wrong_gameweek():
    fixtures = [
        _fx(1, event=32, team_h=3, team_a=7),
        _fx(2, event=33, team_h=3, team_a=7),
        _fx(3, event=34, team_h=3, team_a=7),
    ]
    result = fixtures_in_gw_for_team(fixtures, team_id=3, gw=33)
    assert [fx.id for fx in result] == [2]


def test_fixtures_in_gw_skips_finished():
    """Re-running the analyzer mid-GW (after the match-window guard
    clears) must not double-count an already-played fixture."""
    fixtures = [
        _fx(1, event=33, team_h=3, team_a=7, finished=True),
        _fx(2, event=33, team_h=3, team_a=9),
    ]
    result = fixtures_in_gw_for_team(fixtures, team_id=3, gw=33)
    assert [fx.id for fx in result] == [2]


def test_fixtures_in_gw_returns_two_for_double_gameweek():
    fixtures = [
        _fx(1, event=33, team_h=3, team_a=7),
        _fx(2, event=33, team_h=9, team_a=3),
    ]
    result = fixtures_in_gw_for_team(fixtures, team_id=3, gw=33)
    assert len(result) == 2


def test_fixtures_in_gw_blank_returns_empty():
    fixtures = [_fx(1, event=33, team_h=1, team_a=2)]
    assert fixtures_in_gw_for_team(fixtures, team_id=3, gw=33) == []


# ---------------------------------------------------------------------------
# fixture_easiness
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "difficulty, expected",
    [
        (1, 1.0),
        (2, 0.8),
        (3, 0.6),
        (4, 0.4),
        (5, 0.2),
        (None, 0.6),
    ],
)
def test_fixture_easiness(difficulty, expected):
    assert fixture_easiness(difficulty) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# gw_easiness
# ---------------------------------------------------------------------------


def test_gw_easiness_single_fixture_home():
    fixtures = [_fx(1, 33, team_h=3, team_a=7, team_h_difficulty=2)]
    # home, difficulty=2 -> easiness 0.8
    assert gw_easiness(fixtures, team_id=3) == pytest.approx(0.8)


def test_gw_easiness_single_fixture_away():
    fixtures = [_fx(1, 33, team_h=7, team_a=3, team_a_difficulty=4)]
    # away, difficulty=4 -> easiness 0.4
    assert gw_easiness(fixtures, team_id=3) == pytest.approx(0.4)


def test_gw_easiness_dgw_averages_per_fixture():
    fixtures = [
        _fx(1, 33, team_h=3, team_a=7, team_h_difficulty=2),  # home, easy: 0.8
        _fx(2, 33, team_h=9, team_a=3, team_a_difficulty=5),  # away, hard: 0.2
    ]
    assert gw_easiness(fixtures, team_id=3) == pytest.approx(0.5)


def test_gw_easiness_empty_returns_zero():
    """Blank GW signal — caller skips writing an item, but compute layer
    should still return a defined float."""
    assert gw_easiness([], team_id=3) == 0.0


def test_gw_easiness_missing_difficulty_uses_mid_fallback():
    fixtures = [_fx(1, 33, team_h=3, team_a=7)]
    assert gw_easiness(fixtures, team_id=3) == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# minutes_probability
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label, status, cop, expected",
    [
        ("explicit 100% chance", "a", 100, 1.0),
        ("explicit 50% chance", "d", 50, 0.5),
        ("explicit 0% chance overrides 'a' status", "a", 0, 0.0),
        ("null cop, available -> 1.0", "a", None, 1.0),
        ("null cop, doubtful -> 0.0", "d", None, 0.0),
        ("null cop, injured -> 0.0", "i", None, 0.0),
        ("null cop, suspended -> 0.0", "s", None, 0.0),
        ("null cop, no status info -> 0.0", None, None, 0.0),
    ],
)
def test_minutes_probability(label, status, cop, expected):
    p = _player(1, status=status, cop=cop)
    assert minutes_probability(p) == pytest.approx(expected), label


# ---------------------------------------------------------------------------
# expected_points
# ---------------------------------------------------------------------------


def test_expected_points_basic_multiplication():
    # form=6.0, easiness=0.8, mins_prob=1.0, num_fixtures=1 -> 4.8
    assert expected_points(6.0, 0.8, 1.0, 1) == pytest.approx(4.8)


def test_expected_points_dgw_doubles_via_num_fixtures():
    assert expected_points(6.0, 0.8, 1.0, 2) == pytest.approx(9.6)


def test_expected_points_zero_minutes_prob_zeros_out():
    assert expected_points(10.0, 1.0, 0.0, 1) == 0.0


# ---------------------------------------------------------------------------
# rank_top_n
# ---------------------------------------------------------------------------


def _candidate(player_id: int, ev: float) -> CaptainEvCandidate:
    return CaptainEvCandidate(
        player_id=player_id,
        web_name=f"P{player_id}",
        team_id=1,
        position_id=3,
        expected_points=ev / 2,
        captain_ev=ev,
        components=CaptainEvComponents(
            form_score=ev / 2,
            fixture_easiness=1.0,
            minutes_prob=1.0,
            num_fixtures=1,
        ),
    )


def test_rank_top_n_sorts_desc_by_ev():
    cands = [_candidate(1, 5.0), _candidate(2, 12.0), _candidate(3, 8.0)]
    ranked = rank_top_n(cands, n=3)
    assert [c.player_id for c in ranked] == [2, 3, 1]


def test_rank_top_n_truncates():
    cands = [_candidate(i, float(100 - i)) for i in range(10)]
    ranked = rank_top_n(cands, n=3)
    assert [c.player_id for c in ranked] == [0, 1, 2]


def test_rank_top_n_tiebreaks_by_player_id_ascending():
    """Two players with identical EV — break ties deterministically so
    the stored ranked list is stable across re-runs and snapshot diffs."""
    cands = [_candidate(7, 10.0), _candidate(3, 10.0), _candidate(5, 10.0)]
    ranked = rank_top_n(cands, n=3)
    assert [c.player_id for c in ranked] == [3, 5, 7]


def test_rank_top_n_empty_returns_empty():
    assert rank_top_n([], n=10) == []
