"""Odds parsing and the odds-based fixture strength, worked out by hand."""
from __future__ import annotations

import pytest

from odds import (
    MatchOdds,
    OddsStrength,
    average_home_share,
    average_team_goals,
    expected_goals_by_team_ids,
    home_share_by_team_ids,
    parse_odds_csv,
    strength_and_goals_conceded,
)
from replay_predictions import NEUTRAL_OPPONENT_STRENGTH, GoalMultipliers, NeutralStrength
from schemas import Fixture
from season_data import SeasonData

CSV = (
    "\ufeffDiv,Date,HomeTeam,AwayTeam,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5,"
    "AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5\n"
    "E0,16/08/2025,Man United,Tottenham,2.0,4.0,4.0,1.9,1.9,1.5,5.0,6.0,1.8,2.0\n"
    "E0,16/08/2025,Arsenal,Wolves,1.25,6.0,12.0,1.4,3.0,1.2,7.0,15.0,1.3,3.5\n"
)
HOME, AWAY = 1, 2
EVEN_TOTAL = 2.0  # over and under 2.5 goals equally likely
AS_OF_GW = 10
BASELINE = 0.56


def _fixture(event: int = AS_OF_GW) -> Fixture:
    return Fixture(id=1, event=event, team_h=HOME, team_a=AWAY, finished=False)


def _strength(home_share: float, **overrides) -> OddsStrength:
    settings = dict(home_share_by_clubs={(HOME, AWAY): home_share},
                    baseline_home_share=BASELINE, fallback=NeutralStrength())
    return OddsStrength(**(settings | overrides))


def test_home_share_removes_the_bookmaker_margin():
    # 1/2 + 1/4 + 1/4 = 1.0 already: home 0.5, draw 0.25 counts half.
    assert MatchOdds("a", "b", 2.0, 4.0, 4.0, EVEN_TOTAL, EVEN_TOTAL).home_share == pytest.approx(0.625)
    # Odds of 1.8 / 3.6 / 3.6 carry an 11% margin; shares are unchanged.
    assert MatchOdds("a", "b", 1.8, 3.6, 3.6, EVEN_TOTAL, EVEN_TOTAL).home_share == pytest.approx(0.625)


def test_parse_maps_club_names_and_picks_the_columns():
    pre_match = parse_odds_csv(CSV, closing=False)
    assert (pre_match[0].home_club, pre_match[0].away_club) == ("Man Utd", "Spurs")
    assert pre_match[0].home_odds == 2.0
    assert parse_odds_csv(CSV, closing=True)[0].home_odds == 1.5
    assert average_home_share(pre_match) == pytest.approx(
        (pre_match[0].home_share + pre_match[1].home_share) / 2)


def test_strength_is_the_opponents_share_with_home_advantage_taken_out():
    # Home share 0.76 is 0.20 above the 0.56 baseline: as if 0.70 on
    # neutral ground. The home side faces 0.30, the away side 0.70.
    strength = _strength(0.76)
    assert strength.strength(None, _fixture(), True, AS_OF_GW) == pytest.approx(0.30)
    assert strength.strength(None, _fixture(), False, AS_OF_GW) == pytest.approx(0.70)


def test_strength_stays_between_zero_and_one():
    assert _strength(0.0).strength(None, _fixture(), False, AS_OF_GW) == 0.0


@pytest.mark.parametrize("fixture, strength", [
    (_fixture(AS_OF_GW + 1), _strength(0.76)),                  # odds not out yet
    (_fixture(), _strength(0.76, home_share_by_clubs={})),      # no odds for the match
])
def test_falls_back_without_odds(fixture, strength):
    assert strength.strength(None, fixture, True, AS_OF_GW) == NEUTRAL_OPPONENT_STRENGTH


def test_no_time_limit_uses_odds_for_every_week():
    strength = _strength(0.76, available_gameweeks=None)
    assert strength.strength(None, _fixture(AS_OF_GW + 3), True, AS_OF_GW) == pytest.approx(0.30)


def test_club_names_must_all_match():
    matches = parse_odds_csv(CSV, closing=False)
    team_ids = {"Man Utd": 1, "Spurs": 2, "Arsenal": 3, "Wolves": 4}
    assert home_share_by_team_ids(matches, team_ids)[(3, 4)] == matches[1].home_share
    with pytest.raises(KeyError, match="Arsenal"):
        home_share_by_team_ids(matches, {"Man Utd": 1, "Spurs": 2, "Wolves": 4})


def test_strength_and_goals_conceded_pairs_both_sides_of_finished_matches():
    finished = Fixture(id=1, event=1, team_h=HOME, team_a=AWAY, finished=True,
                       team_h_score=2, team_a_score=0)
    unplayed = Fixture(id=2, event=2, team_h=AWAY, team_a=HOME, finished=False)
    season = SeasonData(season="2025-26", rows=[], position_by_player={},
                        team_by_player_round={}, value_by_player_round={},
                        selected_by_player_round={}, name_by_player={},
                        fixtures=[finished, unplayed])
    strength = _strength(0.76, available_gameweeks=None)
    # The home side faced 0.30 and conceded 0; the away side 0.70 and 2.
    pairs = strength_and_goals_conceded(season, strength)
    assert [(round(s, 2), goals) for s, goals in pairs] == [(0.30, 0), (0.70, 2)]


# Poisson total with P(at most 2 goals) = ½, by hand: e^-T (1 + T + T²/2) = 0.5.
EVEN_TOTAL_GOALS = 2.674


def test_expected_goals_from_an_even_match():
    home, away = MatchOdds("a", "b", 2.8, 3.4, 2.8, EVEN_TOTAL, EVEN_TOTAL).expected_goals
    assert home == pytest.approx(away)
    assert home + away == pytest.approx(EVEN_TOTAL_GOALS, abs=0.001)


def test_expected_goals_favour_the_favourite_and_follow_the_total():
    favourite = MatchOdds("a", "b", 1.25, 6.5, 12.0, 1.4, 3.0)
    home, away = favourite.expected_goals
    assert home > 2 * away
    # A lower over price means more goals expected in total.
    tighter = MatchOdds("a", "b", 1.25, 6.5, 12.0, 2.2, 1.7)
    assert sum(tighter.expected_goals) < home + away


def test_average_team_goals_is_per_team_per_match():
    matches = [MatchOdds("a", "b", 2.8, 3.4, 2.8, EVEN_TOTAL, EVEN_TOTAL)]
    assert average_team_goals(matches) == pytest.approx(EVEN_TOTAL_GOALS / 2, abs=0.001)


def _goals_season(past_matches: int, name: str = "2025-26") -> SeasonData:
    fixtures = [Fixture(id=week, event=week, team_h=HOME, team_a=AWAY, finished=True)
                for week in range(1, past_matches + 1)]
    fixtures.append(Fixture(id=99, event=AS_OF_GW, team_h=HOME, team_a=AWAY, finished=False))
    return SeasonData(season=name, rows=[], position_by_player={},
                      team_by_player_round={}, value_by_player_round={},
                      selected_by_player_round={}, name_by_player={}, fixtures=fixtures)


def test_goal_multipliers_compare_the_match_with_the_teams_usual():
    strength = _strength(0.6, expected_goals_by_clubs={(HOME, AWAY): (2.0, 0.5)},
                         baseline_team_goals=1.0)
    # Three earlier meetings at the same odds: this match is the home
    # side's usual, scoring 2.0 and conceding 0.5.
    assert strength.goal_multipliers(_goals_season(3), _fixture(), True,
                                     AS_OF_GW) == GoalMultipliers(1.0, 1.0)
    # Too few earlier matches: both are measured against the league's 1.0.
    early = _goals_season(2, name="2024-25")
    assert strength.goal_multipliers(early, _fixture(), True, AS_OF_GW) == GoalMultipliers(0.5, 2.0)
    assert strength.goal_multipliers(early, _fixture(), False, AS_OF_GW) == GoalMultipliers(2.0, 0.5)


def test_goals_conceded_can_be_measured_against_the_league():
    strength = _strength(0.6, expected_goals_by_clubs={(HOME, AWAY): (2.0, 0.5)},
                         baseline_team_goals=1.0, concede_vs_league=True)
    # The home side's usual attack is 2.0 (this match), but it concedes
    # 0.5 against a league average of 1.0.
    assert strength.goal_multipliers(_goals_season(3), _fixture(), True,
                                     AS_OF_GW) == GoalMultipliers(0.5, 1.0, True)


def test_no_goal_multipliers_beyond_the_odds_window_or_when_switched_off():
    strength = _strength(0.6, expected_goals_by_clubs={(HOME, AWAY): (2.0, 0.5)})
    assert strength.goal_multipliers(_goals_season(3), _fixture(AS_OF_GW + 1), True,
                                     AS_OF_GW) is None
    assert _strength(0.6).goal_multipliers(_goals_season(3), _fixture(), True, AS_OF_GW) is None


def test_expected_goals_by_team_ids():
    matches = parse_odds_csv(CSV, closing=False)
    team_ids = {"Man Utd": 1, "Spurs": 2, "Arsenal": 3, "Wolves": 4}
    assert expected_goals_by_team_ids(matches, team_ids)[(3, 4)] == matches[1].expected_goals
