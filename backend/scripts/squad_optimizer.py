"""Pick the best FPL squad for a budget — pure, no I/O.

The transfer suggester searches swaps from an existing squad, which
cannot help on a wildcard or free hit: there the whole squad is
replaced. Choosing 15 players under budget, position and club limits is
a small integer programme, so we hand it to a solver and get the exact
optimum rather than a heuristic.

One starting XI is chosen for the whole horizon. Real managers
re-pick their XI every gameweek, so the objective slightly undervalues
rotation pairs; ``bench_weight`` is the knob that compensates.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import pulp

from xp_v2 import DEF, FWD, GKP, MID


# How much a bench player's xP counts next to a starter's.
DEFAULT_BENCH_WEIGHT = 0.1
# FPL's API prices players in tenths of £1m.
TENTHS_PER_MILLION = 10


def format_millions(tenths: int) -> str:
    return f"£{tenths / TENTHS_PER_MILLION:.1f}m"


class NoFeasibleSquad(Exception):
    """The pool, budget, locks and exclusions admit no legal squad."""


@dataclass(frozen=True)
class Candidate:
    player_id: int
    web_name: str
    team_id: int
    position: int
    cost_tenths: int
    horizon_xp: float
    next_gw_xp: float


@dataclass(frozen=True)
class SquadRules:
    """FPL's squad-shape rules. Defaults are the real game's; tests
    shrink them so hand-built pools stay readable."""

    max_players_per_team: int
    squad_size_by_position: dict[int, int] = field(
        default_factory=lambda: {GKP: 2, DEF: 5, MID: 5, FWD: 3}
    )
    starters: int = 11
    min_starters_by_position: dict[int, int] = field(
        default_factory=lambda: {GKP: 1, DEF: 3, MID: 2, FWD: 1}
    )
    max_starters_by_position: dict[int, int] = field(
        default_factory=lambda: {GKP: 1}
    )


@dataclass(frozen=True)
class OptimizedSquad:
    starters: list[Candidate]
    bench: list[Candidate]
    captain: Candidate
    total_cost_tenths: int

    @property
    def squad(self) -> list[Candidate]:
        return [*self.starters, *self.bench]

    @property
    def starters_horizon_xp(self) -> float:
        return sum(player.horizon_xp for player in self.starters)


def optimize_squad(
    *,
    candidates: Iterable[Candidate],
    budget_tenths: int,
    rules: SquadRules,
    bench_weight: float,
    locked_ids: frozenset[int] = frozenset(),
    excluded_ids: frozenset[int] = frozenset(),
) -> OptimizedSquad:
    """Return the squad, XI and captain maximising

        sum(starter horizon xP)
        + bench_weight × sum(bench horizon xP)
        + captain's next-gameweek xP

    Raises ``NoFeasibleSquad`` when nothing legal fits, and ``ValueError``
    when a locked id is unknown or also excluded.
    """
    pool = [c for c in candidates if c.player_id not in excluded_ids]
    pool_ids = {c.player_id for c in pool}
    if locked_ids & excluded_ids:
        raise ValueError(
            f"Players both locked and excluded: {sorted(locked_ids & excluded_ids)}"
        )
    if locked_ids - pool_ids:
        raise ValueError(
            f"Locked players not in the candidate pool: {sorted(locked_ids - pool_ids)}"
        )

    problem = pulp.LpProblem("squad", pulp.LpMaximize)
    in_squad = _binary_variables("in_squad", pool)
    starts = _binary_variables("starts", pool)
    is_captain = _binary_variables("is_captain", pool)

    problem += pulp.lpSum(
        starts[c.player_id] * c.horizon_xp
        + (in_squad[c.player_id] - starts[c.player_id]) * c.horizon_xp * bench_weight
        + is_captain[c.player_id] * c.next_gw_xp
        for c in pool
    )

    problem += (
        pulp.lpSum(in_squad[c.player_id] * c.cost_tenths for c in pool) <= budget_tenths
    )
    problem += pulp.lpSum(starts.values()) == rules.starters
    problem += pulp.lpSum(is_captain.values()) == 1
    for c in pool:
        problem += starts[c.player_id] <= in_squad[c.player_id]
        problem += is_captain[c.player_id] <= starts[c.player_id]
    for position, size in rules.squad_size_by_position.items():
        problem += pulp.lpSum(_of_position(in_squad, pool, position)) == size
    for position, minimum in rules.min_starters_by_position.items():
        problem += pulp.lpSum(_of_position(starts, pool, position)) >= minimum
    for position, maximum in rules.max_starters_by_position.items():
        problem += pulp.lpSum(_of_position(starts, pool, position)) <= maximum
    for team_id in {c.team_id for c in pool}:
        problem += (
            pulp.lpSum(in_squad[c.player_id] for c in pool if c.team_id == team_id)
            <= rules.max_players_per_team
        )
    for player_id in locked_ids:
        problem += in_squad[player_id] == 1

    problem.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[problem.status] != "Optimal":
        raise NoFeasibleSquad(
            f"No legal squad for a budget of {budget_tenths} tenths of £m (solver status: "
            f"{pulp.LpStatus[problem.status]})"
        )

    starters = [c for c in pool if _is_chosen(starts[c.player_id])]
    bench = [
        c for c in pool
        if _is_chosen(in_squad[c.player_id]) and not _is_chosen(starts[c.player_id])
    ]
    captain = next(c for c in pool if _is_chosen(is_captain[c.player_id]))
    return OptimizedSquad(
        starters=starters,
        bench=bench,
        captain=captain,
        total_cost_tenths=sum(c.cost_tenths for c in [*starters, *bench]),
    )


def _binary_variables(prefix: str, pool: list[Candidate]) -> dict[int, pulp.LpVariable]:
    return {
        c.player_id: pulp.LpVariable(f"{prefix}_{c.player_id}", cat=pulp.LpBinary)
        for c in pool
    }


def _of_position(
    variables: dict[int, pulp.LpVariable], pool: list[Candidate], position: int
) -> list[pulp.LpVariable]:
    return [variables[c.player_id] for c in pool if c.position == position]


def _is_chosen(variable: pulp.LpVariable) -> bool:
    # Solvers return binaries as floats that can sit a hair off 0 or 1.
    return round(variable.value() or 0) == 1
