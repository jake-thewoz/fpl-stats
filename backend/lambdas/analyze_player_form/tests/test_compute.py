from __future__ import annotations

import pytest

from compute import (
    UpcomingFixture,
    average_difficulty,
    fixture_difficulty_for_team,
    recent_completed_gameweeks,
    upcoming_fixtures_for_team,
    weighted_form_score,
)
from schemas import Fixture, Gameweek


def _gw(id_: int, finished: bool, is_current: bool = False) -> Gameweek:
    return Gameweek(
        id=id_,
        name=f"Gameweek {id_}",
        deadline_time=f"2026-01-{id_:02d}T00:00:00Z",
        is_current=is_current,
        is_next=False,
        finished=finished,
    )


def _fx(
    id_: int,
    event: int | None,
    team_h: int,
    team_a: int,
    finished: bool = False,
    team_h_difficulty: int | None = None,
    team_a_difficulty: int | None = None,
    kickoff_time: str | None = "2026-01-01T15:00:00Z",
) -> Fixture:
    return Fixture(
        id=id_,
        event=event,
        kickoff_time=kickoff_time,
        team_h=team_h,
        team_a=team_a,
        finished=finished,
        started=False,
        team_h_difficulty=team_h_difficulty,
        team_a_difficulty=team_a_difficulty,
    )


# ---------------------------------------------------------------------------
# recent_completed_gameweeks
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label, gameweeks, n, expected",
    [
        (
            "five finished, take last three, ascending",
            [_gw(i, finished=True) for i in range(1, 6)],
            3,
            [3, 4, 5],
        ),
        (
            "mix of finished and unfinished — only finished counted",
            [
                _gw(1, True),
                _gw(2, True),
                _gw(3, False),
                _gw(4, True),
                _gw(5, False),
            ],
            5,
            [1, 2, 4],
        ),
        (
            "fewer finished than n — return all of them",
            [_gw(1, True), _gw(2, True), _gw(3, False)],
            5,
            [1, 2],
        ),
        (
            "nothing finished yet — empty",
            [_gw(1, False), _gw(2, False)],
            5,
            [],
        ),
        (
            "unordered input — result is ascending",
            [_gw(5, True), _gw(2, True), _gw(8, True), _gw(4, True)],
            3,
            [4, 5, 8],
        ),
    ],
)
def test_recent_completed_gameweeks(label, gameweeks, n, expected):
    assert recent_completed_gameweeks(gameweeks, n) == expected, label


# ---------------------------------------------------------------------------
# weighted_form_score
# ---------------------------------------------------------------------------


class TestWeightedFormScore:
    WEIGHTS = [5.0, 4.0, 3.0, 2.0, 1.0]

    def test_full_length_matches_weighted_avg(self):
        # Points [2,4,6,8,10], weights [5,4,3,2,1], weighted sum = 70, total weight 15
        # Expected = 70/15 = 4.666...
        result = weighted_form_score([2, 4, 6, 8, 10], self.WEIGHTS)
        assert result == pytest.approx(70 / 15)

    def test_fewer_points_uses_suffix_and_renormalizes(self):
        # 3 points [3, 6, 9] with weights [5,4,3,2,1] → align to [3,2,1]
        # Weighted sum = 3*3 + 6*2 + 9*1 = 9 + 12 + 9 = 30, total weight 6.
        # Expected = 30/6 = 5.0
        result = weighted_form_score([3, 6, 9], self.WEIGHTS)
        assert result == pytest.approx(5.0)

    def test_single_point_uses_last_weight(self):
        # One point [4] with weights [5,4,3,2,1] → just [1] → 4/1 = 4
        result = weighted_form_score([4], self.WEIGHTS)
        assert result == pytest.approx(4.0)

    def test_empty_points_returns_zero(self):
        assert weighted_form_score([], self.WEIGHTS) == 0.0

    def test_all_zero_points_returns_zero(self):
        assert weighted_form_score([0, 0, 0], self.WEIGHTS) == 0.0

    def test_more_points_than_weights_raises(self):
        with pytest.raises(ValueError, match="more points than weights"):
            weighted_form_score([1, 2, 3, 4, 5, 6], self.WEIGHTS)


# ---------------------------------------------------------------------------
# fixture_difficulty_for_team
# ---------------------------------------------------------------------------


def test_fixture_difficulty_for_home_team():
    fx = _fx(1, 10, team_h=3, team_a=5, team_h_difficulty=2, team_a_difficulty=4)
    assert fixture_difficulty_for_team(fx, 3) == 2


def test_fixture_difficulty_for_away_team():
    fx = _fx(1, 10, team_h=3, team_a=5, team_h_difficulty=2, team_a_difficulty=4)
    assert fixture_difficulty_for_team(fx, 5) == 4


def test_fixture_difficulty_missing_fields_returns_none():
    """Pre-deploy fixtures don't have the difficulty fields — handler
    must degrade gracefully rather than crash."""
    fx = _fx(1, 10, team_h=3, team_a=5)
    assert fixture_difficulty_for_team(fx, 3) is None
    assert fixture_difficulty_for_team(fx, 5) is None


def test_fixture_difficulty_team_not_playing_returns_none():
    fx = _fx(1, 10, team_h=3, team_a=5, team_h_difficulty=2, team_a_difficulty=4)
    assert fixture_difficulty_for_team(fx, 999) is None


# ---------------------------------------------------------------------------
# upcoming_fixtures_for_team
# ---------------------------------------------------------------------------


def test_upcoming_fixtures_filters_and_sorts():
    # Team 3 plays in fixtures 1, 3, 4; fixtures 2 and 5 are other teams.
    fixtures = [
        _fx(1, event=30, team_h=3, team_a=7, team_h_difficulty=3),
        _fx(2, event=30, team_h=1, team_a=2),
        _fx(3, event=32, team_h=5, team_a=3, team_a_difficulty=4),
        _fx(4, event=31, team_h=3, team_a=9, team_h_difficulty=5),
        _fx(5, event=31, team_h=1, team_a=2),
    ]
    result = upcoming_fixtures_for_team(team_id=3, fixtures=fixtures, count=5)
    assert [u.gw for u in result] == [30, 31, 32]
    assert [u.opponent_team_id for u in result] == [7, 9, 5]
    assert [u.home for u in result] == [True, True, False]
    assert [u.difficulty for u in result] == [3, 5, 4]


def test_upcoming_fixtures_skips_finished():
    fixtures = [
        _fx(1, event=30, team_h=3, team_a=7, finished=True),
        _fx(2, event=31, team_h=3, team_a=9),
    ]
    result = upcoming_fixtures_for_team(3, fixtures, count=5)
    assert [u.gw for u in result] == [31]


def test_upcoming_fixtures_skips_tbd_gameweek():
    fixtures = [
        _fx(1, event=None, team_h=3, team_a=7),  # rescheduled TBD
        _fx(2, event=31, team_h=3, team_a=9),
    ]
    result = upcoming_fixtures_for_team(3, fixtures, count=5)
    assert [u.gw for u in result] == [31]


def test_upcoming_fixtures_honors_count():
    fixtures = [_fx(i, event=30 + i, team_h=3, team_a=7) for i in range(10)]
    result = upcoming_fixtures_for_team(3, fixtures, count=3)
    assert len(result) == 3
    assert [u.gw for u in result] == [30, 31, 32]


# ---------------------------------------------------------------------------
# average_difficulty
# ---------------------------------------------------------------------------


def test_average_difficulty_mean():
    ups = [
        UpcomingFixture(gw=1, opponent_team_id=2, home=True, difficulty=2),
        UpcomingFixture(gw=2, opponent_team_id=3, home=False, difficulty=4),
        UpcomingFixture(gw=3, opponent_team_id=4, home=True, difficulty=3),
    ]
    assert average_difficulty(ups) == pytest.approx(3.0)


def test_average_difficulty_skips_nulls():
    ups = [
        UpcomingFixture(gw=1, opponent_team_id=2, home=True, difficulty=2),
        UpcomingFixture(gw=2, opponent_team_id=3, home=False, difficulty=None),
        UpcomingFixture(gw=3, opponent_team_id=4, home=True, difficulty=4),
    ]
    assert average_difficulty(ups) == pytest.approx(3.0)


def test_average_difficulty_all_null_returns_none():
    ups = [
        UpcomingFixture(gw=1, opponent_team_id=2, home=True, difficulty=None),
        UpcomingFixture(gw=2, opponent_team_id=3, home=False, difficulty=None),
    ]
    assert average_difficulty(ups) is None


def test_average_difficulty_empty_returns_none():
    assert average_difficulty([]) is None
