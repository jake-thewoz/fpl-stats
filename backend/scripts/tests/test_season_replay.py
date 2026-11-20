"""Season replay tests on a tiny invented season, totals worked out by hand."""
from __future__ import annotations

from dataclasses import replace

import pytest

from compute import HIT_COST_POINTS, MAX_BANKED_FREE_TRANSFERS
from replay_chips import (
    CHIP_WINDOWS_BY_SEASON,
    ScheduledChips,
    SimpleRules,
    best_chip_schedule,
    chip_gains,
)
from replay_policies import AllowHits, UseBanked, one_a_week
from replay_strategies import form_scorer, hindsight_scorer, ownership_scorer
from schemas import Fixture, PlayerHistoryRow
from season_data import SeasonData
from season_replay import (
    BENCH_BOOST,
    FREE_HIT,
    TRIPLE_CAPTAIN,
    WILDCARD,
    ChipWindow,
    IllegalChip,
    IllegalTransfer,
    Lineup,
    ReplayConfig,
    Scores,
    Transfer,
    archive_player,
    pick_lineup,
    run_replay,
    score_gameweek,
    selling_price,
)
from season_replay_report import render_replay_report
from squad_optimizer import SquadRules
from xp_v2 import DEF, FWD, GKP, MID

SEASON = "2025-26"
FIRST_GAMEWEEK = 1
LAST_GAMEWEEK = 3
LONG_SEASON_LAST_GAMEWEEK = 8
PRICE = 50
# A small game: 2 GKP, 3 DEF, 3 MID, 2 FWD; 7 start (1 GKP, ≥2 DEF, ≥2 MID, ≥1 FWD).
RULES = SquadRules(
    max_players_per_team=3,
    squad_size_by_position={GKP: 2, DEF: 3, MID: 3, FWD: 2},
    starters=7,
    min_starters_by_position={GKP: 1, DEF: 2, MID: 2, FWD: 1},
    max_starters_by_position={GKP: 1},
)
SQUAD_PRICE = 10 * PRICE
CONFIG = ReplayConfig(transfer_policy=one_a_week, start_gameweek=FIRST_GAMEWEEK,
                      budget_tenths=SQUAD_PRICE, horizon=1, rules=RULES)

# player id -> position; ids 1-10 are the "good" pool, 11-20 the rest.
POSITION_BY_PLAYER = {
    1: GKP, 2: GKP, 3: DEF, 4: DEF, 5: DEF, 6: MID, 7: MID, 8: MID, 9: FWD, 10: FWD,
    11: GKP, 12: GKP, 13: DEF, 14: DEF, 15: DEF, 16: MID, 17: MID, 18: MID, 19: FWD, 20: FWD,
}
SQUAD = frozenset(range(1, 11))


def _row(player_id: int, gameweek: int, points: int, minutes: int = 90) -> PlayerHistoryRow:
    return PlayerHistoryRow(
        element=player_id, fixture=gameweek, opponent_team=2, was_home=True, round=gameweek,
        minutes=minutes, goals_scored=0, assists=0, clean_sheets=0, goals_conceded=0,
        saves=0, bonus=0, bps=0, yellow_cards=0, red_cards=0, own_goals=0,
        penalties_saved=0, penalties_missed=0, total_points=points,
    )


def _season(points: dict[tuple[int, int], int], *, price: dict[tuple[int, int], int] = {},
            selected: dict[tuple[int, int], int] = {},
            last_gameweek: int = LAST_GAMEWEEK) -> SeasonData:
    """Every player has a row every gameweek; unlisted points are 0 with
    0 minutes. Each player is on his own club so the club limit never binds."""
    rows = []
    for gameweek in range(FIRST_GAMEWEEK, last_gameweek + 1):
        for player_id in POSITION_BY_PLAYER:
            scored = points.get((player_id, gameweek))
            rows.append(_row(player_id, gameweek, scored or 0, 0 if scored is None else 90))
    keys = [(p, g) for p in POSITION_BY_PLAYER for g in range(FIRST_GAMEWEEK, last_gameweek + 1)]
    return SeasonData(
        season=SEASON, rows=rows, position_by_player=POSITION_BY_PLAYER,
        team_by_player_round={key: key[0] for key in keys},
        value_by_player_round={key: price.get(key, PRICE) for key in keys},
        selected_by_player_round={key: selected.get(key, 0) for key in keys},
        name_by_player={p: f"player{p}" for p in POSITION_BY_PLAYER},
        fixtures=[Fixture(id=g, event=g, team_h=1, team_a=2, finished=True)
                  for g in range(FIRST_GAMEWEEK, last_gameweek + 1)],
    )


def _fixed_scorer(score_by_player: dict[int, float]):
    def scorer(season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
        return {p: {g: score for g in range(as_of_gw, as_of_gw + horizon)}
                for p, score in score_by_player.items()}
    return scorer


GOOD_POOL_SCORES = {p: (2.0 if p <= 10 else 1.0) for p in POSITION_BY_PLAYER}


class TestPickLineup:
    def test_best_formation_captain_and_bench_order(self):
        scores = {1: 5, 2: 1, 3: 4, 4: 3, 5: 0, 6: 9, 7: 8, 8: 7, 9: 2, 10: 1}
        lineup = pick_lineup(squad=SQUAD, score_by_player=scores,
                             position_by_player=POSITION_BY_PLAYER, rules=RULES)
        # GKP 1, DEF 3+4, MID 6+7+8, FWD 9 beats any other legal shape.
        assert set(lineup.starters) == {1, 3, 4, 6, 7, 8, 9}
        assert lineup.captain == 6
        # Keeper first, then outfielders best first.
        assert lineup.bench == (2, 10, 5)


class TestScoreGameweek:
    LINEUP = Lineup(starters=(6, 7, 8, 3, 4, 9, 1), bench=(2, 10, 5), captain=6)

    def _score(self, points: dict[int, int], did_not_play: set[int] = set(),
               chip: str | None = None):
        return score_gameweek(
            lineup=self.LINEUP,
            points_by_player=points,
            minutes_by_player={p: 0 if p in did_not_play else 90 for p in SQUAD},
            position_by_player=POSITION_BY_PLAYER, rules=RULES, chip=chip,
        )

    def test_captain_counts_double(self):
        points = {p: 2 for p in SQUAD} | {6: 10}
        # Starters: 10 + 6 × 2 = 22, plus the captain's 10 again; the
        # bench's three players scored 2 each.
        assert self._score(points) == (32, 10, 0, 6)

    def test_triple_captain_counts_the_captain_three_times(self):
        points = {p: 2 for p in SQUAD} | {6: 10}
        week = self._score(points, chip=TRIPLE_CAPTAIN)
        assert (week.points, week.captain_bonus) == (42, 20)

    def test_bench_boost_counts_the_bench_and_makes_no_substitutions(self):
        points = {p: 2 for p in SQUAD} | {6: 10, 5: 7}
        week = self._score(points, did_not_play={3}, chip=BENCH_BOOST)
        # All ten: 10 + 7 + 2 × 8 (DEF 3 scored 2 without minutes in
        # this made-up week), plus the captain's 10 again.
        assert week == (10 + 7 + 2 * 8 + 10, 10, 0, 0)

    def test_captain_who_did_not_play_is_not_doubled(self):
        points = {p: 2 for p in SQUAD} | {6: 0, 5: 3}
        # Bench order is GKP 2, FWD 10, DEF 5: the keeper can't play
        # outfield, FWD 10 comes on (GKP-DEF-MID-FWD 1-2-2-2 is legal).
        total, captain_bonus, substitutions, _ = self._score(points, did_not_play={6})
        assert (total, captain_bonus, substitutions) == (12 + 2, 0, 1)

    def test_auto_sub_skips_players_who_would_break_the_formation(self):
        # DEF 3 out: GKP 2 can't play outfield, FWD 10 would leave one
        # defender, so DEF 5 comes on.
        points = {p: 2 for p in SQUAD} | {5: 7}
        total, _, substitutions, _ = self._score(points, did_not_play={3})
        assert substitutions == 1
        assert total == 2 * 6 + 7 + 2  # six starters, DEF 5, captain doubled

    def test_bench_player_who_did_not_play_is_skipped(self):
        points = {p: 2 for p in SQUAD} | {9: 0, 10: 0}
        total, _, substitutions, _ = self._score(points, did_not_play={9, 10})
        # FWD 9 out, no forward on the bench played: one forward is the
        # minimum, so GKP 2 and DEF 5 can't come on either.
        assert substitutions == 0
        assert total == 2 * 6 + 2


class TestRunReplay:
    def test_initial_squad_is_the_best_pool_and_scored_by_hand(self):
        points = {(p, g): 1 for p in range(1, 11) for g in range(1, 4)}
        result = run_replay(_season(points), _fixed_scorer(GOOD_POOL_SCORES), CONFIG)
        # 7 starters × 1 point + captain's 1 again, three weeks, no transfers
        # because nobody outside the squad scores higher.
        assert [week.points for week in result.gameweeks] == [8, 8, 8]
        assert result.total_points == 24
        assert result.captain_bonus == 3
        assert result.transfers_made == 0

    def test_transfer_made_when_gain_positive_and_affordable(self):
        def scorer(season, as_of_gw, horizon):
            scores = dict(GOOD_POOL_SCORES)
            if as_of_gw >= 2:
                scores[16] = 5.0  # MID 16 becomes the best midfielder
            return _fixed_scorer(scores)(season, as_of_gw, horizon)
        result = run_replay(_season({}), scorer, CONFIG)
        (transfer,) = result.gameweeks[1].transfers
        assert transfer.in_player_id == 16
        assert result.transfers_made == 1

    def test_no_transfer_when_unaffordable(self):
        def scorer(season, as_of_gw, horizon):
            return _fixed_scorer(GOOD_POOL_SCORES | {16: 5.0} if as_of_gw >= 2
                                 else GOOD_POOL_SCORES)(season, as_of_gw, horizon)
        expensive = {(16, g): PRICE + 1 for g in range(1, 4)}
        result = run_replay(_season({}, price=expensive), scorer, CONFIG)
        assert result.transfers_made == 0

    def test_no_transfer_when_gain_not_positive(self):
        result = run_replay(_season({}), _fixed_scorer(GOOD_POOL_SCORES), CONFIG)
        assert result.transfers_made == 0

    def test_transfers_disabled(self):
        def scorer(season, as_of_gw, horizon):
            return _fixed_scorer(GOOD_POOL_SCORES | {16: 5.0})(season, as_of_gw, horizon)
        result = run_replay(_season({}), scorer, replace(CONFIG, transfer_policy=None))
        assert result.transfers_made == 0

    def test_hindsight_beats_every_other_strategy_and_runs_are_identical(self):
        points = {(p, g): (p * 7 + g * 3) % 9 for p in POSITION_BY_PLAYER for g in range(1, 4)}
        selected = {(p, g): 100 - p for p in POSITION_BY_PLAYER for g in range(1, 4)}
        season = _season(points, selected=selected)
        totals = {
            scorer.__name__: run_replay(season, scorer, CONFIG).total_points
            for scorer in (form_scorer, ownership_scorer, hindsight_scorer)
        }
        assert totals["hindsight_scorer"] >= max(totals.values())
        assert run_replay(season, hindsight_scorer, CONFIG) == run_replay(
            season, hindsight_scorer, CONFIG)


def _scripted_policy(moves_by_gameweek: dict[int, tuple[Transfer, ...]]):
    return lambda state: moves_by_gameweek.get(state.gameweek, ())


class TestFreeTransfersAndHits:
    POINTS = {(p, g): 1 for p in range(1, 11) for g in range(1, LONG_SEASON_LAST_GAMEWEEK + 1)}

    def _run(self, policy):
        season = _season(self.POINTS, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        return run_replay(season, _fixed_scorer(GOOD_POOL_SCORES),
                          replace(CONFIG, transfer_policy=policy))

    def test_unused_transfers_are_saved_up_to_the_cap(self):
        result = self._run(_scripted_policy({}))
        saved = [week.free_transfers_after for week in result.gameweeks]
        assert saved == [1, 2, 3, 4, 5, 5, 5, 5]
        assert saved[-1] == MAX_BANKED_FREE_TRANSFERS == result.free_transfers_at_end

    def test_saved_transfers_cover_several_moves_without_a_hit(self):
        # Two saved by gameweek 3: both moves are free, and one new
        # transfer arrives afterwards.
        moves = (Transfer(6, 16, 0.0), Transfer(7, 17, 0.0))
        result = self._run(_scripted_policy({3: moves}))
        week = result.gameweeks[2]
        assert (week.hit_points, week.free_transfers_after) == (0, 1)
        assert result.hit_points == 0

    def test_a_transfer_beyond_the_saved_count_costs_a_hit(self):
        # One saved by gameweek 2, two moves made: one hit. Two midfielders
        # must start and 16 and 17 don't play, so six starters score 1,
        # plus the captain's 1 again, minus the hit.
        moves = (Transfer(6, 16, 0.0), Transfer(7, 17, 0.0))
        result = self._run(_scripted_policy({2: moves}))
        week = result.gameweeks[1]
        assert week.hit_points == HIT_COST_POINTS
        assert week.points == 7 - HIT_COST_POINTS
        assert week.free_transfers_after == 1

    @pytest.mark.parametrize("move", [
        Transfer(16, 17, 0.0),   # selling a player not in the squad
        Transfer(6, 7, 0.0),     # buying a player already in the squad
        Transfer(6, 13, 0.0),    # midfielder for a defender
    ])
    def test_an_illegal_move_raises(self, move):
        with pytest.raises(IllegalTransfer):
            self._run(_scripted_policy({2: (move,)}))

    def test_buying_a_fourth_player_from_a_club_raises(self):
        season = _season(self.POINTS, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        crowded_club = 6
        teams = dict(season.team_by_player_round)
        for player_id in (7, 8, 16):
            for gameweek in range(FIRST_GAMEWEEK, LONG_SEASON_LAST_GAMEWEEK + 1):
                teams[(player_id, gameweek)] = crowded_club
        season = replace(season, team_by_player_round=teams)
        config = replace(CONFIG, transfer_policy=_scripted_policy({2: (Transfer(3, 13, 0.0),)}))
        # Three from one club already: an unrelated move is fine.
        run_replay(season, _fixed_scorer(GOOD_POOL_SCORES), config)
        config = replace(CONFIG, transfer_policy=_scripted_policy({2: (Transfer(9, 19, 0.0),)}))
        teams[(19, 2)] = crowded_club
        with pytest.raises(IllegalTransfer):
            run_replay(replace(season, team_by_player_round=teams),
                       _fixed_scorer(GOOD_POOL_SCORES), config)

    def test_a_squad_players_real_life_move_does_not_block_other_transfers(self):
        season = _season(self.POINTS, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        teams = dict(season.team_by_player_round)
        for player_id in (7, 8, 9):
            for gameweek in range(2, LONG_SEASON_LAST_GAMEWEEK + 1):
                teams[(player_id, gameweek)] = 6  # three squad players join player 6's club
        config = replace(CONFIG, transfer_policy=_scripted_policy({2: (Transfer(3, 13, 0.0),)}))
        result = run_replay(replace(season, team_by_player_round=teams),
                            _fixed_scorer(GOOD_POOL_SCORES), config)
        assert result.transfers_made == 1

    def test_overspending_raises(self):
        season = _season(self.POINTS, price={(16, 2): PRICE + 1},
                         last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        policy = _scripted_policy({2: (Transfer(6, 16, 0.0),)})
        with pytest.raises(IllegalTransfer):
            run_replay(season, _fixed_scorer(GOOD_POOL_SCORES),
                       replace(CONFIG, transfer_policy=policy))


class TestSellingPrices:
    """Squad players were bought at ``PRICE`` in gameweek 1."""

    POINTS = {(p, g): 1 for p in range(1, 11) for g in range(1, LAST_GAMEWEEK + 1)}

    @pytest.mark.parametrize("purchase, current, expected", [
        (55, 58, 56),  # a rise of 3 keeps 1
        (55, 56, 55),  # a rise of 1 keeps nothing
        (55, 52, 52),  # a fall is taken in full
        (55, 55, 55),
    ])
    def test_selling_price(self, purchase, current, expected):
        assert selling_price(purchase, current) == expected

    @staticmethod
    def _risen(player_id: int, price: int) -> dict[tuple[int, int], int]:
        return {(player_id, g): price for g in range(2, LAST_GAMEWEEK + 1)}

    def test_a_sale_raises_only_half_the_rise(self):
        # MID 6 rose by 3 so sells for 51; MID 16 costs 52.
        season = _season(self.POINTS, price=self._risen(6, PRICE + 3) | self._risen(16, PRICE + 2))
        policy = _scripted_policy({2: (Transfer(6, 16, 0.0),)})
        with pytest.raises(IllegalTransfer):
            run_replay(season, _fixed_scorer(GOOD_POOL_SCORES),
                       replace(CONFIG, transfer_policy=policy))

    @pytest.mark.parametrize("rise, transfers", [(4, 1), (3, 0)])
    def test_the_policy_spends_only_the_selling_price(self, rise, transfers):
        def scorer(season, as_of_gw, horizon):
            return _fixed_scorer(GOOD_POOL_SCORES | {16: 5.0} if as_of_gw >= 2
                                 else GOOD_POOL_SCORES)(season, as_of_gw, horizon)
        season = _season({}, price=self._risen(6, PRICE + rise) | self._risen(16, PRICE + 2))
        result = run_replay(season, scorer, CONFIG)
        assert result.transfers_made == transfers
        assert all(week.bank >= 0 for week in result.gameweeks)

    def test_team_value_counts_selling_prices_and_the_new_purchase_price(self):
        # GW2: MID 6 rose by 4 (worth +2), sold for 52 to buy MID 16 at 50,
        # leaving 2 in the bank. GW3: 16 rises by 2 (worth +1).
        price = self._risen(6, PRICE + 4) | {(16, 3): PRICE + 2}
        policy = _scripted_policy({2: (Transfer(6, 16, 0.0),)})
        result = run_replay(_season(self.POINTS, price=price), _fixed_scorer(GOOD_POOL_SCORES),
                            replace(CONFIG, transfer_policy=policy))
        assert [week.bank for week in result.gameweeks] == [0, 2, 2]
        assert [week.team_value for week in result.gameweeks] == [
            SQUAD_PRICE, SQUAD_PRICE + 2, SQUAD_PRICE + 3]
        assert (result.team_value_at_start, result.team_value_at_middle,
                result.team_value_at_end) == (SQUAD_PRICE, SQUAD_PRICE + 2, SQUAD_PRICE + 3)


class TestChips:
    """Squad players 1-10 score 1 point a week; 11-20 score 3 in gameweek
    2 only, when the scorer also rates them above the squad."""

    POINTS = ({(p, g): 1 for p in range(1, 11) for g in range(1, LONG_SEASON_LAST_GAMEWEEK + 1)}
              | {(p, 2): 3 for p in range(11, 21)})
    ONE_OF_EACH = tuple(
        ChipWindow(chip, FIRST_GAMEWEEK, LONG_SEASON_LAST_GAMEWEEK)
        for chip in (WILDCARD, FREE_HIT, BENCH_BOOST, TRIPLE_CAPTAIN)
    )

    @staticmethod
    def _scorer(season, as_of_gw, horizon):
        week_two_stars = {p: 5.0 for p in range(11, 21)}
        return {p: {g: (week_two_stars.get(p, 1.0) if g == 2 else GOOD_POOL_SCORES[p])
                    for g in range(as_of_gw, as_of_gw + horizon)}
                for p in POSITION_BY_PLAYER}

    def _run(self, chip_by_gameweek, windows=ONE_OF_EACH, season=None):
        config = replace(CONFIG, transfer_policy=None, chip_windows=windows,
                         chip_policy=ScheduledChips(chip_by_gameweek))
        season = season or _season(self.POINTS, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        return run_replay(season, self._scorer, config)

    def test_free_hit_squad_lasts_one_week_and_keeps_saved_transfers(self):
        result = self._run({2: FREE_HIT})
        # The free-hit side are 11-20: seven starters score 3, captain 3 again.
        assert result.gameweeks[1].points == 7 * 3 + 3
        assert result.gameweeks[1].squad == SQUAD
        assert result.gameweeks[2].points == 8
        assert [w.free_transfers_after for w in result.gameweeks][:3] == [1, 1, 2]

    def test_wildcard_squad_stays(self):
        result = self._run({2: WILDCARD})
        assert result.gameweeks[1].squad == frozenset(range(11, 21))
        assert result.gameweeks[2].squad == frozenset(range(11, 21))
        assert result.gameweeks[1].free_transfers_after == 1

    def test_bench_boost_and_triple_captain_in_the_replay(self):
        result = self._run({1: BENCH_BOOST, 3: TRIPLE_CAPTAIN})
        # Ten players score 1, captain 1 again; then seven, captain twice more.
        assert [w.points for w in result.gameweeks][:3] == [11, 8, 9]
        assert result.chips_played == {1: BENCH_BOOST, 3: TRIPLE_CAPTAIN}

    @pytest.mark.parametrize("chip_by_gameweek, windows", [
        ({1: BENCH_BOOST, 2: BENCH_BOOST}, (ChipWindow(BENCH_BOOST, 1, 8),)),  # twice
        ({1: BENCH_BOOST}, (ChipWindow(BENCH_BOOST, 2, 8),)),                  # too early
        ({1: WILDCARD}, (ChipWindow(WILDCARD, 1, 8),)),     # the squad was just built
        ({2: FREE_HIT, 3: FREE_HIT},
         (ChipWindow(FREE_HIT, 1, 8), ChipWindow(FREE_HIT, 1, 8))),  # back to back
        ({2: TRIPLE_CAPTAIN}, ()),                          # not in this season's rules
    ])
    def test_an_illegal_chip_raises(self, chip_by_gameweek, windows):
        with pytest.raises(IllegalChip):
            self._run(chip_by_gameweek, windows)

    def test_season_rules_give_each_chip_once_per_window(self):
        windows = CHIP_WINDOWS_BY_SEASON["2025-26"]
        assert len(windows) == 8
        assert {(w.first_gameweek <= 19 < w.last_gameweek) for w in windows} == {False}

    def _fixtures_season(self, extra: dict[int, int] = {}, blank: dict[int, int] = {}):
        """Squad player p plays club p + 10 every week. ``extra`` adds a
        second fixture for the first n squad clubs in a gameweek;
        ``blank`` removes the first n."""
        season = _season(self.POINTS, last_gameweek=LAST_GAMEWEEK)
        fixtures, next_id = [], 1
        for gameweek in range(FIRST_GAMEWEEK, LAST_GAMEWEEK + 1):
            for club in range(1, 11):
                copies = 1 + (club <= extra.get(gameweek, 0)) - (club <= blank.get(gameweek, 0))
                for _ in range(copies):
                    fixtures.append(Fixture(id=next_id, event=gameweek, team_h=club,
                                            team_a=club + 10, finished=True))
                    next_id += 1
        return replace(season, fixtures=fixtures)

    def _simple(self, season, windows):
        config = replace(CONFIG, transfer_policy=None, chip_windows=windows,
                         chip_policy=SimpleRules())
        return run_replay(season, _fixed_scorer(GOOD_POOL_SCORES), config)

    def test_simple_rules_bench_boost_waits_for_the_double(self):
        result = self._simple(self._fixtures_season(extra={3: 5}),
                              (ChipWindow(BENCH_BOOST, 1, 3),))
        assert result.chips_played == {3: BENCH_BOOST}

    def test_simple_rules_free_hit_goes_in_the_blank(self):
        result = self._simple(self._fixtures_season(blank={2: 5}),
                              (ChipWindow(FREE_HIT, 1, 3),))
        assert result.chips_played == {2: FREE_HIT}

    def test_simple_rules_plays_a_chip_before_its_window_closes(self):
        result = self._simple(self._fixtures_season(),
                              (ChipWindow(TRIPLE_CAPTAIN, 1, 2), ChipWindow(BENCH_BOOST, 1, 2)))
        assert set(result.chips_played.values()) == {TRIPLE_CAPTAIN, BENCH_BOOST}

    def test_hindsight_chips_beats_no_chips_and_each_gain_is_counted(self):
        season = _season(self.POINTS, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        config = replace(CONFIG, transfer_policy=None, chip_windows=self.ONE_OF_EACH)
        schedule, result = best_chip_schedule(season, self._scorer, config)
        baseline = run_replay(season, self._scorer, config)
        # The free hit takes gameweek 2's stars (+16); bench boost adds
        # three bench points; triple captain one more captain point. A
        # wildcard to 11-20 would score nothing after week 2.
        assert schedule[2] == FREE_HIT
        assert WILDCARD not in schedule.values()
        gains = chip_gains(season, self._scorer, replace(config, chip_policy=None), result)
        assert result.total_points - baseline.total_points == sum(gains.values()) == 16 + 3 + 1


class TestSavingPolicies:
    """Squad players score 2.0; MID 16 improves by ``gain`` from gameweek 2."""

    MIN_GAIN = 3.0

    def _run(self, policy, gains: dict[int, float]):
        def scorer(season, as_of_gw, horizon):
            scores = dict(GOOD_POOL_SCORES)
            if as_of_gw >= 2:
                scores |= {player: 2.0 + gain for player, gain in gains.items()}
            return _fixed_scorer(scores)(season, as_of_gw, horizon)
        season = _season({}, last_gameweek=LONG_SEASON_LAST_GAMEWEEK)
        return run_replay(season, scorer, replace(CONFIG, transfer_policy=policy))

    def test_use_banked_keeps_the_transfer_when_the_gain_is_small(self):
        result = self._run(UseBanked(self.MIN_GAIN), {16: self.MIN_GAIN - 1})
        # Saved until the cap, where a transfer would otherwise be wasted.
        assert [len(week.transfers) for week in result.gameweeks] == [0, 0, 0, 0, 0, 1, 0, 0]

    def test_use_banked_spends_when_the_gain_is_big_enough(self):
        result = self._run(UseBanked(self.MIN_GAIN), {16: self.MIN_GAIN + 1})
        assert [len(week.transfers) for week in result.gameweeks][:3] == [0, 1, 0]
        assert result.gameweeks[1].transfers[0].expected_gain == pytest.approx(self.MIN_GAIN + 1)

    def test_use_banked_never_takes_a_hit(self):
        big = self.MIN_GAIN + HIT_COST_POINTS + 1
        result = self._run(UseBanked(self.MIN_GAIN), {16: big, 17: big})
        assert result.hit_points == 0
        assert [len(week.transfers) for week in result.gameweeks][:3] == [0, 1, 1]

    def test_allow_hits_takes_a_hit_only_when_the_gain_covers_it(self):
        big = self.MIN_GAIN + HIT_COST_POINTS + 1
        result = self._run(AllowHits(self.MIN_GAIN), {16: big, 17: big})
        assert len(result.gameweeks[1].transfers) == 2
        assert result.gameweeks[1].hit_points == HIT_COST_POINTS

        not_enough = self.MIN_GAIN + HIT_COST_POINTS - 1
        result = self._run(AllowHits(self.MIN_GAIN), {16: not_enough, 17: not_enough})
        assert result.hit_points == 0


class TestScorers:
    def test_form_averages_the_last_four_gameweeks_before(self):
        season = _season({(6, 1): 8, (6, 2): 4})
        assert form_scorer(season, 3, 2)[6] == {3: 3.0, 4: 3.0}

    def test_ownership_uses_the_last_round_before(self):
        season = _season({}, selected={(6, 1): 10, (6, 2): 30, (6, 3): 99})
        assert ownership_scorer(season, 3, 1)[6] == {3: 30.0}

    def test_hindsight_reads_the_target_weeks(self):
        season = _season({(6, 2): 5, (6, 3): 7})
        assert hindsight_scorer(season, 2, 2)[6] == {2: 5.0, 3: 7.0}


def test_archive_player_uses_latest_price_and_club():
    season = _season({}, price={(6, 2): 63})
    player = archive_player(season, 6, 2)
    assert (player.now_cost, player.team, player.element_type) == (63, 6, MID)


def test_report_lists_strategies_by_total():
    season = _season({(p, g): 1 for p in range(1, 11) for g in range(1, 4)})
    results = {
        "steady": run_replay(season, _fixed_scorer(GOOD_POOL_SCORES), CONFIG),
        "hindsight": run_replay(season, hindsight_scorer, CONFIG),
    }
    report = render_replay_report(results=results, ceiling_name="hindsight",
                                  budget_tenths=SQUAD_PRICE, season=SEASON,
                                  strength_name="neutral", coefficients_label="bundled",
                                  run_date="2026-11-19")
    assert "| steady | 24 | 3 | 0 | 0 | 3 | £50.0m / £50.0m / £50.0m | 100% |" in report
    assert "## Simplifications" in report


@pytest.mark.parametrize(("injury_flags", "header", "note"), [
    (False, "Injury flags: no.", "No injury news"),
    (True, "Injury flags: yes.", "Injury flags: the xP strategies use FPL's flags"),
])
def test_report_says_whether_injury_flags_were_used(injury_flags, header, note):
    season = _season({(p, g): 1 for p in range(1, 11) for g in range(1, 4)})
    results = {"hindsight": run_replay(season, hindsight_scorer, CONFIG)}
    report = render_replay_report(results=results, ceiling_name="hindsight",
                                  budget_tenths=SQUAD_PRICE, season=SEASON,
                                  strength_name="neutral", coefficients_label="bundled",
                                  run_date="2026-11-19", injury_flags=injury_flags)
    assert header in report
    assert f"- {note}" in report

