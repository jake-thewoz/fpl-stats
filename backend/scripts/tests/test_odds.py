"""Odds parsing and the odds-based fixture strength, worked out by hand."""
from __future__ import annotations

import pytest

from odds import (
    MatchOdds,
    OddsStrength,
    average_home_share,
    home_share_by_team_ids,
    parse_odds_csv,
    strength_and_goals_conceded,
)
from replay_predictions import NEUTRAL_OPPONENT_STRENGTH, NeutralStrength
from schemas import Fixture
from season_data import SeasonData

CSV = (
    "﻿Div,Date,HomeTeam,AwayTeam,AvgH,AvgD,AvgA,AvgCH,AvgCD,AvgCA\n"
    "E0,16/08/2025,Man United,Tottenham,2.0,4.0,4.0,1.5,5.0,6.0\n"
    "E0,16/08/2025,Arsenal,Wolves,1.25,6.0,12.0,1.2,7.0,15.0\n"
)
HOME, AWAY = 1, 2
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
    assert MatchOdds("a", "b", 2.0, 4.0, 4.0).home_share == pytest.approx(0.625)
    # Odds of 1.8 / 3.6 / 3.6 carry an 11% margin; shares are unchanged.
    assert MatchOdds("a", "b", 1.8, 3.6, 3.6).home_share == pytest.approx(0.625)


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
