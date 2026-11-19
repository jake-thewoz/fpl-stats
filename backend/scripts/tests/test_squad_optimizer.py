"""Unit tests for squad_optimizer.py on small hand-built pools."""
from __future__ import annotations

import pytest

from squad_optimizer import (
    Candidate,
    NoFeasibleSquad,
    SquadRules,
    optimize_squad,
)
from xp_v2 import DEF, FWD, GKP, MID

# A miniature game: 2 GKP + 2 DEF + 2 MID + 2 FWD, five starters.
_MINI_RULES = SquadRules(
    max_players_per_team=2,
    squad_size_by_position={GKP: 2, DEF: 2, MID: 2, FWD: 2},
    starters=5,
    min_starters_by_position={GKP: 1, DEF: 1, MID: 1, FWD: 1},
    max_starters_by_position={GKP: 1},
)
_UNLIMITED_BUDGET = 10_000
_NO_BENCH_VALUE = 0.0


def _candidate(player_id: int, position: int, *, team: int, cost: int,
               xp: float) -> Candidate:
    return Candidate(
        player_id=player_id, web_name=f"p{player_id}", team_id=team,
        position=position, cost_tenths=cost, horizon_xp=xp, next_gw_xp=xp,
    )


def _pool() -> list[Candidate]:
    """Three per position, each on its own club. Within a position the
    ids ascend from best/dearest to worst/cheapest."""
    pool = []
    player_id = 0
    for position in (GKP, DEF, MID, FWD):
        for cost, xp in ((100, 9.0), (60, 6.0), (40, 2.0)):
            player_id += 1
            pool.append(_candidate(player_id, position, team=player_id,
                                   cost=cost, xp=xp))
    return pool


def _solve(pool, *, budget=_UNLIMITED_BUDGET, bench_weight=_NO_BENCH_VALUE,
           rules=_MINI_RULES, **kwargs):
    return optimize_squad(candidates=pool, budget_tenths=budget, rules=rules,
                          bench_weight=bench_weight, **kwargs)


def _ids(players) -> set[int]:
    return {p.player_id for p in players}


def test_unlimited_budget_starts_the_best_players() -> None:
    result = _solve(_pool(), bench_weight=0.1)
    # Best GKP (1), and the best DEF/MID/FWD (4, 7, 10) plus one more
    # outfielder from the three 6.0-xP second choices.
    assert {1, 4, 7, 10} <= _ids(result.starters)
    assert len(result.starters) == 5
    assert len(result.bench) == 3
    assert result.starters_horizon_xp == pytest.approx(9.0 * 4 + 6.0)


def test_squad_shape_matches_rules() -> None:
    result = _solve(_pool())
    for position, size in _MINI_RULES.squad_size_by_position.items():
        assert sum(p.position == position for p in result.squad) == size
    assert sum(p.position == GKP for p in result.starters) == 1


def test_budget_is_respected() -> None:
    cheapest_legal_squad = 8 * 40 + 4 * 20  # two cheapest per position
    budget = cheapest_legal_squad + 60
    result = _solve(_pool(), budget=budget)
    assert result.total_cost_tenths <= budget
    assert result.total_cost_tenths == sum(p.cost_tenths for p in result.squad)


def test_no_feasible_squad_raises() -> None:
    with pytest.raises(NoFeasibleSquad):
        _solve(_pool(), budget=10)


def test_club_limit_is_respected() -> None:
    same_club = 99
    pool = [
        _candidate(c.player_id, c.position, team=same_club, cost=c.cost_tenths,
                   xp=c.horizon_xp) if c.horizon_xp == 9.0 else c
        for c in _pool()
    ]
    result = _solve(pool)
    assert sum(p.team_id == same_club for p in result.squad) == 2


def test_locked_player_is_always_in_squad() -> None:
    worst_forward = 12
    assert worst_forward not in _ids(_solve(_pool(), bench_weight=0.1).squad)
    result = _solve(_pool(), bench_weight=0.1,
                    locked_ids=frozenset({worst_forward}))
    assert worst_forward in _ids(result.squad)


def test_excluded_player_is_never_in_squad() -> None:
    best_midfielder = 7
    result = _solve(_pool(), excluded_ids=frozenset({best_midfielder}))
    assert best_midfielder not in _ids(result.squad)


def test_locked_and_excluded_conflict_raises() -> None:
    with pytest.raises(ValueError):
        _solve(_pool(), locked_ids=frozenset({1}), excluded_ids=frozenset({1}))


def test_unknown_locked_player_raises() -> None:
    with pytest.raises(ValueError):
        _solve(_pool(), locked_ids=frozenset({12345}))


def test_bench_weight_buys_a_better_bench_when_money_allows() -> None:
    without_bench_value = _solve(_pool(), bench_weight=0.0)
    with_bench_value = _solve(_pool(), bench_weight=0.5)
    bench_xp = lambda result: sum(p.horizon_xp for p in result.bench)  # noqa: E731
    # All four 9.0s start, so the best possible bench is three 6.0s.
    assert bench_xp(with_bench_value) == pytest.approx(6.0 * 3)
    assert bench_xp(with_bench_value) >= bench_xp(without_bench_value)


def test_tight_budget_puts_cheap_players_on_the_bench() -> None:
    # Enough for the four 9.0-xP stars, one 6.0 starter, and the cheapest
    # player in each remaining slot.
    budget = 4 * 100 + 60 + 3 * 40
    result = _solve(_pool(), budget=budget, bench_weight=0.1)
    assert {1, 4, 7, 10} <= _ids(result.starters)
    assert all(p.cost_tenths == 40 for p in result.bench)


def test_captain_is_the_best_next_gameweek_starter() -> None:
    pool = _pool()
    # Player 8 has middling horizon xP but the best single next gameweek.
    pool[7] = Candidate(player_id=8, web_name="p8", team_id=8, position=MID,
                        cost_tenths=60, horizon_xp=6.0, next_gw_xp=20.0)
    result = _solve(pool)
    assert result.captain.player_id == 8
    assert 8 in _ids(result.starters)
