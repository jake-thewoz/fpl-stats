from __future__ import annotations

import pytest

from xp_compute import (
    fixtures_in_gw_for_team,
    minutes_probability,
    minutes_probability_with_selection,
    upcoming_gameweek_ids,
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
) -> Fixture:
    return Fixture(
        id=id_,
        event=event,
        kickoff_time="2026-01-01T15:00:00Z",
        team_h=team_h,
        team_a=team_a,
        finished=finished,
        started=False,
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
# minutes_probability_with_selection
#
# Adds the season selection-rate dampening to close the "available but
# never picked" gap that plain minutes_probability can't see (the bug
# behind the fringe-DGW Crystal Palace recommendations).
# ---------------------------------------------------------------------------


class TestMinutesProbabilityWithSelection:
    def test_cop_under_100_real_doubt_trusts_fpl(self):
        # cop=75: a returning-from-doubt player FPL has explicitly upgraded
        # but hasn't fully cleared. Trust FPL even if season_play_rate is
        # low (a long absence will have dragged it down — the upgrade is
        # the signal that they're now coming back).
        p = _player(1, status="d", cop=75)
        assert minutes_probability_with_selection(p, 0.4) == pytest.approx(0.75)

    def test_cop_50_returns_half_regardless_of_play_rate(self):
        p = _player(1, status="d", cop=50)
        assert minutes_probability_with_selection(p, 0.95) == pytest.approx(0.5)
        assert minutes_probability_with_selection(p, 0.05) == pytest.approx(0.5)

    def test_cop_zero_returns_zero(self):
        # status='i'/'s'/'u' typically come with cop=0; either way mins_prob=0.
        p = _player(1, status="i", cop=0)
        assert minutes_probability_with_selection(p, 0.9) == 0.0

    def test_cop_100_treated_as_no_concern_dampens_by_rate(self):
        # The bug Jakob hit on the deployed Lambda. FPL ships cop=100 as
        # an explicit "no concern" filler for ~60% of available players —
        # including fringe bench warmers with 0 minutes. The original
        # behaviour ("cop is not None ⇒ trust FPL") fed minutes_prob=1.0
        # for never-picked fringes and put them on top of the transfer
        # list. cop=100 must be treated the same as cop=null: dampen.
        p = _player(1, status="a", cop=100)
        assert minutes_probability_with_selection(p, 0.018) == pytest.approx(0.018)
        assert minutes_probability_with_selection(p, 0.9) == pytest.approx(0.9)

    def test_available_with_high_rate_near_no_op(self):
        # Genuine starter: cop=null, status='a', rate~0.9 → near 1.0.
        p = _player(1, status="a", cop=None)
        assert minutes_probability_with_selection(p, 0.9) == pytest.approx(0.9)

    def test_available_fringe_player_dampened(self):
        # The bug fix: status='a' + cop=null + low play_rate = low mins_prob.
        # Crystal Palace 4th-choice CB style: 50 mins after 30 GWs ≈ 0.018.
        p = _player(1, status="a", cop=None)
        assert minutes_probability_with_selection(p, 0.018) == pytest.approx(0.018)

    def test_unavailable_returns_zero_regardless_of_rate(self):
        # status='u' or status='i' players don't get any benefit from a
        # high play_rate — they're flagged as not available.
        for bad_status in ("i", "s", "u", "n"):
            p = _player(1, status=bad_status, cop=None)
            assert minutes_probability_with_selection(p, 0.9) == 0.0

    def test_play_rate_clamped_to_unit_interval(self):
        # Defensive: even a buggy upstream that hands us 1.5 or -0.2
        # shouldn't escape the [0, 1] contract.
        p = _player(1, status="a", cop=None)
        assert minutes_probability_with_selection(p, 1.5) == pytest.approx(1.0)
        assert minutes_probability_with_selection(p, -0.2) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# upcoming_gameweek_ids
# ---------------------------------------------------------------------------


class TestUpcomingGameweekIds:
    def test_returns_first_n_unfinished_in_order(self):
        gws = [
            _gw(30, finished=True),
            _gw(31, finished=True),
            _gw(32),
            _gw(33),
            _gw(34),
        ]
        assert upcoming_gameweek_ids(gws, 3) == [32, 33, 34]

    def test_clamps_to_remaining_when_horizon_exceeds(self):
        # GW37 with two GWs left and horizon=3 -> [37, 38].
        gws = [_gw(37), _gw(38)]
        assert upcoming_gameweek_ids(gws, 3) == [37, 38]

    def test_returns_empty_when_season_over(self):
        gws = [_gw(37, finished=True), _gw(38, finished=True)]
        assert upcoming_gameweek_ids(gws, 3) == []

    def test_unordered_input_returns_ascending(self):
        gws = [_gw(34), _gw(32, finished=True), _gw(33), _gw(35)]
        assert upcoming_gameweek_ids(gws, 5) == [33, 34, 35]
