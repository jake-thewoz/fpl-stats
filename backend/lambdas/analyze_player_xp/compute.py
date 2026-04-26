"""Pure computation for the player-xp analyzer.

Side-effect-free so the math is unit-testable on hand-built data per the
issue's AC. The handler wires these against DDB I/O.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from schemas import Fixture, Gameweek, Player


@dataclass(frozen=True)
class XpComponents:
    """Inputs that fed into a player's xP — kept on the output record so
    the API/UI can show 'why' alongside the value, and so a stale-looking
    xP can be debugged from the stored row alone."""

    form_score: float
    fixture_easiness: float
    minutes_prob: float
    num_fixtures: int


def upcoming_gameweek(gameweeks: Iterable[Gameweek]) -> Optional[int]:
    """Return the next un-finished gameweek's id, or None if the season's
    over. Prefers ``is_next`` (FPL's own pointer) and falls back to the
    smallest unfinished id so this still works in pre-season when no
    gameweek is flagged ``is_next``.
    """
    gw_list = list(gameweeks)
    for gw in gw_list:
        if gw.is_next:
            return gw.id
    unfinished = sorted(gw.id for gw in gw_list if not gw.finished)
    return unfinished[0] if unfinished else None


def fixtures_in_gw_for_team(
    fixtures: Iterable[Fixture],
    team_id: int,
    gw: int,
) -> list[Fixture]:
    """Fixtures the team plays in this specific gameweek. Usually 0 or 1;
    can be 2 in a double gameweek. Skips fixtures with finished=True so
    a re-run after kickoff doesn't double-count a result."""
    return [
        fx for fx in fixtures
        if fx.event == gw
        and not fx.finished
        and team_id in (fx.team_h, fx.team_a)
    ]


def fixture_easiness(difficulty: Optional[int]) -> float:
    """Map FPL's 1-5 difficulty (lower = easier) to a 0.2-1.0 multiplier.

    None difficulty (pre-deploy cached rows missing the field) falls back
    to 0.6 — the mid value — so we don't rank players by accident of the
    cache state. The form-analyzer made the same conservative choice for
    its average_difficulty fallback, just at a different layer.
    """
    if difficulty is None:
        return 0.6
    return (6 - difficulty) / 5


def gw_easiness(team_fixtures: Iterable[Fixture], team_id: int) -> float:
    """Average easiness across all the team's fixtures this GW. Empty
    iterable -> 0.0 so a blank-GW player ends up with xP=0 without a
    divide-by-zero."""
    fxs = list(team_fixtures)
    if not fxs:
        return 0.0
    easinesses = [
        fixture_easiness(
            fx.team_h_difficulty if fx.team_h == team_id else fx.team_a_difficulty
        )
        for fx in fxs
    ]
    return sum(easinesses) / len(easinesses)


def minutes_probability(player: Player) -> float:
    """Probability the player plays meaningful minutes this GW.

    FPL's ``chance_of_playing_next_round`` is the source of truth when set
    (0/25/50/75/100). It's left null when there's no doubt — fall back to
    1.0 for available players, 0.0 for everyone else (injured, suspended,
    etc.). Conservative on availability: a flagged player should never
    rank highly on the back of historical form alone.
    """
    cop = player.chance_of_playing_next_round
    if cop is not None:
        return max(0.0, min(1.0, cop / 100.0))
    if player.status == "a":
        return 1.0
    return 0.0


def expected_points(
    form_score: float,
    easiness: float,
    minutes_prob: float,
    num_fixtures: int,
) -> float:
    """Per-GW expected points for one player.

    Captain EV is just this doubled (FPL's captain multiplier); a triple-
    captain chip would triple it. Kept multiplier-free so consumers can
    rank for captaincy, vice-captaincy, transfers, or display xP directly
    without the analyzer baking a captaincy assumption into the data.
    """
    return form_score * easiness * minutes_prob * num_fixtures
