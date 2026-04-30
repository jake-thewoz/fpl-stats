from __future__ import annotations

import pytest

from compute import (
    HIT_COST_POINTS,
    MAX_BANKED_FREE_TRANSFERS,
    MAX_BUNDLE_SIZE,
    MAX_PLAYERS_PER_TEAM,
    TransferBundle,
    TransferCandidate,
    derive_free_transfers,
    is_valid_bundle,
    is_valid_swap,
    suggest_transfer_bundles,
    team_counts,
)
from schemas import EntryChip, EntryHistory, Player


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


def _hist(event: int, transfers: int = 0) -> EntryHistory:
    return EntryHistory(
        event=event, points=50, total_points=event * 50,
        event_transfers=transfers, event_transfers_cost=0,
    )


def _bundle_pairs(b: TransferBundle) -> list[tuple[int, int]]:
    return [(m.out_player_id, m.in_player_id) for m in b.moves]


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
# is_valid_bundle (multi-move constraint check)
# ---------------------------------------------------------------------------


def _move(out_id: int, in_id: int, *, delta: float = 1.0, cost_change: int = 0) -> TransferCandidate:
    return TransferCandidate(
        out_player_id=out_id,
        in_player_id=in_id,
        delta_xp=delta,
        cost_change=cost_change,
    )


class TestIsValidBundle:
    def test_size_one_bundle_within_budget_passes(self):
        out_p = _player(1, team=1, cost=80)
        in_p = _player(99, team=2, cost=80)
        moves = (_move(out_p.id, in_p.id, cost_change=0),)
        counts = team_counts([out_p])
        assert is_valid_bundle(
            moves, counts, bank=0, player_by_id={1: out_p, 99: in_p}
        )

    def test_combined_budget_busted_rejected(self):
        # Each swap individually fits (each costs 50 with bank 50), but
        # together the total is 100 > 50.
        squad = [_player(1, team=1, cost=50), _player(2, team=2, cost=50)]
        in_a = _player(10, team=3, cost=100)
        in_b = _player(11, team=4, cost=100)
        moves = (
            _move(1, 10, cost_change=50),
            _move(2, 11, cost_change=50),
        )
        by_id = {p.id: p for p in [*squad, in_a, in_b]}
        assert not is_valid_bundle(
            moves, team_counts(squad), bank=50, player_by_id=by_id
        )

    def test_combined_budget_with_one_downgrade_fits(self):
        # Sell expensive (frees 30), buy expensive (costs 25). Net swap A
        # is +25, net swap B is −30; bundle total cost = −5 (frees money).
        squad = [_player(1, team=1, cost=80), _player(2, team=2, cost=120)]
        in_a = _player(10, team=3, cost=105)  # +25
        in_b = _player(11, team=4, cost=90)   # −30
        moves = (
            _move(1, 10, cost_change=25),
            _move(2, 11, cost_change=-30),
        )
        by_id = {p.id: p for p in [*squad, in_a, in_b]}
        assert is_valid_bundle(
            moves, team_counts(squad), bank=0, player_by_id=by_id
        )

    def test_post_bundle_team_count_busted_rejected(self):
        # Squad has 2 from team 5. Both moves bring in players from team 5,
        # pushing post-bundle count to 4 > MAX_PLAYERS_PER_TEAM.
        squad = [
            _player(1, team=1),
            _player(2, team=2),
            _player(20, team=5),
            _player(21, team=5),
        ]
        in_a = _player(30, team=5, cost=80)
        in_b = _player(31, team=5, cost=80)
        moves = (_move(1, 30), _move(2, 31))
        by_id = {p.id: p for p in [*squad, in_a, in_b]}
        assert not is_valid_bundle(
            moves, team_counts(squad), bank=0, player_by_id=by_id
        )

    def test_post_bundle_team_count_at_limit_passes(self):
        # Squad has 1 from team 5. Both moves bring in team 5 players,
        # post-bundle count = 3 = limit.
        squad = [
            _player(1, team=1),
            _player(2, team=2),
            _player(20, team=5),
        ]
        in_a = _player(30, team=5)
        in_b = _player(31, team=5)
        moves = (_move(1, 30), _move(2, 31))
        by_id = {p.id: p for p in [*squad, in_a, in_b]}
        assert is_valid_bundle(
            moves, team_counts(squad), bank=0, player_by_id=by_id
        )

    def test_post_bundle_count_credits_outgoing_team(self):
        # Squad has 3 from team 5 already at the limit. One move sells a
        # team-5 player and brings in another team-5 player — the outgoing
        # frees a slot before the incoming uses it. Post-bundle count = 3.
        squad = [
            _player(1, team=1),
            _player(20, team=5),
            _player(21, team=5),
            _player(22, team=5),
        ]
        in_p = _player(30, team=5)
        moves = (_move(20, 30),)
        by_id = {p.id: p for p in [*squad, in_p]}
        assert is_valid_bundle(
            moves, team_counts(squad), bank=0, player_by_id=by_id
        )

    def test_duplicate_in_player_rejected(self):
        # Defensive: two slots can't bring in the same player.
        squad = [_player(1, team=1), _player(2, team=2)]
        in_p = _player(99, team=3)
        moves = (_move(1, 99), _move(2, 99))
        by_id = {p.id: p for p in [*squad, in_p]}
        assert not is_valid_bundle(
            moves, team_counts(squad), bank=0, player_by_id=by_id
        )


# ---------------------------------------------------------------------------
# derive_free_transfers (25/26 rules walk)
# ---------------------------------------------------------------------------


class TestDeriveFreeTransfers:
    def test_season_start_no_history_yields_one_ft(self):
        assert derive_free_transfers([], []) == 1

    def test_no_transfers_banks_up_to_cap(self):
        # 7 GWs with zero transfers should bank to the cap (5), not 8.
        history = [_hist(event=i) for i in range(1, 8)]
        assert derive_free_transfers(history, []) == MAX_BANKED_FREE_TRANSFERS

    def test_single_transfer_consumed_no_bank(self):
        # Start with 1 FT, GW1 uses it (transfers=1), rollover gives 1 more.
        history = [_hist(event=1, transfers=1)]
        assert derive_free_transfers(history, []) == 1

    def test_hit_doesnt_make_ft_negative(self):
        # GW1: ft=1, user takes 3 transfers (2 hits). Post-GW1 ft floor at 0,
        # rollover to 1.
        history = [_hist(event=1, transfers=3)]
        assert derive_free_transfers(history, []) == 1

    def test_wildcard_preserves_ft_and_skips_rollover(self):
        # GW1 and 2: bank to 3. GW3 uses Wildcard with 8 transfers — those
        # don't count against FT, AND the chip replaces the GW's +1 rollover.
        # Post-WC GW3: ft stays at 3 (no consumption, no rollover).
        history = [
            _hist(event=1, transfers=0),
            _hist(event=2, transfers=0),
            _hist(event=3, transfers=8),
        ]
        chips = [EntryChip(name="wildcard", event=3)]
        assert derive_free_transfers(history, chips) == 3

    def test_freehit_preserves_ft_and_skips_rollover(self):
        history = [
            _hist(event=1, transfers=0),
            _hist(event=2, transfers=0),
            _hist(event=3, transfers=11),  # FH: full team swap, doesn't consume FTs
        ]
        chips = [EntryChip(name="freehit", event=3)]
        assert derive_free_transfers(history, chips) == 3

    def test_triple_captain_doesnt_affect_ft(self):
        # 3xc (Triple Captain) is a scoring chip, not a transfer chip — it
        # doesn't preserve FTs. A normal transfer in a TC GW still consumes one.
        history = [
            _hist(event=1, transfers=0),
            _hist(event=2, transfers=1),  # TC GW with one normal transfer
        ]
        chips = [EntryChip(name="3xc", event=2)]
        # GW1: ft 1→2; GW2 (3xc has no FT exemption): ft 2-1=1, +1 rollover = 2
        assert derive_free_transfers(history, chips) == 2

    def test_unordered_history_walked_in_event_order(self):
        # FPL endpoint is event-ordered, but we tolerate scrambled input.
        history = [_hist(event=2, transfers=2), _hist(event=1, transfers=0)]
        # GW1: 1→2; GW2: 2-2=0, +1 rollover = 1
        assert derive_free_transfers(history, []) == 1

    def test_jakob_team_192273_through_gw34(self):
        """Regression: real history from Jakob's team (192273) walked
        through GW1-34. FPL UI showed 3 FTs going into GW35; an earlier
        version that applied +1 rollover on chip GWs gave 5. This test
        encodes the exact ``event_transfers`` + chip pattern so the
        chip-rollover rule can't silently regress without flipping it."""
        per_gw = [
            (1, 0), (2, 0), (3, 2), (4, 1), (5, 0),
            (6, 0),  # WC
            (7, 1), (8, 2), (9, 1), (10, 0), (11, 2), (12, 1), (13, 1),
            (14, 1), (15, 0), (16, 5), (17, 1), (18, 1), (19, 1),
            (20, 0), (21, 0), (22, 3), (23, 1), (24, 1), (25, 0),
            (26, 2),  # 3xc — scoring chip, FT mechanics unchanged
            (27, 1), (28, 0), (29, 0), (30, 0), (31, 3),
            (32, 0),  # WC
            (33, 0),
            (34, 0),  # FH
        ]
        history = [_hist(event=gw, transfers=t) for gw, t in per_gw]
        chips = [
            EntryChip(name="wildcard", event=6),
            EntryChip(name="3xc", event=26),
            EntryChip(name="wildcard", event=32),
            EntryChip(name="freehit", event=34),
        ]
        assert derive_free_transfers(history, chips) == 3


# ---------------------------------------------------------------------------
# suggest_transfer_bundles
# ---------------------------------------------------------------------------


class TestSuggestTransferBundlesSizeOne:
    """Behavioural tests on size-1 bundles — the 'old' single-transfer
    behaviour, exercised through the bundle API with free_transfers=1
    and max_transfers=1."""

    def test_ranks_by_delta_xp_descending(self):
        squad = [_player(1, team=1, cost=80), _player(2, team=1, cost=80)]
        pool = [
            _player(10, team=2, cost=80),
            _player(11, team=2, cost=80),
            _player(12, team=2, cost=80),
        ]
        horizon_xps = {1: 5.0, 2: 4.0, 10: 8.0, 11: 12.0, 12: 6.0}
        # Top deltas: in=11 - out=2 (12-4=8); in=11 - out=1 (12-5=7);
        # in=10 - out=2 (8-4=4); in=10 - out=1 (3); in=12 - out=2 (2); in=12 - out=1 (1)
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=1, top_n=10,
        )
        assert all(b.num_transfers == 1 for b in result)
        assert [_bundle_pairs(b)[0] for b in result] == [
            (2, 11), (1, 11), (2, 10), (1, 10), (2, 12), (1, 12),
        ]

    def test_top_n_truncates(self):
        # Realistic 15-player squad: 3 each across 5 teams (FPL's
        # 3-per-team rule). Pool has 20 players each on a distinct team
        # NOT in the squad, so every swap is team-count-valid.
        squad = [_player(i, team=((i - 1) // 3) + 1, cost=80) for i in range(1, 16)]
        pool = [_player(100 + i, team=10 + i, cost=80) for i in range(20)]
        horizon_xps = {**{i: float(i) for i in range(1, 16)},
                       **{100 + i: 100.0 - i for i in range(20)}}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=1, top_n=5,
        )
        assert len(result) == 5

    def test_skips_invalid_swaps(self):
        squad = [_player(1, team=1, position=3, cost=80)]
        pool = [
            _player(10, team=2, position=3, cost=200),  # over-budget
            _player(11, team=2, position=4, cost=80),   # wrong position
            _player(1, team=1, position=3, cost=80),    # in squad already
            _player(12, team=2, position=3, cost=80),   # the only valid one
        ]
        horizon_xps = {1: 4.0, 10: 9.0, 11: 9.0, 12: 6.0}
        result = suggest_transfer_bundles(
            squad, bank=10, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=1, top_n=10,
        )
        assert [_bundle_pairs(b)[0] for b in result] == [(1, 12)]

    def test_negative_delta_still_returned(self):
        squad = [_player(1, team=1, cost=80)]
        pool = [_player(10, team=2, cost=80)]
        horizon_xps = {1: 9.0, 10: 5.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=1, top_n=10,
        )
        assert len(result) == 1
        assert result[0].delta_xp_net == pytest.approx(-4.0)

    def test_records_cost_change(self):
        squad = [_player(1, team=1, cost=80)]
        pool = [_player(10, team=2, cost=95)]
        horizon_xps = {1: 5.0, 10: 7.0}
        result = suggest_transfer_bundles(
            squad, bank=20, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=1, top_n=10,
        )
        assert result[0].moves[0].cost_change == 15  # 95 - 80, in 0.1m units
        assert result[0].total_cost_change == 15

    def test_empty_pool_returns_empty(self):
        squad = [_player(1, team=1, cost=80)]
        result = suggest_transfer_bundles(
            squad, bank=10, candidate_pool=[],
            horizon_xps={1: 5.0}, free_transfers=1, max_transfers=1, top_n=10,
        )
        assert result == []


class TestSuggestTransferBundlesMultiMove:
    def test_two_move_bundle_with_two_free_transfers_no_hit(self):
        # Two squad slots, each with a strong replacement. With 2 FTs, the
        # 2-move bundle is hit-free and should rank first by net delta-xp
        # (gross 4+5=9 vs single 5).
        squad = [_player(1, team=1, cost=80), _player(2, team=2, cost=80)]
        pool = [_player(10, team=3, cost=80), _player(11, team=4, cost=80)]
        horizon_xps = {1: 3.0, 2: 3.0, 10: 7.0, 11: 8.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=2, max_transfers=2, top_n=5,
        )
        # Top result: bundle of [2→11 (5), 1→10 (4)] — gross 9, net 9.
        assert result[0].num_transfers == 2
        assert result[0].hit_cost == 0
        assert result[0].delta_xp_gross == pytest.approx(9.0)
        assert result[0].delta_xp_net == pytest.approx(9.0)

    def test_hit_cost_subtracted_when_transfers_exceed_free(self):
        # 1 FT available, max_transfers=2. Single best gross = 6; 2-move
        # gross = 11 (5 + 6); after −4 hit, 2-move net = 7 vs single net = 6.
        # 2-move wins by 1, demonstrating the FT/hit tradeoff is honoured.
        squad = [_player(1, team=1, cost=80), _player(2, team=2, cost=80)]
        pool = [_player(10, team=3, cost=80), _player(11, team=4, cost=80)]
        horizon_xps = {1: 2.0, 2: 2.0, 10: 8.0, 11: 7.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=2, top_n=10,
        )
        top = result[0]
        assert top.num_transfers == 2
        assert top.hit_cost == HIT_COST_POINTS
        assert top.delta_xp_gross == pytest.approx(11.0)
        assert top.delta_xp_net == pytest.approx(7.0)

    def test_single_transfer_wins_when_hit_eats_multi_gain(self):
        # 1 FT. Single best (gross 6, net 6). 2-move bundle (gross 8, net 4
        # after hit). Single should rank above 2-move.
        squad = [_player(1, team=1, cost=80), _player(2, team=2, cost=80)]
        pool = [_player(10, team=3, cost=80), _player(11, team=4, cost=80)]
        # in=10 minus out=1: 9-3=6 (single best); in=11 - out=2: 5-3=2.
        # 2-move bundle gross = 6+2 = 8, net = 4 (after −4 hit).
        horizon_xps = {1: 3.0, 2: 3.0, 10: 9.0, 11: 5.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=1, max_transfers=2, top_n=5,
        )
        top = result[0]
        assert top.num_transfers == 1
        assert top.delta_xp_net == pytest.approx(6.0)
        # And the 2-move bundle is also returned (lower-ranked).
        assert any(b.num_transfers == 2 for b in result)

    def test_free_transfers_above_size_does_not_inflate_net(self):
        # 3 FTs but the bundle only uses 1. hit_cost stays 0, net == gross.
        squad = [_player(1, team=1, cost=80)]
        pool = [_player(10, team=2, cost=80)]
        horizon_xps = {1: 4.0, 10: 9.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=3, max_transfers=1, top_n=5,
        )
        assert result[0].hit_cost == 0
        assert result[0].delta_xp_net == pytest.approx(5.0)

    def test_max_transfers_clamped_to_module_constant(self):
        # User asks for 99-move bundles; we cap at MAX_BUNDLE_SIZE=3 so the
        # combinatorial search stays bounded.
        squad = [_player(i, team=((i - 1) // 3) + 1, cost=80) for i in range(1, 16)]
        pool = [_player(100 + i, team=10 + i, cost=80) for i in range(5)]
        horizon_xps = {**{i: 1.0 for i in range(1, 16)},
                       **{100 + i: 5.0 for i in range(5)}}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps,
            free_transfers=15, max_transfers=99, top_n=20,
        )
        assert all(b.num_transfers <= MAX_BUNDLE_SIZE for b in result)

    def test_max_transfers_zero_or_negative_returns_empty(self):
        squad = [_player(1, team=1, cost=80)]
        pool = [_player(10, team=2, cost=80)]
        horizon_xps = {1: 4.0, 10: 9.0}
        assert suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps,
            free_transfers=1, max_transfers=0, top_n=5,
        ) == []

    def test_tiebreak_prefers_fewer_transfers_at_equal_net(self):
        # 2 FTs (no hit penalty for either size). Single-transfer best gross=4.
        # 2-move bundle gross 4+0=4 (second move is a wash). At equal net=4,
        # the 1-move bundle ranks first.
        squad = [_player(1, team=1, cost=80), _player(2, team=2, cost=80)]
        pool = [_player(10, team=3, cost=80), _player(11, team=4, cost=80)]
        horizon_xps = {1: 5.0, 2: 5.0, 10: 9.0, 11: 5.0}
        result = suggest_transfer_bundles(
            squad, bank=0, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=2, max_transfers=2, top_n=5,
        )
        # Top should be [1→10 alone] (net 4, 1 transfer) rather than
        # [1→10, 2→11] (net 4, 2 transfers).
        assert result[0].num_transfers == 1
        assert result[0].moves[0].in_player_id == 10

    def test_combined_budget_blocks_two_expensive_swaps(self):
        # Each move individually fits, but combined cost exceeds the bank.
        squad = [_player(1, team=1, cost=50), _player(2, team=2, cost=50)]
        pool = [_player(10, team=3, cost=100), _player(11, team=4, cost=100)]
        horizon_xps = {1: 1.0, 2: 1.0, 10: 9.0, 11: 9.0}
        result = suggest_transfer_bundles(
            squad, bank=50, candidate_pool=pool,
            horizon_xps=horizon_xps, free_transfers=2, max_transfers=2, top_n=5,
        )
        # No 2-move bundle should appear (combined cost 100 > 50). Single
        # moves are fine (each fits the bank).
        assert all(b.num_transfers == 1 for b in result)

    def test_max_transfers_three_completes_on_realistic_squad(self):
        """Regression: ``max_transfers=3`` on a realistic 15-player squad
        used to time the Lambda out (~30s) because the cartesian product
        is 15C3 × 25^3 ≈ 7M combinations. The branch-and-bound prune in
        ``suggest_transfer_bundles`` collapses this to <1s by skipping
        slot subsets whose theoretical-best gross can't beat the current
        top-N threshold. Pytest will hang past the session timeout if
        the prune ever regresses."""
        # 15-player squad: realistic FPL shape (2 GKP / 5 DEF / 5 MID /
        # 3 FWD), 3 per team across 5 teams.
        positions = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4]
        squad = [
            _player(i + 1, team=(i % 5) + 1, position=pos, cost=80)
            for i, pos in enumerate(positions)
        ]
        # Pool: 240 players spread across 20 different teams + 4 positions.
        pool: list[Player] = []
        pid = 1000
        for team in range(6, 26):
            for pos in range(1, 5):
                for _ in range(3):
                    pool.append(_player(pid, team=team, position=pos, cost=80))
                    pid += 1

        # Squad on low xP, pool on high xP — guarantees multi-move bundles
        # actually win, exercising the full search path rather than getting
        # entirely pruned by the slot-subset upper bound.
        horizon_xps = {p.id: 1.0 for p in squad}
        horizon_xps.update({p.id: 6.0 for p in pool})

        bundles = suggest_transfer_bundles(
            squad=squad, bank=200, candidate_pool=pool,
            horizon_xps=horizon_xps,
            free_transfers=1, max_transfers=3, top_n=10,
        )
        # Verify the multi-move logic was exercised (top should be a
        # 3-move bundle: gross 3×5 = 15, hit 2×4 = 8, net 7 — beats any
        # 1-move bundle's net of 5).
        assert bundles[0].num_transfers == 3
        assert bundles[0].hit_cost == 2 * HIT_COST_POINTS
        assert bundles[0].delta_xp_net == pytest.approx(7.0)
