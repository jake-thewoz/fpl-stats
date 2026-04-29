"""Pure computation for the transfer-suggestion read endpoint.

Side-effect-free so candidate generation, constraint checking, and
ranking can be unit-tested with hand-built squads and player pools per
the issue's AC. The handler wires these against DDB I/O and HTTP.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations, product
from typing import Iterable

from schemas import EntryChip, EntryHistory, Player

# FPL squad rule: max 3 players from any one Premier League team.
MAX_PLAYERS_PER_TEAM = 3

# 25/26 banked-FT cap. Rule change from prior seasons (was 2). Source: FPL
# rules update for 2025/26. If FPL changes the cap again, this constant is
# the only place to update.
MAX_BANKED_FREE_TRANSFERS = 5

# Hit cost per extra transfer (FPL: −4 points per transfer beyond your free count).
HIT_COST_POINTS = 4

# Hard ceiling on bundle size we'll consider. 4+ transfers means −12+ pts in
# hits, almost never net-positive even on big swings; the combinatorial
# space also blows up. Handler clamps user input (``max_transfers`` query
# param) to this.
MAX_BUNDLE_SIZE = 3

# Per-squad-slot top-K replacement candidates retained for bundle assembly.
# Bundle search enumerates combinations across slots, so total work scales
# as (squad_size choose k) × K^k. With squad=15, K=25, k=3 → ~7M combos —
# fits within the 5s Lambda budget. Larger K rarely changes top-N output:
# the optimal multi-move bundle almost always uses each slot's top few moves.
PER_SLOT_TOP_K = 25


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


@dataclass(frozen=True)
class TransferBundle:
    """A set of one or more out->in moves applied together as one
    transfer decision.

    ``hit_cost`` is the points penalty for transfers beyond the user's
    free count: ``max(0, num_transfers − free_transfers) × 4``.
    ``delta_xp_net`` = sum(move.delta_xp) − hit_cost — the actual net
    points value of executing the bundle. Sorted output uses ``delta_xp_net``;
    a 2-move bundle that requires a hit only ranks higher than a 1-move
    free bundle when its gross gain outweighs the −4.
    """

    moves: tuple[TransferCandidate, ...]
    hit_cost: int
    delta_xp_net: float

    @property
    def num_transfers(self) -> int:
        return len(self.moves)

    @property
    def delta_xp_gross(self) -> float:
        return sum(m.delta_xp for m in self.moves)

    @property
    def total_cost_change(self) -> int:
        return sum(m.cost_change for m in self.moves)


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


def is_valid_bundle(
    moves: tuple[TransferCandidate, ...],
    counts: dict[int, int],
    bank: int,
    player_by_id: dict[int, Player],
) -> bool:
    """Apply FPL's hard constraints across a multi-move bundle.

    ``is_valid_swap`` checks one swap in isolation; a bundle of two
    individually-valid swaps can still bust budget or the 3-per-team
    rule when applied together (e.g. each swap brings in a player from
    team 5, pushing the post-bundle count to 4). This function applies
    all moves to a simulated post-bundle state.

    Same-position-per-pair is enforced earlier (per-slot move generation
    only proposes same-position replacements), so we don't re-check here.

    Defensive: rejects bundles with duplicate in- or out-player ids,
    even though combination-based generation shouldn't produce them.
    """
    out_ids = [m.out_player_id for m in moves]
    if len(set(out_ids)) != len(out_ids):
        return False
    in_ids = [m.in_player_id for m in moves]
    if len(set(in_ids)) != len(in_ids):
        return False

    if sum(m.cost_change for m in moves) > bank:
        return False

    # Simulate team-count deltas across all moves.
    new_counts = dict(counts)
    for m in moves:
        out_p = player_by_id[m.out_player_id]
        in_p = player_by_id[m.in_player_id]
        new_counts[out_p.team] = new_counts.get(out_p.team, 0) - 1
        new_counts[in_p.team] = new_counts.get(in_p.team, 0) + 1
    return all(c <= MAX_PLAYERS_PER_TEAM for c in new_counts.values())


def derive_free_transfers(
    history_current: Iterable[EntryHistory],
    chips: Iterable[EntryChip],
) -> int:
    """Walk a season's per-GW history to derive the FT count going INTO
    the next GW.

    25/26 rules applied:

    - Each completed GW deadline rolls over: ``ft = min(5, ft + 1)``.
    - Transfers within a GW consume FTs down to 0 (extras are −4 hits,
      tracked in ``event_transfers_cost``; we don't double-count them
      here because the FT walk only cares about FT consumption, and FTs
      can't go below 0).
    - Wildcard / Free Hit GWs do NOT consume FTs (the chip itself replaces
      normal transfer activity). Rollover still applies.
    - Triple Captain / Bench Boost don't affect FTs at all (pure scoring
      multipliers, no transfer impact), so they're ignored by this walk.

    Starting balance: 1 FT (FPL convention for season start).

    Caveat (not handled here): transfers made *during* the current GW
    lead-up but not yet visible in history. ``last_deadline_total_transfers``
    on the Entry could disambiguate, but this function intentionally stays
    pure; the handler is the right place to apply that correction if it
    proves necessary in practice.
    """
    chip_by_event = {c.event: c.name for c in chips}
    ft = 1
    for entry in sorted(history_current, key=lambda h: h.event):
        chip = chip_by_event.get(entry.event)
        if chip not in ("wildcard", "freehit"):
            transfers_made = entry.event_transfers or 0
            ft = max(0, ft - transfers_made)
        ft = min(MAX_BANKED_FREE_TRANSFERS, ft + 1)
    return ft


def _per_slot_top_k_moves(
    *,
    squad: list[Player],
    candidate_pool: Iterable[Player],
    squad_ids: set[int],
    horizon_xps: dict[int, float],
    k: int,
) -> list[list[TransferCandidate]]:
    """For each squad slot, the top-K replacement candidates ranked by
    gross delta-xp. Bank and team-count constraints are NOT applied here
    — they're bundle-level concerns checked later, since a single
    expensive swap might be valid only in combination with a cheaper
    sell elsewhere in the same bundle."""
    pool = list(candidate_pool)
    per_slot: list[list[TransferCandidate]] = []
    for out_p in squad:
        moves: list[TransferCandidate] = []
        out_xp = horizon_xps.get(out_p.id, 0.0)
        for in_p in pool:
            if in_p.id == out_p.id:
                continue
            if in_p.id in squad_ids:
                continue
            if in_p.element_type != out_p.element_type:
                continue
            delta = horizon_xps.get(in_p.id, 0.0) - out_xp
            moves.append(
                TransferCandidate(
                    out_player_id=out_p.id,
                    in_player_id=in_p.id,
                    delta_xp=delta,
                    cost_change=in_p.now_cost - out_p.now_cost,
                )
            )
        moves.sort(key=lambda m: (-m.delta_xp, m.in_player_id))
        per_slot.append(moves[:k])
    return per_slot


def suggest_transfer_bundles(
    squad: list[Player],
    bank: int,
    candidate_pool: Iterable[Player],
    horizon_xps: dict[int, float],
    free_transfers: int,
    max_transfers: int,
    top_n: int,
) -> list[TransferBundle]:
    """Generate, filter, and rank multi-transfer bundles by net delta-xp.

    For each bundle size 1..``max_transfers``: enumerate every combination
    of squad slots, then for each slot pick from its per-slot top-K
    replacement candidates (cartesian product). Apply bundle-level
    constraints (combined budget, post-bundle team counts, no overlapping
    in-players). Score each valid bundle by gross delta-xp minus the FT-aware
    hit cost; rank descending.

    Per-slot top-K (``PER_SLOT_TOP_K``) is the throttle that keeps this
    tractable. The optimal multi-move bundle almost always uses each
    slot's top few moves; widening K beyond ~25 rarely changes top-N
    output but multiplies work geometrically.

    ``max_transfers`` is clamped to ``MAX_BUNDLE_SIZE``. Beyond 3 transfers
    the hit cost (≥−12 pts) eats almost all upside.

    Tiebreaker by num_transfers ascending (prefer fewer moves at equal
    net) and by player_id sequence (stable across runs).
    """
    if max_transfers < 1:
        return []
    capped_max = min(max_transfers, MAX_BUNDLE_SIZE)

    squad_ids = {p.id for p in squad}
    counts = team_counts(squad)
    per_slot_moves = _per_slot_top_k_moves(
        squad=squad,
        candidate_pool=candidate_pool,
        squad_ids=squad_ids,
        horizon_xps=horizon_xps,
        k=PER_SLOT_TOP_K,
    )

    # Lookup for is_valid_bundle's team-count simulation. Includes both
    # squad and pool members so any move's player resolves.
    player_by_id: dict[int, Player] = {p.id: p for p in squad}
    for p in candidate_pool:
        player_by_id[p.id] = p

    bundles: list[TransferBundle] = []
    for size in range(1, capped_max + 1):
        hit_cost = max(0, size - free_transfers) * HIT_COST_POINTS
        for slot_indices in combinations(range(len(squad)), size):
            slot_options = [per_slot_moves[i] for i in slot_indices]
            if any(not opts for opts in slot_options):
                continue
            for move_combo in product(*slot_options):
                if not is_valid_bundle(move_combo, counts, bank, player_by_id):
                    continue
                gross = sum(m.delta_xp for m in move_combo)
                bundles.append(
                    TransferBundle(
                        moves=move_combo,
                        hit_cost=hit_cost,
                        delta_xp_net=gross - hit_cost,
                    )
                )

    bundles.sort(
        key=lambda b: (
            -b.delta_xp_net,
            b.num_transfers,
            tuple((m.out_player_id, m.in_player_id) for m in b.moves),
        )
    )
    return bundles[:top_n]
