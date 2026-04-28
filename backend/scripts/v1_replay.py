"""Replay v1 xP for historical rows so the backtest can compare it to v2.

The v1 model is in ``layers/fpl_schemas/python/xp_compute.py``:

    xP = form_score × fixture_easiness × minutes_prob × num_fixtures

To replay v1 for a historical (player, GW) row we need each of those
inputs as they would have been computed at the start of that GW —
strictly using data available before the GW (no leakage), same
discipline as Phase 2's feature pipeline.

Approximations
--------------
- **``minutes_prob``**: we don't have historical snapshots of FPL's
  ``chance_of_playing_next_round`` field (it's a per-day rolling
  signal we never archived), so we use the **observed-minutes oracle**:
  ``minutes_prob = 1.0 if minutes > 0 else 0.0``. This gives v1 the
  same fairness break v2 gets in the offline fit (Phase 3) — both
  models are evaluated on per-90 calibration, not on cop prediction.

- **fixture difficulty**: pulled from the *current* ``fpl#fixtures``
  cache. FPL adjusts difficulty values rarely (and usually preseason),
  so the current values approximate what was visible at the time. A
  small source of error this script can't avoid without preserving
  per-GW snapshots — which we'd have to start doing now to fix in
  hindsight.

These approximations are documented in the backtest report so the
pass/fail decision is interpreted in their light.
"""
from __future__ import annotations

import logging
from typing import Iterable

from schemas import Fixture, PlayerHistoryRow

log = logging.getLogger(__name__)


# Mirror analyze_player_form's choices. Inlined rather than imported
# to avoid a layer/Lambda cross-import in a backtest script — the
# constants here are the contract; if v1 changes them we update both.
FORM_WEIGHTS: tuple[float, ...] = (5.0, 4.0, 3.0, 2.0, 1.0)
RECENT_GW_COUNT: int = 5
DEFAULT_FIXTURE_EASINESS: float = 0.6  # mid-value when difficulty is null


def weighted_form_score(points: list[int]) -> float:
    """Weighted average with auto-aligned weights.

    Mirrors ``analyze_player_form.compute.weighted_form_score`` exactly.
    Empty input returns 0.0 so a player with no prior GWs (round 1)
    gets v1 xP = 0 — captures v1's actual behaviour at season start.

    Returns 0.0 when ``points`` is empty.
    """
    if not points:
        return 0.0
    if len(points) > len(FORM_WEIGHTS):
        # Caller responsibility — should slice to RECENT_GW_COUNT first.
        raise ValueError("more points than weights")
    aligned = FORM_WEIGHTS[-len(points):]
    total_weight = sum(aligned)
    return sum(p * w for p, w in zip(points, aligned)) / total_weight


def fixture_easiness(difficulty: int | None) -> float:
    """Map FPL's 1-5 difficulty (lower = easier) to a 0.2-1.0 multiplier.

    Same shape as ``xp_compute.fixture_easiness`` — copied here rather
    than imported so the backtest stays a self-contained replay of v1's
    arithmetic (any future v1 change should update both intentionally).
    """
    if difficulty is None:
        return DEFAULT_FIXTURE_EASINESS
    return (6 - difficulty) / 5


def recent_points_before_round(
    history: Iterable[PlayerHistoryRow],
    *,
    as_of_round: int,
    n: int = RECENT_GW_COUNT,
) -> list[int]:
    """Last ``n`` per-GW total_points before ``as_of_round``, chronologically.

    Strict anti-leakage: only rows with ``round < as_of_round``. DGW
    rows (two rows for the same round) are summed into a single
    per-GW total so the form weights line up with FPL's per-GW points.
    """
    by_round: dict[int, int] = {}
    for row in history:
        if row.round >= as_of_round:
            continue
        by_round[row.round] = by_round.get(row.round, 0) + row.total_points

    rounds_asc = sorted(by_round.keys())
    recent = rounds_asc[-n:]
    return [by_round[r] for r in recent]


def find_fixture_difficulty(
    fixtures: Iterable[Fixture],
    *,
    player_team: int,
    opponent_team: int,
    round_: int,
    was_home: bool,
) -> int | None:
    """Look up FPL's 1-5 difficulty for ``player_team`` in this fixture.

    Search by (event, team_h, team_a, was_home) since the player-history
    row tells us was_home and opponent_team but not the fixture id.
    Returns None if no fixture matches (e.g. cache eviction or a
    rescheduled game with shifted event id).
    """
    if was_home:
        team_h, team_a = player_team, opponent_team
    else:
        team_h, team_a = opponent_team, player_team
    for fx in fixtures:
        if fx.event != round_:
            continue
        if fx.team_h != team_h or fx.team_a != team_a:
            continue
        return fx.team_h_difficulty if was_home else fx.team_a_difficulty
    return None


def predict_v1_for_row(
    *,
    target_row: PlayerHistoryRow,
    player_history: Iterable[PlayerHistoryRow],
    player_team: int,
    fixtures: Iterable[Fixture],
) -> float:
    """v1 xP prediction for a single historical fixture row.

    ``num_fixtures = 1`` always — the per-row prediction. A DGW yields
    two rows, two predictions; their sum equals v1's per-GW xP for that
    player (which is what consumers of v1 see in production).

    Returns 0.0 for any row where the player didn't play (minutes == 0)
    via the observed-minutes oracle.
    """
    minutes_prob = 1.0 if target_row.minutes > 0 else 0.0
    if minutes_prob == 0.0:
        return 0.0  # short-circuit: v1's product collapses anyway

    points = recent_points_before_round(
        player_history,
        as_of_round=target_row.round,
        n=RECENT_GW_COUNT,
    )
    form = weighted_form_score(points)

    difficulty = find_fixture_difficulty(
        fixtures,
        player_team=player_team,
        opponent_team=target_row.opponent_team,
        round_=target_row.round,
        was_home=target_row.was_home,
    )
    easiness = fixture_easiness(difficulty)

    # num_fixtures = 1 per row (DGW = two rows, summed by the caller
    # if a per-GW view is needed).
    return form * easiness * minutes_prob * 1
