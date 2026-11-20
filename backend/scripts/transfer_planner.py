"""Multi-week transfer planner — pure, no I/O.

The app suggests transfers one week at a time. This plans several weeks
at once: which transfers to make in which week, who starts and who
captains, with saved free transfers and 4-point hits, all chosen
together by an integer programme (PuLP, as ``squad_optimizer.py``).

Only the first week of a plan is meant to be carried out: next week the
predictions change and the plan is made again.

Objective, over gameweeks t = 0 .. H-1:

    sum_t GAMEWEEK_DISCOUNT^t × (starters' points + captain's points again
                                 + bench_weight × bench points − hits)
    + BANKED_TRANSFER_VALUE × free transfers left after the last week

Simplifications:

- Prices stay as they are now for the whole horizon.
- A player bought inside the horizon sells back at his price.
- If a real-life move has left more than three players from one club,
  that club keeps its count but nobody can be bought from it, as FPL
  allows.
"""
from __future__ import annotations

from dataclasses import dataclass

import pulp

from compute import HIT_COST_POINTS, MAX_BANKED_FREE_TRANSFERS
from squad_optimizer import DEFAULT_BENCH_WEIGHT, SquadRules

GAMEWEEK_DISCOUNT = 0.9
BANKED_TRANSFER_VALUE = 1.0
FREE_TRANSFERS_GAINED_PER_WEEK = 1
CAPTAIN_EXTRA_MULTIPLIER = 1
# Shortlist per position: the best by horizon points, plus the best by
# points per £ so cheap enablers survive a tight budget.
SHORTLIST_BY_POINTS = 30
SHORTLIST_BY_VALUE = 10
SOLVER_TIME_LIMIT_SECONDS = 20
SOLVER_RELATIVE_GAP = 0.001
# The solver returns binaries as floats a hair off 0 or 1.
_CHOSEN_THRESHOLD = 0.5
_FEASIBLE_STATUSES = frozenset({"Optimal"})


class NoFeasiblePlan(Exception):
    """The squad, bank and rules admit no plan (should not happen: doing
    nothing is always legal)."""


@dataclass(frozen=True)
class PlayerOption:
    """A player the planner may keep, sell or buy. ``sell_price`` is
    what selling raises: the selling price for a squad player, the
    price for anyone else."""

    player_id: int
    position: int
    club: int
    price: int
    sell_price: int
    points_by_week: tuple[float, ...]


@dataclass(frozen=True)
class PlanSettings:
    rules: SquadRules
    discount: float = GAMEWEEK_DISCOUNT
    banked_transfer_value: float = BANKED_TRANSFER_VALUE
    bench_weight: float = DEFAULT_BENCH_WEIGHT
    hit_cost: int = HIT_COST_POINTS
    max_free_transfers: int = MAX_BANKED_FREE_TRANSFERS
    shortlist_by_points: int = SHORTLIST_BY_POINTS
    shortlist_by_value: int = SHORTLIST_BY_VALUE


@dataclass(frozen=True)
class PlannedWeek:
    sold: tuple[int, ...]
    bought: tuple[int, ...]
    squad: frozenset[int]
    starters: frozenset[int]
    captain: int
    free_transfers: int
    hits: int


@dataclass(frozen=True)
class Plan:
    weeks: tuple[PlannedWeek, ...]
    objective: float


def shortlist(options: list[PlayerOption], squad: frozenset[int],
              settings: PlanSettings) -> list[PlayerOption]:
    """The squad plus, per position, the best outsiders by horizon points
    and by points per £."""
    chosen = {o.player_id for o in options if o.player_id in squad}
    for position in settings.rules.squad_size_by_position:
        outsiders = [o for o in options if o.position == position and o.player_id not in squad]
        by_points = sorted(outsiders, key=lambda o: (-sum(o.points_by_week), o.player_id))
        by_value = sorted(outsiders,
                          key=lambda o: (-sum(o.points_by_week) / o.price, o.player_id))
        chosen |= {o.player_id for o in by_points[:settings.shortlist_by_points]}
        chosen |= {o.player_id for o in by_value[:settings.shortlist_by_value]}
    return [o for o in options if o.player_id in chosen]


def plan_transfers(
    *,
    options: list[PlayerOption],
    squad: frozenset[int],
    bank: int,
    free_transfers: int,
    settings: PlanSettings,
) -> Plan:
    """The best plan over ``len(points_by_week)`` weeks for ``squad``.
    ``options`` must include every squad player."""
    pool = shortlist(options, squad, settings)
    by_id = {o.player_id: o for o in pool}
    missing = squad - by_id.keys()
    if missing:
        raise ValueError(f"Squad players missing from options: {sorted(missing)}")
    horizon = len(pool[0].points_by_week)
    weeks = range(horizon)
    rules = settings.rules

    problem = pulp.LpProblem("transfer_plan", pulp.LpMaximize)

    def binaries(name: str) -> dict[tuple[int, int], pulp.LpVariable]:
        return {(o.player_id, t): pulp.LpVariable(f"{name}_{o.player_id}_{t}", cat=pulp.LpBinary)
                for o in pool for t in weeks}

    in_squad, starts, captain = binaries("in_squad"), binaries("starts"), binaries("captain")
    bought, sold = binaries("bought"), binaries("sold")
    hits = {t: pulp.LpVariable(f"hits_{t}", lowBound=0, cat=pulp.LpInteger) for t in weeks}
    free = {
        t: pulp.LpVariable(f"free_{t}", lowBound=0, upBound=settings.max_free_transfers,
                           cat=pulp.LpInteger)
        for t in range(horizon + 1)
    }
    money = {t: pulp.LpVariable(f"bank_{t}", lowBound=0) for t in weeks}

    problem += pulp.lpSum(
        settings.discount ** t * (
            pulp.lpSum(
                o.points_by_week[t] * (
                    starts[o.player_id, t]
                    + CAPTAIN_EXTRA_MULTIPLIER * captain[o.player_id, t]
                    + settings.bench_weight * (in_squad[o.player_id, t] - starts[o.player_id, t])
                )
                for o in pool
            )
            - settings.hit_cost * hits[t]
        )
        for t in weeks
    ) + settings.banked_transfer_value * free[horizon]

    problem += free[0] == free_transfers
    clubs = {o.club for o in pool}
    count_now = {club: sum(1 for p in squad if by_id[p].club == club) for club in clubs}
    for t in weeks:
        for o in pool:
            before = (1 if o.player_id in squad else 0) if t == 0 else in_squad[o.player_id, t - 1]
            problem += in_squad[o.player_id, t] == before + bought[o.player_id, t] - sold[o.player_id, t]
            problem += starts[o.player_id, t] <= in_squad[o.player_id, t]
            problem += captain[o.player_id, t] <= starts[o.player_id, t]
            if count_now[o.club] > rules.max_players_per_team:
                problem += bought[o.player_id, t] == 0

        transfers = pulp.lpSum(bought[o.player_id, t] for o in pool)
        problem += transfers - hits[t] <= free[t]
        problem += free[t + 1] <= free[t] - (transfers - hits[t]) + FREE_TRANSFERS_GAINED_PER_WEEK

        previous_bank = bank if t == 0 else money[t - 1]
        problem += money[t] == previous_bank + pulp.lpSum(
            sold[o.player_id, t] * o.sell_price - bought[o.player_id, t] * o.price for o in pool
        )

        problem += pulp.lpSum(starts[o.player_id, t] for o in pool) == rules.starters
        problem += pulp.lpSum(captain[o.player_id, t] for o in pool) == 1
        for position, size in rules.squad_size_by_position.items():
            problem += pulp.lpSum(
                in_squad[o.player_id, t] for o in pool if o.position == position) == size
        for position, minimum in rules.min_starters_by_position.items():
            problem += pulp.lpSum(
                starts[o.player_id, t] for o in pool if o.position == position) >= minimum
        for position, maximum in rules.max_starters_by_position.items():
            problem += pulp.lpSum(
                starts[o.player_id, t] for o in pool if o.position == position) <= maximum
        for club in clubs:
            problem += pulp.lpSum(
                in_squad[o.player_id, t] for o in pool if o.club == club
            ) <= max(rules.max_players_per_team, count_now[club])

    problem.solve(pulp.PULP_CBC_CMD(msg=False, timeLimit=SOLVER_TIME_LIMIT_SECONDS,
                                    gapRel=SOLVER_RELATIVE_GAP))
    if pulp.LpStatus[problem.status] not in _FEASIBLE_STATUSES:
        raise NoFeasiblePlan(f"Solver status: {pulp.LpStatus[problem.status]}")

    def chosen(variable: pulp.LpVariable) -> bool:
        return (variable.value() or 0) > _CHOSEN_THRESHOLD

    planned = []
    for t in weeks:
        planned.append(PlannedWeek(
            sold=tuple(sorted(o.player_id for o in pool if chosen(sold[o.player_id, t]))),
            bought=tuple(sorted(o.player_id for o in pool if chosen(bought[o.player_id, t]))),
            squad=frozenset(o.player_id for o in pool if chosen(in_squad[o.player_id, t])),
            starters=frozenset(o.player_id for o in pool if chosen(starts[o.player_id, t])),
            captain=next(o.player_id for o in pool if chosen(captain[o.player_id, t])),
            free_transfers=round(free[t].value()),
            hits=round(hits[t].value()),
        ))
    return Plan(weeks=tuple(planned), objective=pulp.value(problem.objective))


def pair_moves(week: PlannedWeek, position_by_player: dict[int, int]) -> list[tuple[int, int]]:
    """(sold, bought) pairs of the same position, in id order."""
    pairs = []
    remaining = list(week.bought)
    for out_id in week.sold:
        in_id = next(p for p in remaining if position_by_player[p] == position_by_player[out_id])
        remaining.remove(in_id)
        pairs.append((out_id, in_id))
    return pairs
