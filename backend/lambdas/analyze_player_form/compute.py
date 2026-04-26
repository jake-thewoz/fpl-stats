"""Pure computation for the player-form analyzer.

Kept free of side effects — no DDB, no HTTP, no time — so the handler's
orchestration logic can be tested by wiring real compute against mocked
I/O, and these functions can be unit-tested with hand-built datasets
per the issue's AC.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from schemas import Fixture, Gameweek


@dataclass(frozen=True)
class UpcomingFixture:
    gw: int
    opponent_team_id: int
    home: bool
    difficulty: Optional[int]


def recent_completed_gameweeks(
    gameweeks: Iterable[Gameweek],
    n: int,
) -> list[int]:
    """Return up to n most recent *finished* gameweek IDs, ascending.

    Ascending so that downstream per-GW lists stay chronologically ordered
    (helpful for both the stored `recent_points` array and debugging).
    """
    finished_ids = sorted(gw.id for gw in gameweeks if gw.finished)
    return finished_ids[-n:]


def weighted_form_score(
    points: list[int],
    weights: list[float],
) -> float:
    """Weighted average of points with auto-aligned weights.

    If fewer points than weights are available, use the *most-recent-heavy*
    suffix of weights and renormalize. Example: weights=[5,4,3,2,1] and
    only 3 points means weights used are the last three, [3,2,1],
    renormalized to [0.5, 0.333, 0.167].

    Returns 0.0 when `points` is empty.
    """
    if not points:
        return 0.0
    if len(points) > len(weights):
        raise ValueError("more points than weights — analyzer misconfig")

    aligned = weights[-len(points):]
    total_weight = sum(aligned)
    if total_weight == 0:
        raise ValueError("weights sum to zero")

    return sum(p * w for p, w in zip(points, aligned)) / total_weight


def fixture_difficulty_for_team(fixture: Fixture, team_id: int) -> Optional[int]:
    """Return FPL's 1-5 difficulty rating for `team_id` in this fixture,
    or None if the cached fixture predates difficulty fields being stored.
    """
    if team_id == fixture.team_h:
        return fixture.team_h_difficulty
    if team_id == fixture.team_a:
        return fixture.team_a_difficulty
    return None


def upcoming_fixtures_for_team(
    team_id: int,
    fixtures: Iterable[Fixture],
    count: int,
) -> list[UpcomingFixture]:
    """Return up to `count` upcoming fixtures for `team_id`, chronologically.

    An "upcoming" fixture is one with `finished=False` AND a known gameweek
    (event is not None). Fixtures without a scheduled gameweek (rescheduled,
    TBD) are skipped so results are always GW-anchored.
    """
    theirs = [
        fx for fx in fixtures
        if not fx.finished and fx.event is not None
        and team_id in (fx.team_h, fx.team_a)
    ]
    # Sort by (gameweek, kickoff_time) — kickoff_time tiebreaks when FPL
    # schedules two fixtures for the same team in one gameweek (rare, but
    # happens with postponement-and-replay).
    theirs.sort(key=lambda fx: (fx.event, fx.kickoff_time or ""))

    out: list[UpcomingFixture] = []
    for fx in theirs[:count]:
        is_home = fx.team_h == team_id
        opponent = fx.team_a if is_home else fx.team_h
        out.append(
            UpcomingFixture(
                gw=fx.event,  # type: ignore[arg-type]  # filtered above
                opponent_team_id=opponent,
                home=is_home,
                difficulty=fixture_difficulty_for_team(fx, team_id),
            )
        )
    return out


def average_difficulty(upcoming: Iterable[UpcomingFixture]) -> Optional[float]:
    """Mean of non-null difficulties, or None if none of the upcoming
    fixtures had a difficulty populated."""
    values = [u.difficulty for u in upcoming if u.difficulty is not None]
    if not values:
        return None
    return sum(values) / len(values)
