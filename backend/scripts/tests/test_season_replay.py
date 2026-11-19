"""Season replay tests on a tiny invented season, totals worked out by hand."""
from __future__ import annotations

from dataclasses import replace

import pytest

from replay_strategies import form_scorer, hindsight_scorer, ownership_scorer
from schemas import Fixture, PlayerHistoryRow
from season_data import SeasonData
from season_replay import (
    Lineup,
    ReplayConfig,
    Scores,
    archive_player,
    pick_lineup,
    run_replay,
    score_gameweek,
)
from season_replay_report import render_replay_report
from squad_optimizer import SquadRules
from xp_v2 import DEF, FWD, GKP, MID

SEASON = "2025-26"
FIRST_GAMEWEEK = 1
LAST_GAMEWEEK = 3
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
CONFIG = ReplayConfig(start_gameweek=FIRST_GAMEWEEK, budget_tenths=SQUAD_PRICE, horizon=1,
                      rules=RULES)

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
            selected: dict[tuple[int, int], int] = {}) -> SeasonData:
    """Every player has a row every gameweek; unlisted points are 0 with
    0 minutes. Each player is on his own club so the club limit never binds."""
    rows = []
    for gameweek in range(FIRST_GAMEWEEK, LAST_GAMEWEEK + 1):
        for player_id in POSITION_BY_PLAYER:
            scored = points.get((player_id, gameweek))
            rows.append(_row(player_id, gameweek, scored or 0, 0 if scored is None else 90))
    keys = [(p, g) for p in POSITION_BY_PLAYER for g in range(FIRST_GAMEWEEK, LAST_GAMEWEEK + 1)]
    return SeasonData(
        season=SEASON, rows=rows, position_by_player=POSITION_BY_PLAYER,
        team_by_player_round={key: key[0] for key in keys},
        value_by_player_round={key: price.get(key, PRICE) for key in keys},
        selected_by_player_round={key: selected.get(key, 0) for key in keys},
        name_by_player={p: f"player{p}" for p in POSITION_BY_PLAYER},
        fixtures=[Fixture(id=g, event=g, team_h=1, team_a=2, finished=True)
                  for g in range(FIRST_GAMEWEEK, LAST_GAMEWEEK + 1)],
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

    def _score(self, points: dict[int, int], did_not_play: set[int] = set()):
        return score_gameweek(
            lineup=self.LINEUP,
            points_by_player=points,
            minutes_by_player={p: 0 if p in did_not_play else 90 for p in SQUAD},
            position_by_player=POSITION_BY_PLAYER, rules=RULES,
        )

    def test_captain_counts_double(self):
        points = {p: 2 for p in SQUAD} | {6: 10}
        # Starters: 10 + 6 × 2 = 22, plus the captain's 10 again.
        assert self._score(points) == (32, 10, 0)

    def test_captain_who_did_not_play_is_not_doubled(self):
        points = {p: 2 for p in SQUAD} | {6: 0, 5: 3}
        # Bench order is GKP 2, FWD 10, DEF 5: the keeper can't play
        # outfield, FWD 10 comes on (GKP-DEF-MID-FWD 1-2-2-2 is legal).
        total, captain_bonus, substitutions = self._score(points, did_not_play={6})
        assert (total, captain_bonus, substitutions) == (12 + 2, 0, 1)

    def test_auto_sub_skips_players_who_would_break_the_formation(self):
        # DEF 3 out: GKP 2 can't play outfield, FWD 10 would leave one
        # defender, so DEF 5 comes on.
        points = {p: 2 for p in SQUAD} | {5: 7}
        total, _, substitutions = self._score(points, did_not_play={3})
        assert substitutions == 1
        assert total == 2 * 6 + 7 + 2  # six starters, DEF 5, captain doubled

    def test_bench_player_who_did_not_play_is_skipped(self):
        points = {p: 2 for p in SQUAD} | {9: 0, 10: 0}
        total, _, substitutions = self._score(points, did_not_play={9, 10})
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
        transfer = result.gameweeks[1].transfer
        assert transfer is not None and transfer.in_player_id == 16
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
        result = run_replay(_season({}), scorer, replace(CONFIG, transfers_enabled=False))
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
    report = render_replay_report(results=results, ceiling_name="hindsight", season=SEASON,
                                  strength_name="neutral", coefficients_label="bundled",
                                  run_date="2026-11-19")
    assert "| steady | 24 | 3 | 0 | 100% |" in report
    assert "## Simplifications" in report
