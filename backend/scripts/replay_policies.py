"""Transfer policies for the season replay: given the squad, bank, saved
free transfers and this week's scores, which transfers to make.

``one_a_week``, ``UseBanked`` and ``AllowHits`` use production's
``suggest_transfer_bundles``, with the same shortlist as the app: each
position's 25 best upgrades plus the best few each slot can afford. ``Planner`` plans several weeks at
once with ``transfer_planner.py`` and makes only this week's moves.
"""
from __future__ import annotations

from dataclasses import dataclass

from compute import MAX_BANKED_FREE_TRANSFERS, TransferBundle, suggest_transfer_bundles
from season_replay import Scorer, Transfer, TransferState, archive_player, buyable_players
from transfer_planner import PlanSettings, PlayerOption, pair_moves, plan_transfers

ONE_A_WEEK = "one_a_week"
USE_BANKED = "use_banked"
ALLOW_HITS = "allow_hits"
PLANNER = "planner"
DEFAULT_PLANNER_HORIZON = 5

# Predicted points, over the scoring horizon, that a transfer must gain
# before a saving policy spends it. Below this the transfer is kept.
DEFAULT_MIN_GAIN_PER_TRANSFER = 2.0
ANY_GAIN = 0.0
HIT_TRANSFERS_ALLOWED = 1


def one_a_week(state: TransferState) -> tuple[Transfer, ...]:
    """One transfer every week if it gains anything: never saves, never
    takes a hit. The baseline the replay started with."""
    return _best_moves(state, free_transfers=1, max_transfers=1, min_gain_per_transfer=ANY_GAIN)


@dataclass(frozen=True)
class UseBanked:
    """Spends saved transfers only on moves that each gain at least
    ``min_gain_per_transfer``, so transfers build up for when they are
    worth more. Never takes a hit."""

    min_gain_per_transfer: float = DEFAULT_MIN_GAIN_PER_TRANSFER

    def __call__(self, state: TransferState) -> tuple[Transfer, ...]:
        moves = _best_moves(
            state, free_transfers=state.free_transfers, max_transfers=state.free_transfers,
            min_gain_per_transfer=self.min_gain_per_transfer,
        )
        return moves or _use_it_or_lose_it(state)


@dataclass(frozen=True)
class AllowHits:
    """``UseBanked`` plus one extra transfer when its gain also covers
    the 4-point hit."""

    min_gain_per_transfer: float = DEFAULT_MIN_GAIN_PER_TRANSFER

    def __call__(self, state: TransferState) -> tuple[Transfer, ...]:
        moves = _best_moves(
            state, free_transfers=state.free_transfers,
            max_transfers=state.free_transfers + HIT_TRANSFERS_ALLOWED,
            min_gain_per_transfer=self.min_gain_per_transfer,
        )
        return moves or _use_it_or_lose_it(state)


@dataclass(frozen=True)
class Planner:
    """Plans ``horizon`` weeks ahead and makes this week's moves. It asks
    ``scorer`` for its own horizon, so the replay's starting squad and
    line-ups stay the same as every other policy's."""

    scorer: Scorer
    settings: PlanSettings
    horizon: int = DEFAULT_PLANNER_HORIZON

    def __call__(self, state: TransferState) -> tuple[Transfer, ...]:
        season, gameweek = state.season, state.gameweek
        scores = self.scorer(season, gameweek, self.horizon)
        weeks = range(gameweek, gameweek + self.horizon)
        options = []
        for player_id in sorted(set(buyable_players(season, gameweek)) | state.squad):
            player = archive_player(season, player_id, gameweek)
            options.append(PlayerOption(
                player_id=player_id,
                position=player.element_type,
                club=player.team,
                price=player.now_cost,
                sell_price=(state.squad_player(player_id).now_cost
                            if player_id in state.squad else player.now_cost),
                points_by_week=tuple(scores.get(player_id, {}).get(week, 0.0) for week in weeks),
            ))
        plan = plan_transfers(options=options, squad=state.squad, bank=state.bank,
                              free_transfers=state.free_transfers, settings=self.settings)
        horizon_points = {o.player_id: sum(o.points_by_week) for o in options}
        return tuple(
            Transfer(out_id, in_id, horizon_points[in_id] - horizon_points[out_id])
            for out_id, in_id in pair_moves(plan.weeks[0], season.position_by_player)
        )


def _use_it_or_lose_it(state: TransferState) -> tuple[Transfer, ...]:
    """At the cap the next free transfer would be wasted, so one move
    is worth making at any gain."""
    if state.free_transfers < MAX_BANKED_FREE_TRANSFERS:
        return ()
    return _best_moves(state, free_transfers=1, max_transfers=1, min_gain_per_transfer=ANY_GAIN)


def _best_moves(
    state: TransferState, *, free_transfers: int, max_transfers: int,
    min_gain_per_transfer: float,
) -> tuple[Transfer, ...]:
    """The bundle maximising gain − hits − ``min_gain_per_transfer`` per
    move, or nothing if that is not above zero.

    Lowering every non-squad player's score by the minimum gain lowers
    every move's gain by exactly that much, so the production search
    applies the threshold itself, jointly with budget and hits."""
    season, gameweek = state.season, state.gameweek
    horizon_scores = {
        player_id: sum(by_gameweek.values())
        - (0.0 if player_id in state.squad else min_gain_per_transfer)
        for player_id, by_gameweek in state.scores.items()
    }
    # Squad players stay out of the pool, which would otherwise shadow
    # their selling price with their price.
    pool = [p for p in buyable_players(season, gameweek) if p not in state.squad]
    for player_id in pool:
        if player_id not in horizon_scores:
            horizon_scores[player_id] = -min_gain_per_transfer
    bundles: list[TransferBundle] = suggest_transfer_bundles(
        squad=[state.squad_player(p) for p in sorted(state.squad)],
        bank=state.bank,
        candidate_pool=[archive_player(season, p, gameweek) for p in pool],
        horizon_xps=horizon_scores,
        free_transfers=free_transfers,
        max_transfers=max_transfers,
        top_n=1,
    )
    if not bundles or bundles[0].delta_xp_net <= 0:
        return ()
    return tuple(
        Transfer(move.out_player_id, move.in_player_id, move.delta_xp + min_gain_per_transfer)
        for move in bundles[0].moves
    )
