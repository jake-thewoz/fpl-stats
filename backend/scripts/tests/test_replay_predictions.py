"""Tests for point-in-time predictions — synthetic seasons, no I/O."""
from __future__ import annotations

from dataclasses import dataclass

from dataclasses import replace

import pytest

from replay_accuracy_report import render_accuracy_report, single_gameweek_rows
from replay_predictions import (
    NEUTRAL_OPPONENT_STRENGTH,
    FplDifficultyStrength,
    GoalMultipliers,
    NeutralStrength,
    predict_horizon,
)
from schemas import Fixture, PlayerHistoryRow
from season_data import SeasonData
from xp_v2 import DEF, FWD, GKP, MID, load_default_coefficients
from xp_v2_features import FeatureWindow, load_default_priors

SEASON = "2025-26"
HOME_TEAM = 1
AWAY_TEAM = 2
OTHER_TEAM = 3
LAST_ROUND = 8
AS_OF_GW = 6
HORIZON = 3

COEFS = load_default_coefficients()
PRIORS = load_default_priors()
WINDOW = FeatureWindow()

# player id -> (position, team)
SQUAD = {
    10: (GKP, HOME_TEAM),
    11: (DEF, HOME_TEAM),
    12: (MID, HOME_TEAM),
    13: (FWD, HOME_TEAM),
    20: (GKP, AWAY_TEAM),
    21: (DEF, AWAY_TEAM),
    22: (MID, AWAY_TEAM),
    23: (FWD, AWAY_TEAM),
}


def _fixture(fixture_id: int, gameweek: int, home: int, away: int, *,
             home_difficulty: int | None = 3, away_difficulty: int | None = 3) -> Fixture:
    return Fixture(
        id=fixture_id, event=gameweek, team_h=home, team_a=away, finished=True,
        team_h_score=1, team_a_score=1,
        team_h_difficulty=home_difficulty, team_a_difficulty=away_difficulty,
    )


def _row(player_id: int, fixture: Fixture, team: int, *, minutes: int = 90,
         goals: int = 0, total_points: int = 2) -> PlayerHistoryRow:
    is_home = fixture.team_h == team
    return PlayerHistoryRow(
        element=player_id, fixture=fixture.id,
        opponent_team=fixture.team_a if is_home else fixture.team_h,
        was_home=is_home, round=fixture.event, minutes=minutes,
        goals_scored=goals, assists=0, clean_sheets=0, goals_conceded=1,
        saves=0, bonus=0, bps=10, yellow_cards=0, red_cards=0, own_goals=0,
        penalties_saved=0, penalties_missed=0, total_points=total_points,
        expected_goals="0.30", expected_assists="0.10",
        expected_goals_conceded="1.20", defensive_contribution=5,
    )


def _season(*, fixtures: list[Fixture] | None = None, squad=SQUAD,
            extra_rows: list[tuple[PlayerHistoryRow, int]] = ()) -> SeasonData:
    """Teams 1 and 2 play each other every round, alternating home."""
    if fixtures is None:
        fixtures = [
            _fixture(gameweek, gameweek, *((HOME_TEAM, AWAY_TEAM) if gameweek % 2 else (AWAY_TEAM, HOME_TEAM)))
            for gameweek in range(1, LAST_ROUND + 1)
        ]
    rows: list[PlayerHistoryRow] = []
    team_by_player_round: dict[tuple[int, int], int] = {}
    for fixture in fixtures:
        for player_id, (_, team) in squad.items():
            if team in (fixture.team_h, fixture.team_a):
                rows.append(_row(player_id, fixture, team))
                team_by_player_round[(player_id, fixture.event)] = team
    for row, team in extra_rows:
        rows.append(row)
        team_by_player_round[(row.element, row.round)] = team
    positions = {player_id: position for player_id, (position, _) in squad.items()}
    return SeasonData(
        season=SEASON, rows=rows, position_by_player=positions,
        team_by_player_round=team_by_player_round,
        value_by_player_round={}, selected_by_player_round={},
        name_by_player={}, fixtures=fixtures,
    )


def _predict(season: SeasonData, *, as_of_gw: int = AS_OF_GW, horizon: int = HORIZON,
             strength=NeutralStrength()) -> dict[int, dict[int, float]]:
    return predict_horizon(season, as_of_gw, horizon, COEFS, PRIORS, WINDOW, strength)


def _rewrite_from_round(season: SeasonData, first_round: int) -> SeasonData:
    """Every stat changed in rows at or after ``first_round``."""
    rows = [
        row.model_copy(update=dict(
            minutes=0 if row.minutes else 90, goals_scored=row.goals_scored + 3,
            assists=row.assists + 2, clean_sheets=1 - row.clean_sheets,
            goals_conceded=row.goals_conceded + 4, saves=row.saves + 7,
            bonus=3, bps=99, yellow_cards=1, red_cards=1, own_goals=1,
            penalties_saved=1, penalties_missed=1, total_points=row.total_points + 15,
            expected_goals="2.50", expected_assists="1.50",
            expected_goal_involvements="4.00", expected_goals_conceded="3.00",
            defensive_contribution=30, starts=0,
        )) if row.round >= first_round else row
        for row in season.rows
    ]
    return replace(season, rows=rows)


# ---------------------------------------------------------------------------
# The rule that must never break
# ---------------------------------------------------------------------------


def test_nothing_from_as_of_gw_onwards_changes_predictions() -> None:
    season = _season()

    before = _predict(season)
    after = _predict(_rewrite_from_round(season, AS_OF_GW))

    assert before == after
    assert set(before) == set(SQUAD)


def test_earlier_rounds_do_change_predictions() -> None:
    """Guards the test above against passing because nothing is read at all."""
    season = _season()

    assert _predict(season) != _predict(_rewrite_from_round(season, AS_OF_GW - 1))


# ---------------------------------------------------------------------------
# Shape, fixtures and clubs
# ---------------------------------------------------------------------------


def test_predictions_cover_each_gameweek_in_the_horizon() -> None:
    predictions = _predict(_season())

    for by_gameweek in predictions.values():
        assert sorted(by_gameweek) == [AS_OF_GW, AS_OF_GW + 1, AS_OF_GW + 2]
        assert all(points > 0 for points in by_gameweek.values())


def test_blank_gameweek_scores_zero_and_double_gameweek_roughly_doubles() -> None:
    fixtures = [_fixture(gameweek, gameweek, HOME_TEAM, AWAY_TEAM) for gameweek in range(1, AS_OF_GW)]
    fixtures += [
        _fixture(100, AS_OF_GW, HOME_TEAM, AWAY_TEAM),
        _fixture(101, AS_OF_GW + 1, HOME_TEAM, AWAY_TEAM),
        _fixture(102, AS_OF_GW + 1, HOME_TEAM, AWAY_TEAM),
    ]

    predictions = _predict(_season(fixtures=fixtures), horizon=HORIZON)

    midfielder = predictions[12]
    assert midfielder[AS_OF_GW + 2] == 0
    assert midfielder[AS_OF_GW + 1] == pytest.approx(2 * midfielder[AS_OF_GW], rel=0.5)
    assert midfielder[AS_OF_GW + 1] > midfielder[AS_OF_GW]


def test_club_is_the_one_in_the_last_round_before_as_of_gw() -> None:
    """A forward who moved from team 2 to team 3 before as_of_gw follows
    team 3's fixtures; team 3 has a blank in as_of_gw."""
    fixtures = [_fixture(gameweek, gameweek, HOME_TEAM, AWAY_TEAM) for gameweek in range(1, LAST_ROUND + 1)]
    fixtures += [_fixture(200 + gameweek, gameweek, OTHER_TEAM, 4) for gameweek in (4, 5, 7)]
    squad = {**SQUAD, 30: (FWD, OTHER_TEAM)}
    mover_rows = [(_row(30, fixtures[gameweek - 1], AWAY_TEAM), AWAY_TEAM) for gameweek in (1, 2, 3)]
    mover_rows += [(_row(30, fixture, OTHER_TEAM), OTHER_TEAM) for fixture in fixtures[LAST_ROUND:]]
    squad_without_mover = {k: v for k, v in squad.items() if k != 30}
    season = replace(
        _season(fixtures=fixtures, squad=squad_without_mover, extra_rows=mover_rows),
        position_by_player={k: v[0] for k, v in squad.items()},
    )

    mover = _predict(season)[30]

    assert mover[AS_OF_GW] == 0
    assert mover[AS_OF_GW + 1] > 0


def test_player_not_yet_registered_is_left_out() -> None:
    late_signing = [(_row(40, fixture, HOME_TEAM), HOME_TEAM)
                    for fixture in _season().fixtures if fixture.event > AS_OF_GW]
    season = _season(extra_rows=late_signing)
    season = replace(season, position_by_player={**season.position_by_player, 40: MID})

    assert 40 not in _predict(season)
    assert 40 in _predict(season, as_of_gw=AS_OF_GW + 1)


def test_player_who_never_plays_is_damped_to_zero() -> None:
    season = _season()
    benched = [row.model_copy(update={"minutes": 0}) if row.element == 13 else row for row in season.rows]

    predictions = _predict(replace(season, rows=benched), horizon=1)

    assert predictions[13][AS_OF_GW] == pytest.approx(0)
    assert predictions[23][AS_OF_GW] > 0


# ---------------------------------------------------------------------------
# Fixture strength
# ---------------------------------------------------------------------------


def test_neutral_strength_is_always_half() -> None:
    fixture = _fixture(1, 1, HOME_TEAM, AWAY_TEAM, home_difficulty=5, away_difficulty=1)

    assert NeutralStrength().strength(_season(), fixture, for_home_team=True) == NEUTRAL_OPPONENT_STRENGTH


def test_fpl_difficulty_strength_maps_each_side() -> None:
    fixture = _fixture(1, 1, HOME_TEAM, AWAY_TEAM, home_difficulty=5, away_difficulty=2)
    strength = FplDifficultyStrength()

    assert strength.strength(_season(), fixture, for_home_team=True) == 1.0
    assert strength.strength(_season(), fixture, for_home_team=False) == 0.25


def test_fpl_difficulty_strength_missing_is_neutral() -> None:
    fixture = _fixture(1, 1, HOME_TEAM, AWAY_TEAM, home_difficulty=None, away_difficulty=None)

    assert FplDifficultyStrength().strength(_season(), fixture, for_home_team=True) == NEUTRAL_OPPONENT_STRENGTH


def test_harder_fixture_lowers_an_attackers_prediction() -> None:
    easy = [_fixture(g, g, HOME_TEAM, AWAY_TEAM, home_difficulty=1) for g in range(1, LAST_ROUND + 1)]
    hard = [_fixture(g, g, HOME_TEAM, AWAY_TEAM, home_difficulty=5) for g in range(1, LAST_ROUND + 1)]

    easy_points = _predict(_season(fixtures=easy), strength=FplDifficultyStrength())[13][AS_OF_GW]
    hard_points = _predict(_season(fixtures=hard), strength=FplDifficultyStrength())[13][AS_OF_GW]

    assert easy_points > hard_points


@dataclass(frozen=True)
class _FixedMultipliers(NeutralStrength):
    """Every match: the side concedes and scores these multiples of its usual."""

    concede: float
    attack: float

    def goal_multipliers(self, season, fixture, for_home_team, as_of_gw=None):
        return GoalMultipliers(self.concede, self.attack)


def test_goal_multipliers_reach_the_prediction() -> None:
    season = _season()
    neutral = _predict(season)[13][AS_OF_GW]
    easy = _FixedMultipliers(concede=0.5, attack=1.5)
    hard = _FixedMultipliers(concede=2.0, attack=0.5)
    # Conceding less and attacking more both add points for any outfielder.
    assert _predict(season, strength=easy)[13][AS_OF_GW] > neutral
    assert _predict(season, strength=hard)[13][AS_OF_GW] < neutral


# ---------------------------------------------------------------------------
# Single-gameweek accuracy rows
# ---------------------------------------------------------------------------


def test_accuracy_rows_score_absent_players_as_zero() -> None:
    season = _season()
    missing_round_6 = [row for row in season.rows if not (row.element == 12 and row.round == AS_OF_GW)]
    season = replace(season, rows=missing_round_6)

    rows = single_gameweek_rows(
        season=season, first_gameweek=AS_OF_GW, coefs=COEFS, priors=PRIORS,
        window=WINDOW, fixture_strength=NeutralStrength(),
    )

    by_key = {(row.player_id, row.round): row for row in rows}
    assert sorted({row.round for row in rows}) == [AS_OF_GW, AS_OF_GW + 1, AS_OF_GW + 2]
    assert by_key[(12, AS_OF_GW)].actual_total == 0
    assert by_key[(13, AS_OF_GW)].actual_total == 2
    assert by_key[(12, AS_OF_GW)].v2_pred > 0


def test_accuracy_report_has_a_row_per_position() -> None:
    rows = single_gameweek_rows(
        season=_season(), first_gameweek=AS_OF_GW, coefs=COEFS, priors=PRIORS,
        window=WINDOW, fixture_strength=NeutralStrength(),
    )

    report = render_accuracy_report(rows=rows, season=SEASON, strength_name="neutral", run_date="2026-11-19")

    for name in ("| GK |", "| DEF |", "| MID |", "| FWD |", "| **overall** |"):
        assert name in report
    assert "GW 6–8" in report
