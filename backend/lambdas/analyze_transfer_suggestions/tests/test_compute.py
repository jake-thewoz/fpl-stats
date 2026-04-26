from __future__ import annotations

import pytest

from compute import (
    MAX_PLAYERS_PER_TEAM,
    TransferCandidate,
    is_valid_swap,
    suggest_transfers,
    team_counts,
)
from schemas import Player


def _player(
    id_: int,
    *,
    team: int = 1,
    position: int = 3,
    cost: int = 80,
    status: str | None = "a",
    cop: int | None = None,
) -> Player:
    return Player(
        id=id_,
        first_name="Test",
        second_name=f"P{id_}",
        web_name=f"P{id_}",
        team=team,
        element_type=position,
        total_points=100,
        form="5.0",
        now_cost=cost,
        status=status,
        chance_of_playing_next_round=cop,
    )


# ---------------------------------------------------------------------------
# team_counts
# ---------------------------------------------------------------------------


def test_team_counts_groups_by_team_id():
    players = [
        _player(1, team=1),
        _player(2, team=1),
        _player(3, team=2),
        _player(4, team=3),
    ]
    assert team_counts(players) == {1: 2, 2: 1, 3: 1}


def test_team_counts_empty_squad_returns_empty_dict():
    assert team_counts([]) == {}


# ---------------------------------------------------------------------------
# is_valid_swap
# ---------------------------------------------------------------------------


def _swap_inputs(out_p, in_p, squad_extras=None, bank=0):
    """Helper: build (squad_ids, counts, bank) for a swap involving out_p
    and any extra squad members. Saves repetition in the constraint tests."""
    squad = [out_p] + list(squad_extras or [])
    return ({p.id for p in squad}, team_counts(squad), bank)


class TestIsValidSwap:
    def test_same_position_within_budget_unowned_passes(self):
        out_p = _player(1, team=1, position=3, cost=80)
        in_p = _player(99, team=2, position=3, cost=80)
        squad_ids, counts, bank = _swap_inputs(out_p, in_p, bank=0)
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is True

    def test_player_already_in_squad_rejected(self):
        out_p = _player(1, team=1, position=3, cost=80)
        already = _player(99, team=2, position=3, cost=80)
        squad_ids, counts, bank = _swap_inputs(
            out_p, already, squad_extras=[already], bank=10
        )
        assert is_valid_swap(out_p, already, squad_ids, counts, bank) is False

    def test_position_mismatch_rejected(self):
        out_p = _player(1, position=3, cost=80)  # MID
        in_p = _player(99, position=4, cost=80)  # FWD
        squad_ids, counts, bank = _swap_inputs(out_p, in_p, bank=0)
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is False

    def test_budget_exact_fit_passes(self):
        # in costs 5 more, bank has exactly 5 - the swap is free of room.
        out_p = _player(1, position=3, cost=80)
        in_p = _player(99, position=3, cost=85)
        squad_ids, counts, bank = _swap_inputs(out_p, in_p, bank=5)
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is True

    def test_budget_one_short_rejected(self):
        out_p = _player(1, position=3, cost=80)
        in_p = _player(99, position=3, cost=86)
        squad_ids, counts, bank = _swap_inputs(out_p, in_p, bank=5)
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is False

    def test_downgrade_below_budget_passes(self):
        # Selling expensive, buying cheap — bank irrelevant.
        out_p = _player(1, position=3, cost=130)
        in_p = _player(99, position=3, cost=80)
        squad_ids, counts, bank = _swap_inputs(out_p, in_p, bank=0)
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is True

    def test_team_limit_blocks_fourth_from_team(self):
        out_p = _player(1, team=1, position=3)
        # Squad already has 3 from team 5; bringing in a 4th must fail.
        team5_a = _player(20, team=5, position=2)
        team5_b = _player(21, team=5, position=4)
        team5_c = _player(22, team=5, position=3)
        in_p = _player(99, team=5, position=3)
        squad_ids, counts, bank = _swap_inputs(
            out_p, in_p, squad_extras=[team5_a, team5_b, team5_c], bank=0
        )
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is False

    def test_team_limit_allows_third_from_team(self):
        # Two from team 5 in squad; adding a third is allowed.
        out_p = _player(1, team=1, position=3)
        team5_a = _player(20, team=5, position=2)
        team5_b = _player(21, team=5, position=4)
        in_p = _player(99, team=5, position=3)
        squad_ids, counts, bank = _swap_inputs(
            out_p, in_p, squad_extras=[team5_a, team5_b], bank=0
        )
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is True

    def test_swap_within_same_team_doesnt_change_counts(self):
        # Out is from team 5; squad already has 2 others from team 5 (so 3
        # total). Bringing in another from team 5 looks like 'four from one
        # team' but isn't, because out leaves first.
        out_p = _player(1, team=5, position=3)
        team5_b = _player(20, team=5, position=2)
        team5_c = _player(21, team=5, position=4)
        in_p = _player(99, team=5, position=3)
        squad_ids, counts, bank = _swap_inputs(
            out_p, in_p, squad_extras=[team5_b, team5_c], bank=0
        )
        assert is_valid_swap(out_p, in_p, squad_ids, counts, bank) is True

    def test_team_limit_uses_module_constant(self):
        """If MAX_PLAYERS_PER_TEAM ever changes, the assertion above
        ('three from team 5 OK') silently still passes if we forgot to
        update tests. Belt-and-braces: assert the constant is what FPL
        actually allows, so a typo there fails this test."""
        assert MAX_PLAYERS_PER_TEAM == 3


# ---------------------------------------------------------------------------
# suggest_transfers
# ---------------------------------------------------------------------------


def test_suggest_transfers_ranks_by_delta_xp_descending():
    # 2-player squad, 3 candidate replacements. All same position + cheap.
    squad = [_player(1, team=1, cost=80), _player(2, team=1, cost=80)]
    pool = [
        _player(10, team=2, cost=80),
        _player(11, team=2, cost=80),
        _player(12, team=2, cost=80),
    ]
    horizon_xps = {1: 5.0, 2: 4.0, 10: 8.0, 11: 12.0, 12: 6.0}
    # Top deltas: in=11 - out=2 (12-4=8); in=11 - out=1 (12-5=7);
    # in=10 - out=2 (8-4=4); in=10 - out=1 (3); in=12 - out=2 (2); in=12 - out=1 (1)
    result = suggest_transfers(squad, bank=0, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=10)
    assert [(c.out_player_id, c.in_player_id) for c in result] == [
        (2, 11), (1, 11), (2, 10), (1, 10), (2, 12), (1, 12),
    ]


def test_suggest_transfers_top_n_truncates():
    squad = [_player(i, team=1, cost=80) for i in range(1, 16)]
    pool = [_player(100 + i, team=2, cost=80) for i in range(20)]
    # Every (out, in) pair is valid. With top_n=5, only top 5 returned.
    horizon_xps = {**{i: float(i) for i in range(1, 16)},
                   **{100 + i: 100.0 - i for i in range(20)}}
    result = suggest_transfers(squad, bank=0, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=5)
    assert len(result) == 5


def test_suggest_transfers_skips_invalid_swaps():
    squad = [_player(1, team=1, position=3, cost=80)]
    pool = [
        _player(10, team=2, position=3, cost=200),  # over-budget
        _player(11, team=2, position=4, cost=80),   # wrong position
        _player(1, team=1, position=3, cost=80),    # in squad already
        _player(12, team=2, position=3, cost=80),   # the only valid one
    ]
    horizon_xps = {1: 4.0, 10: 9.0, 11: 9.0, 12: 6.0}
    result = suggest_transfers(squad, bank=10, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=10)
    assert [(c.out_player_id, c.in_player_id) for c in result] == [(1, 12)]


def test_suggest_transfers_stable_tiebreak():
    """Two candidate ins with identical delta-xP — break ties by
    (out_id asc, in_id asc) so the output is reproducible."""
    squad = [_player(5, team=1, cost=80)]
    pool = [
        _player(20, team=2, cost=80),
        _player(15, team=2, cost=80),
        _player(30, team=2, cost=80),
    ]
    # All three deltas equal (in 6.0 - out 4.0 = 2.0).
    horizon_xps = {5: 4.0, 15: 6.0, 20: 6.0, 30: 6.0}
    result = suggest_transfers(squad, bank=0, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=3)
    assert [c.in_player_id for c in result] == [15, 20, 30]


def test_suggest_transfers_negative_delta_still_returned():
    """A 'downgrade' is rare but the algorithm doesn't filter — we surface
    every valid swap, even if delta < 0. Caller decides whether to act."""
    squad = [_player(1, team=1, cost=80)]
    pool = [_player(10, team=2, cost=80)]
    horizon_xps = {1: 9.0, 10: 5.0}
    result = suggest_transfers(squad, bank=0, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=10)
    assert len(result) == 1
    assert result[0].delta_xp == pytest.approx(-4.0)


def test_suggest_transfers_records_cost_change():
    squad = [_player(1, team=1, cost=80)]
    pool = [_player(10, team=2, cost=95)]
    horizon_xps = {1: 5.0, 10: 7.0}
    result = suggest_transfers(squad, bank=20, candidate_pool=pool,
                               horizon_xps=horizon_xps, top_n=10)
    assert result[0].cost_change == 15  # 95 - 80, in 0.1m units


def test_suggest_transfers_empty_pool_returns_empty():
    squad = [_player(1, team=1, cost=80)]
    assert suggest_transfers(squad, bank=10, candidate_pool=[],
                             horizon_xps={1: 5.0}, top_n=10) == []
