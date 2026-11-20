"""Season replay: a simulated manager plays a past season one gameweek
at a time, seeing only the past, and we count the FPL points it scores.

Pure: ``replay_season.py`` does the loading and writing. Strategies
differ only in their scorer (``replay_strategies.py``); the squad,
transfer, line-up and scoring rules here are shared by all of them.

Transfers follow FPL's rules: one free transfer arrives each gameweek,
unused ones are saved up to five, and every transfer beyond the saved
count costs 4 points. *Which* transfers to make is the transfer policy's
choice (``replay_policies.py``); the replay only checks they are legal.

Money follows FPL's rules too: a player is bought at that round's price
and sold at his selling price, which keeps only half of any rise since
he was bought (``selling_price``).

Simplifications:

- No chips.
- No injury news: scorers only see past minutes.
- The replay starts at gameweek 5, so totals cover GW5 to the end.
- No vice-captain: if the captain doesn't play, nobody is doubled.

"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import product
from typing import Callable, Protocol

from compute import HIT_COST_POINTS, MAX_BANKED_FREE_TRANSFERS, MAX_PLAYERS_PER_TEAM
from schemas import Player
from season_data import SeasonData
from squad_optimizer import DEFAULT_BENCH_WEIGHT, Candidate, SquadRules, optimize_squad
from xp_v2 import GKP

START_GAMEWEEK = 5
STARTING_BUDGET_TENTHS = 1000
SCORING_HORIZON = 3
FREE_TRANSFERS_GAINED_PER_WEEK = 1
CAPTAIN_MULTIPLIER = 2
# A sale keeps 1 / SELL_ON_PROFIT_DIVISOR of a price rise; a fall is taken in full.
SELL_ON_PROFIT_DIVISOR = 2
# Player fields the transfer search never reads; archive players have no
# live equivalents, so these fill the required schema slots.
_UNUSED_PLAYER_TEXT = ""
_UNUSED_PLAYER_NUMBER = 0

Scores = dict[int, dict[int, float]]


class Scorer(Protocol):
    def __call__(self, season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
        """player_id -> {gameweek -> score} for as_of_gw .. as_of_gw + horizon - 1,
        using only what was known before as_of_gw."""
        ...


@dataclass(frozen=True)
class Transfer:
    out_player_id: int
    in_player_id: int
    expected_gain: float


@dataclass(frozen=True)
class TransferState:
    """What a transfer policy sees just before a gameweek's deadline.
    Money is in tenths of £1m, as in FPL's API."""

    season: SeasonData
    gameweek: int
    purchase_price_by_player: dict[int, int]
    bank: int
    free_transfers: int
    scores: Scores

    @property
    def squad(self) -> frozenset[int]:
        return frozenset(self.purchase_price_by_player)

    def squad_player(self, player_id: int) -> Player:
        """A squad player as the transfer search should see him: priced
        at what selling him would raise."""
        return sold_player(self.season, player_id, self.gameweek,
                           self.purchase_price_by_player[player_id])


TransferPolicy = Callable[[TransferState], tuple[Transfer, ...]]


class IllegalTransfer(Exception):
    """A policy asked for a move FPL would not allow."""


@dataclass(frozen=True)
class ReplayConfig:
    """``transfer_policy=None`` keeps the starting squad all season."""

    transfer_policy: TransferPolicy | None = None
    start_gameweek: int = START_GAMEWEEK
    budget_tenths: int = STARTING_BUDGET_TENTHS
    horizon: int = SCORING_HORIZON
    bench_weight: float = DEFAULT_BENCH_WEIGHT
    rules: SquadRules = field(
        default_factory=lambda: SquadRules(max_players_per_team=MAX_PLAYERS_PER_TEAM)
    )


@dataclass(frozen=True)
class Lineup:
    starters: tuple[int, ...]
    bench: tuple[int, ...]
    captain: int


@dataclass(frozen=True)
class GameweekResult:
    """``points`` is net of ``hit_points``. ``bank`` and ``team_value``
    (squad selling value + bank) are in tenths of £1m, after the week's
    transfers."""

    gameweek: int
    points: int
    captain_bonus: int
    automatic_substitutions: int
    transfers: tuple[Transfer, ...]
    hit_points: int
    free_transfers_after: int
    bank: int
    team_value: int


@dataclass(frozen=True)
class ReplayResult:
    gameweeks: tuple[GameweekResult, ...]

    @property
    def total_points(self) -> int:
        return sum(week.points for week in self.gameweeks)

    @property
    def captain_bonus(self) -> int:
        return sum(week.captain_bonus for week in self.gameweeks)

    @property
    def transfers_made(self) -> int:
        return sum(len(week.transfers) for week in self.gameweeks)

    @property
    def hit_points(self) -> int:
        return sum(week.hit_points for week in self.gameweeks)

    @property
    def free_transfers_at_end(self) -> int:
        return self.gameweeks[-1].free_transfers_after

    @property
    def team_value_at_start(self) -> int:
        return self.gameweeks[0].team_value

    @property
    def team_value_at_middle(self) -> int:
        return self.gameweeks[len(self.gameweeks) // 2].team_value

    @property
    def team_value_at_end(self) -> int:
        return self.gameweeks[-1].team_value


@dataclass(frozen=True)
class _ActualOutcomes:
    points_by_player_round: dict[tuple[int, int], int]
    minutes_by_player_round: dict[tuple[int, int], int]

    @classmethod
    def of(cls, season: SeasonData) -> _ActualOutcomes:
        points: dict[tuple[int, int], int] = defaultdict(int)
        minutes: dict[tuple[int, int], int] = defaultdict(int)
        for row in season.rows:
            points[(row.element, row.round)] += row.total_points
            minutes[(row.element, row.round)] += row.minutes
        return cls(dict(points), dict(minutes))


def run_replay(season: SeasonData, scorer: Scorer, config: ReplayConfig) -> ReplayResult:
    outcomes = _ActualOutcomes.of(season)
    last_gameweek = max(row.round for row in season.rows)

    scores = scorer(season, config.start_gameweek, config.horizon)
    purchase_prices, bank = _initial_squad(season, scores, config)

    # Building the squad is not a transfer; its deadline grants the first free one.
    free_transfers = 0
    weeks: list[GameweekResult] = []
    for gameweek in range(config.start_gameweek, last_gameweek + 1):
        transfers: tuple[Transfer, ...] = ()
        hit_points = 0
        if gameweek > config.start_gameweek:
            scores = scorer(season, gameweek, config.horizon)
            if config.transfer_policy is not None:
                state = TransferState(season, gameweek, purchase_prices, bank,
                                      free_transfers, scores)
                transfers = tuple(config.transfer_policy(state))
                purchase_prices, bank = apply_transfers(state, transfers, config.rules)
                hit_points = max(0, len(transfers) - free_transfers) * HIT_COST_POINTS
                free_transfers = max(0, free_transfers - len(transfers))
        free_transfers = min(
            MAX_BANKED_FREE_TRANSFERS, free_transfers + FREE_TRANSFERS_GAINED_PER_WEEK,
        )
        squad = frozenset(purchase_prices)
        lineup = pick_lineup(
            squad=squad,
            score_by_player={p: scores.get(p, {}).get(gameweek, 0.0) for p in squad},
            position_by_player=season.position_by_player,
            rules=config.rules,
        )
        points, captain_bonus, substitutions = score_gameweek(
            lineup=lineup,
            points_by_player={p: outcomes.points_by_player_round.get((p, gameweek), 0) for p in squad},
            minutes_by_player={p: outcomes.minutes_by_player_round.get((p, gameweek), 0) for p in squad},
            position_by_player=season.position_by_player,
            rules=config.rules,
        )
        weeks.append(GameweekResult(
            gameweek=gameweek, points=points - hit_points, captain_bonus=captain_bonus,
            automatic_substitutions=substitutions, transfers=transfers,
            hit_points=hit_points, free_transfers_after=free_transfers,
            bank=bank, team_value=bank + squad_selling_value(season, purchase_prices, gameweek),
        ))
    return ReplayResult(gameweeks=tuple(weeks))


def pick_lineup(
    *,
    squad: frozenset[int] | set[int],
    score_by_player: dict[int, float],
    position_by_player: dict[int, int],
    rules: SquadRules,
) -> Lineup:
    """Best legal XI by score, captain = top scorer in it, bench with the
    keeper first then outfielders best first. Same rules as the app's
    ``mobile/src/screens/MyTeam/suggestLineup.ts``: within a fixed
    formation, the top N per position is optimal, so trying every legal
    formation is exact. Ties go to the lower player id."""
    def preference(player_id: int) -> tuple[float, int]:
        return (-score_by_player.get(player_id, 0.0), player_id)

    ranked_by_position = {
        position: sorted((p for p in squad if position_by_player[p] == position), key=preference)
        for position in rules.squad_size_by_position
    }
    best_starters: list[int] | None = None
    best_total = float("-inf")
    for formation in _legal_formations(rules):
        if any(len(ranked_by_position[pos]) < count for pos, count in formation.items()):
            continue
        starters = [p for pos, count in formation.items() for p in ranked_by_position[pos][:count]]
        total = sum(score_by_player.get(p, 0.0) for p in starters)
        if total > best_total:
            best_starters, best_total = starters, total
    if best_starters is None:
        raise ValueError(f"Squad {sorted(squad)} cannot field a legal XI")

    starter_ids = set(best_starters)
    bench_players = [p for p in squad if p not in starter_ids]
    bench = (
        sorted((p for p in bench_players if position_by_player[p] == GKP), key=preference)
        + sorted((p for p in bench_players if position_by_player[p] != GKP), key=preference)
    )
    return Lineup(
        starters=tuple(sorted(best_starters, key=preference)),
        bench=tuple(bench),
        captain=min(best_starters, key=preference),
    )


def score_gameweek(
    *,
    lineup: Lineup,
    points_by_player: dict[int, int],
    minutes_by_player: dict[int, int],
    position_by_player: dict[int, int],
    rules: SquadRules,
) -> tuple[int, int, int]:
    """(points, captain bonus, automatic substitutions) for the week.

    A starter with 0 minutes is replaced by the first bench player, in
    bench order, who played and keeps the formation legal. The captain
    counts double only if he played."""
    starters = list(lineup.starters)
    unused_bench = list(lineup.bench)
    substitutions = 0
    for index, starter in enumerate(lineup.starters):
        if minutes_by_player.get(starter, 0) > 0:
            continue
        for substitute in unused_bench:
            if minutes_by_player.get(substitute, 0) == 0:
                continue
            trial = starters[:index] + [substitute] + starters[index + 1:]
            if _is_legal_formation(trial, position_by_player, rules):
                starters = trial
                unused_bench.remove(substitute)
                substitutions += 1
                break

    points = sum(points_by_player.get(p, 0) for p in starters)
    captain_bonus = 0
    if minutes_by_player.get(lineup.captain, 0) > 0:
        captain_bonus = points_by_player.get(lineup.captain, 0) * (CAPTAIN_MULTIPLIER - 1)
    return points + captain_bonus, captain_bonus, substitutions


def archive_player(season: SeasonData, player_id: int, gameweek: int) -> Player:
    """The player as the transfer search sees him at ``gameweek``: club
    and price from his latest round up to then."""
    return Player(
        id=player_id,
        first_name=_UNUSED_PLAYER_TEXT,
        second_name=_UNUSED_PLAYER_TEXT,
        web_name=season.name_by_player.get(player_id, _UNUSED_PLAYER_TEXT),
        team=_latest_at_or_before(season.team_by_player_round, player_id, gameweek),
        element_type=season.position_by_player[player_id],
        total_points=_UNUSED_PLAYER_NUMBER,
        form=_UNUSED_PLAYER_TEXT,
        now_cost=_latest_at_or_before(season.value_by_player_round, player_id, gameweek),
    )


def selling_price(purchase_price: int, current_price: int) -> int:
    """What FPL pays for a player bought at ``purchase_price``: half of
    any rise, rounded down to £0.1m; a fall in full."""
    if current_price <= purchase_price:
        return current_price
    return purchase_price + (current_price - purchase_price) // SELL_ON_PROFIT_DIVISOR


def sold_player(season: SeasonData, player_id: int, gameweek: int, purchase_price: int) -> Player:
    """``archive_player`` priced at his selling price rather than his price."""
    player = archive_player(season, player_id, gameweek)
    return player.model_copy(update={"now_cost": selling_price(purchase_price, player.now_cost)})


def squad_selling_value(season: SeasonData, purchase_price_by_player: dict[int, int],
                        gameweek: int) -> int:
    return sum(
        sold_player(season, player_id, gameweek, purchase_price).now_cost
        for player_id, purchase_price in purchase_price_by_player.items()
    )


def _initial_squad(
    season: SeasonData, scores: Scores, config: ReplayConfig,
) -> tuple[dict[int, int], int]:
    gameweek = config.start_gameweek
    candidates = [
        Candidate(
            player_id=player_id,
            web_name=season.name_by_player.get(player_id, _UNUSED_PLAYER_TEXT),
            team_id=season.team_by_player_round[(player_id, gameweek)],
            position=season.position_by_player[player_id],
            cost_tenths=season.value_by_player_round[(player_id, gameweek)],
            horizon_xp=sum(scores.get(player_id, {}).values()),
            next_gw_xp=scores.get(player_id, {}).get(gameweek, 0.0),
        )
        for player_id in buyable_players(season, gameweek)
    ]
    squad = optimize_squad(
        candidates=candidates, budget_tenths=config.budget_tenths,
        rules=config.rules, bench_weight=config.bench_weight,
    )
    return (
        {player.player_id: player.cost_tenths for player in squad.squad},
        config.budget_tenths - squad.total_cost_tenths,
    )


def apply_transfers(
    state: TransferState, transfers: tuple[Transfer, ...], rules: SquadRules,
) -> tuple[dict[int, int], int]:
    """The squad's purchase prices and the bank after ``transfers``, or
    ``IllegalTransfer``.

    Buys at the gameweek's price and sells at the selling price. Budget
    and the club limit are checked once all moves are made, so one sale
    can fund another buy."""
    season, gameweek = state.season, state.gameweek
    purchase_prices = dict(state.purchase_price_by_player)
    bank = state.bank
    buyable = set(buyable_players(season, gameweek))
    for transfer in transfers:
        sold, bought = transfer.out_player_id, transfer.in_player_id
        if sold not in purchase_prices:
            raise IllegalTransfer(f"GW{gameweek}: player {sold} is not in the squad")
        if bought in purchase_prices or bought not in buyable:
            raise IllegalTransfer(f"GW{gameweek}: player {bought} cannot be bought")
        if season.position_by_player[sold] != season.position_by_player[bought]:
            raise IllegalTransfer(f"GW{gameweek}: {sold} -> {bought} changes position")
        price = archive_player(season, bought, gameweek).now_cost
        bank += sold_player(season, sold, gameweek, purchase_prices.pop(sold)).now_cost - price
        purchase_prices[bought] = price
    if bank < 0:
        raise IllegalTransfer(f"GW{gameweek}: transfers overspend by {-bank}")
    players_by_club: dict[int, int] = defaultdict(int)
    for player_id in purchase_prices:
        players_by_club[archive_player(season, player_id, gameweek).team] += 1
    # Only clubs bought into are checked: a squad player's real-life move
    # can leave four from one club, which FPL lets a manager keep.
    for transfer in transfers:
        club = archive_player(season, transfer.in_player_id, gameweek).team
        if players_by_club[club] > rules.max_players_per_team:
            raise IllegalTransfer(f"GW{gameweek}: too many players from club {club}")
    return purchase_prices, bank


def buyable_players(season: SeasonData, gameweek: int) -> list[int]:
    """Players with a price this round, i.e. registered and in the game."""
    return sorted(
        player_id for (player_id, round_number) in season.value_by_player_round
        if round_number == gameweek and player_id in season.position_by_player
    )


def _latest_at_or_before(by_player_round: dict[tuple[int, int], int], player_id: int,
                         gameweek: int) -> int:
    for round_number in range(gameweek, 0, -1):
        if (player_id, round_number) in by_player_round:
            return by_player_round[(player_id, round_number)]
    raise KeyError(f"No value for player {player_id} up to round {gameweek}")


def _legal_formations(rules: SquadRules) -> list[dict[int, int]]:
    positions = list(rules.squad_size_by_position)
    ranges = [
        range(
            rules.min_starters_by_position.get(position, 0),
            rules.max_starters_by_position.get(position, rules.squad_size_by_position[position]) + 1,
        )
        for position in positions
    ]
    return [
        dict(zip(positions, counts))
        for counts in product(*ranges)
        if sum(counts) == rules.starters
    ]


def _is_legal_formation(starters: list[int], position_by_player: dict[int, int],
                        rules: SquadRules) -> bool:
    counts: dict[int, int] = defaultdict(int)
    for player_id in starters:
        counts[position_by_player[player_id]] += 1
    return dict(counts) in [
        {pos: n for pos, n in formation.items() if n} for formation in _legal_formations(rules)
    ]
