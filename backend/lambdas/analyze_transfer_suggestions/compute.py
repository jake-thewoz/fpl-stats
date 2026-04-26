"""Pure computation for the transfer-suggestion read endpoint.

Side-effect-free so candidate generation, constraint checking, and
ranking can be unit-tested with hand-built squads and player pools per
the issue's AC. The handler wires these against DDB I/O and HTTP.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from schemas import Player

# FPL squad rule: max 3 players from any one Premier League team.
MAX_PLAYERS_PER_TEAM = 3


@dataclass(frozen=True)
class TransferCandidate:
    """One suggested out -> in swap with its projected delta-xP and the
    bank-affecting cost change. ``cost_change`` is in 0.1m units (FPL's
    native unit, e.g. 95 == £9.5m), positive when the swap *costs* you
    money — matches FPL's own bank arithmetic."""

    out_player_id: int
    in_player_id: int
    delta_xp: float
    cost_change: int


def team_counts(players: Iterable[Player]) -> dict[int, int]:
    """{team_id: count} across the given players. Used as a baseline for
    the 3-per-team check; the handler then adjusts for the swap."""
    counts: dict[int, int] = defaultdict(int)
    for p in players:
        counts[p.team] += 1
    return dict(counts)


def is_valid_swap(
    out_player: Player,
    in_player: Player,
    squad_ids: set[int],
    counts: dict[int, int],
    bank: int,
) -> bool:
    """Apply FPL's hard constraints: same position, in-player not already
    in squad, budget covers the cost change, max 3-per-team after the swap.

    All four are *hard* — no scoring, no soft penalties. A pair that
    fails any constraint isn't a candidate at all.
    """
    if in_player.id in squad_ids:
        return False
    if in_player.element_type != out_player.element_type:
        return False
    cost_change = in_player.now_cost - out_player.now_cost
    if cost_change > bank:
        return False
    # 3-per-team rule: out's team loses 1, in's team gains 1. If they're
    # the same team, counts don't change. Otherwise the in-team's
    # post-swap count is current + 1.
    if in_player.team == out_player.team:
        return True
    new_in_count = counts.get(in_player.team, 0) + 1
    return new_in_count <= MAX_PLAYERS_PER_TEAM


def suggest_transfers(
    squad: list[Player],
    bank: int,
    candidate_pool: Iterable[Player],
    horizon_xps: dict[int, float],
    top_n: int,
) -> list[TransferCandidate]:
    """Generate, filter, and rank single-transfer (out -> in) suggestions.

    Iterates every (squad-member, candidate) pair, drops those that fail
    constraints, scores the rest by ``in.horizon_xp - out.horizon_xp``,
    and returns the top ``top_n`` by descending delta-xP.

    Tiebreaker on player_id keeps the result stable across runs — the
    same inputs always produce the same output, helpful for both
    snapshot tests and for users who refresh the suggestions and don't
    want unrelated reordering.
    """
    squad_ids = {p.id for p in squad}
    counts = team_counts(squad)
    pool = list(candidate_pool)

    candidates: list[TransferCandidate] = []
    for out_p in squad:
        for in_p in pool:
            if not is_valid_swap(out_p, in_p, squad_ids, counts, bank):
                continue
            delta = horizon_xps.get(in_p.id, 0.0) - horizon_xps.get(out_p.id, 0.0)
            candidates.append(
                TransferCandidate(
                    out_player_id=out_p.id,
                    in_player_id=in_p.id,
                    delta_xp=delta,
                    cost_change=in_p.now_cost - out_p.now_cost,
                )
            )

    candidates.sort(
        key=lambda c: (-c.delta_xp, c.out_player_id, c.in_player_id)
    )
    return candidates[:top_n]
