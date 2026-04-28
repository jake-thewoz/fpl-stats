"""Unit tests for the v2 Lambda's per-fixture helpers."""
from __future__ import annotations

import pytest

from compute import (
    build_fixture_context,
    opp_strength_from_difficulty,
    opponent_team_id,
    player_difficulty,
)
from schemas import Fixture


def _fx(*, team_h=1, team_a=2, team_h_difficulty=3, team_a_difficulty=3) -> Fixture:
    return Fixture(
        id=1, event=33, kickoff_time="2026-04-24T17:30:00Z",
        team_h=team_h, team_a=team_a, finished=False, started=False,
        team_h_difficulty=team_h_difficulty,
        team_a_difficulty=team_a_difficulty,
    )


# ---------------------------------------------------------------------------
# opp_strength_from_difficulty
# ---------------------------------------------------------------------------


def test_opp_strength_difficulty_3_is_neutral() -> None:
    """Mid-tier opponent → 0.5, leaving fixture factors at 1.0."""
    assert opp_strength_from_difficulty(3) == 0.5


@pytest.mark.parametrize("difficulty,expected", [
    (1, 0.0),
    (2, 0.25),
    (3, 0.5),
    (4, 0.75),
    (5, 1.0),
])
def test_opp_strength_full_range(difficulty: int, expected: float) -> None:
    """Linear mapping across the full 1-5 range."""
    assert opp_strength_from_difficulty(difficulty) == pytest.approx(expected)


def test_opp_strength_none_falls_back_to_neutral() -> None:
    """Missing difficulty → 0.5 (same conservative fallback v1 makes)."""
    assert opp_strength_from_difficulty(None) == 0.5


# ---------------------------------------------------------------------------
# player_difficulty
# ---------------------------------------------------------------------------


def test_player_difficulty_home_returns_team_h_difficulty() -> None:
    fx = _fx(team_h=1, team_a=2, team_h_difficulty=2, team_a_difficulty=4)
    assert player_difficulty(fx, team_id=1) == 2


def test_player_difficulty_away_returns_team_a_difficulty() -> None:
    fx = _fx(team_h=1, team_a=2, team_h_difficulty=2, team_a_difficulty=4)
    assert player_difficulty(fx, team_id=2) == 4


def test_player_difficulty_third_team_returns_none() -> None:
    """Defensive — if a stale row has a team_id that's not in this fixture,
    return None rather than a confident wrong answer."""
    fx = _fx(team_h=1, team_a=2)
    assert player_difficulty(fx, team_id=99) is None


# ---------------------------------------------------------------------------
# build_fixture_context
# ---------------------------------------------------------------------------


def test_build_fixture_context_home() -> None:
    fx = _fx(team_h=1, team_a=2, team_h_difficulty=2, team_a_difficulty=4)
    ctx = build_fixture_context(fx, team_id=1)
    assert ctx.home is True
    assert ctx.fpl_difficulty == 2
    # difficulty 2 → opp_strength 0.25
    assert ctx.opponent_strength == pytest.approx(0.25)


def test_build_fixture_context_away() -> None:
    fx = _fx(team_h=1, team_a=2, team_h_difficulty=2, team_a_difficulty=4)
    ctx = build_fixture_context(fx, team_id=2)
    assert ctx.home is False
    assert ctx.fpl_difficulty == 4
    # difficulty 4 → opp_strength 0.75
    assert ctx.opponent_strength == pytest.approx(0.75)


def test_build_fixture_context_missing_difficulty_falls_back() -> None:
    """A fixture with no difficulty field → opp_strength 0.5 (neutral)."""
    fx = _fx(team_h_difficulty=None, team_a_difficulty=None)
    ctx = build_fixture_context(fx, team_id=1)
    assert ctx.opponent_strength == 0.5
    assert ctx.fpl_difficulty is None


# ---------------------------------------------------------------------------
# opponent_team_id
# ---------------------------------------------------------------------------


def test_opponent_team_id_home() -> None:
    fx = _fx(team_h=1, team_a=2)
    assert opponent_team_id(fx, team_id=1) == 2


def test_opponent_team_id_away() -> None:
    fx = _fx(team_h=1, team_a=2)
    assert opponent_team_id(fx, team_id=2) == 1
