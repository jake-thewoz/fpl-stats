"""Shared GW + fixtures helpers used by the v2 analyzers.

This module used to host the v1 xP formula (``form × easiness × minutes
× num_fixtures``) plus its supporting math; that code was retired
alongside the v1 analyzer Lambda when the v2 cutover landed (#118 +
follow-up). What remains is the pure GW/fixtures plumbing the v2
writer needs:

- ``upcoming_gameweek_ids``: pick the next N unfinished GW ids
- ``fixtures_in_gw_for_team``: filter a fixtures list to one team's GW
- ``minutes_probability``: P(plays this GW) from FPL's ``status`` /
  ``chance_of_playing_next_round`` fields

The v2 model's per-component math lives in ``xp_v2.py``; the v2 fixture-
context derivation (FPL difficulty → ``opp_strength``) lives next to its
consumer in ``analyze_player_xp_v2/compute.py`` and
``analyze_transfer_suggestions/v2_horizon.py``.
"""
from __future__ import annotations

from typing import Iterable

from schemas import Fixture, Gameweek, Player


def upcoming_gameweek_ids(
    gameweeks: Iterable[Gameweek],
    horizon: int,
) -> list[int]:
    """Return up to ``horizon`` upcoming (un-finished) gameweek ids in
    ascending order. Used by horizon-based analyzers (transfer suggester)
    to know which GWs to project xP across.

    Naturally clamps to remaining season: at GW37 with two GWs left and
    horizon=3, returns [37, 38].
    """
    unfinished = sorted(gw.id for gw in gameweeks if not gw.finished)
    return unfinished[:horizon]


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


def minutes_probability(player: Player) -> float:
    """Probability the player plays meaningful minutes this GW.

    FPL's ``chance_of_playing_next_round`` is the source of truth when set
    (0/25/50/75/100). It's left null when there's no doubt — fall back to
    1.0 for available players, 0.0 for everyone else (injured, suspended,
    etc.). Conservative on availability: a flagged player should never
    rank highly on the back of historical form alone.

    Use ``minutes_probability_with_selection`` for the v2 analyzer path:
    that variant additionally dampens by the player's season selection
    rate, which closes the "fringe player who's available but never
    picked" gap that this function alone can't see.
    """
    cop = player.chance_of_playing_next_round
    if cop is not None:
        return max(0.0, min(1.0, cop / 100.0))
    if player.status == "a":
        return 1.0
    return 0.0


def minutes_probability_with_selection(
    player: Player,
    season_play_rate: float,
) -> float:
    """Like ``minutes_probability`` but dampens by an empirical "the
    manager actually picks them" signal when FPL has no specific
    availability flag.

    Why: FPL surfaces injury / suspension / squad-status via ``status``
    + ``chance_of_playing_next_round`` (cop), but doesn't expose
    "rotation risk". A fringe bench player who's technically available
    has ``status='a'`` and ``cop=null`` — the same signature as a
    guaranteed starter — so plain ``minutes_probability`` returns 1.0
    for both. Combined with position-prior fallback rates and a Double
    Gameweek, that's enough to push them to the top of the transfer
    suggestions despite never seeing the pitch.

    Behaviour:
    - ``cop`` set: trust FPL verbatim (returning-from-injury players
      get cop=75 / 100; we don't want a long-absence ``season_play_rate``
      to override "FPL says they're back").
    - ``cop=null`` + ``status='a'``: dampen by ``season_play_rate``.
      For a starter this is ~0.85+, near-no-op; for a fringe player
      (50 mins after 30 GWs ≈ 0.018) the xP collapses appropriately.
    - Anything else (status='i'/'s'/'u'/None): 0.0, as before.
    """
    cop = player.chance_of_playing_next_round
    if cop is not None:
        return max(0.0, min(1.0, cop / 100.0))
    if player.status == "a":
        return max(0.0, min(1.0, season_play_rate))
    return 0.0
