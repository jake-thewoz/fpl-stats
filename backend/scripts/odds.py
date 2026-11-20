"""Bookmaker odds as a fixture-strength signal for xP (#244). Pure: the
CSV text comes from ``season_archive.load_odds_csv``.

Source: football-data.co.uk's season files. ``Avg*`` columns are the
market average collected on Friday afternoon for weekend games (Tuesday
for midweek), close to an FPL deadline; ``AvgC*`` are closing odds,
taken at kick-off, later than anything the app would have.

Odds become an opponent strength in 0..1 like FPL difficulty does: the
opponent's expected share of the result (win = 1, draw = ½) with the
bookmaker margin removed. The odds already include home advantage and
xP adds its own, so the league's typical home share is taken out first.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass

from replay_predictions import FixtureStrength
from schemas import Fixture
from season_data import SeasonData

DRAW_SHARE = 0.5
EVEN_SHARE = 0.5
MIN_STRENGTH = 0.0
MAX_STRENGTH = 1.0
# Bookmakers price only the next round or so. Further ahead the app
# would not have odds, so the fallback strength is used instead.
ODDS_AVAILABLE_GAMEWEEKS = 1

PRE_MATCH_COLUMNS = ("AvgH", "AvgD", "AvgA")
CLOSING_COLUMNS = ("AvgCH", "AvgCD", "AvgCA")
HOME_COLUMN = "HomeTeam"
AWAY_COLUMN = "AwayTeam"
# football-data.co.uk's club names where they differ from FPL's.
FPL_NAME_BY_ODDS_NAME = {
    "Man United": "Man Utd",
    "Tottenham": "Spurs",
    "Sheffield United": "Sheffield Utd",
}
CSV_ENCODING_BOM = "﻿"


@dataclass(frozen=True)
class MatchOdds:
    home_club: str
    away_club: str
    home_odds: float
    draw_odds: float
    away_odds: float

    @property
    def home_share(self) -> float:
        """The home side's expected share of the result, margin removed."""
        home, draw, away = (1 / self.home_odds, 1 / self.draw_odds, 1 / self.away_odds)
        return (home + DRAW_SHARE * draw) / (home + draw + away)


def parse_odds_csv(text: str, *, closing: bool) -> list[MatchOdds]:
    home_column, draw_column, away_column = CLOSING_COLUMNS if closing else PRE_MATCH_COLUMNS
    reader = csv.DictReader(io.StringIO(text.removeprefix(CSV_ENCODING_BOM)))
    return [
        MatchOdds(
            home_club=FPL_NAME_BY_ODDS_NAME.get(row[HOME_COLUMN], row[HOME_COLUMN]),
            away_club=FPL_NAME_BY_ODDS_NAME.get(row[AWAY_COLUMN], row[AWAY_COLUMN]),
            home_odds=float(row[home_column]),
            draw_odds=float(row[draw_column]),
            away_odds=float(row[away_column]),
        )
        for row in reader
        if row.get(HOME_COLUMN) and row.get(home_column)
    ]


def average_home_share(matches: list[MatchOdds]) -> float:
    return sum(match.home_share for match in matches) / len(matches)


@dataclass(frozen=True)
class OddsStrength:
    """``home_share_by_clubs`` is keyed by (home team id, away team id):
    each pairing happens once a season, so no dates are needed.
    ``baseline_home_share`` should come from an earlier season so
    nothing leaks from the one being predicted."""

    home_share_by_clubs: dict[tuple[int, int], float]
    baseline_home_share: float
    fallback: FixtureStrength
    available_gameweeks: int | None = ODDS_AVAILABLE_GAMEWEEKS

    def strength(self, season: SeasonData, fixture: Fixture, for_home_team: bool,
                 as_of_gw: int | None = None) -> float:
        home_share = self.home_share_by_clubs.get((fixture.team_h, fixture.team_a))
        too_far_ahead = (
            self.available_gameweeks is not None and as_of_gw is not None
            and fixture.event is not None
            and fixture.event >= as_of_gw + self.available_gameweeks
        )
        if home_share is None or too_far_ahead:
            return self.fallback.strength(season, fixture, for_home_team, as_of_gw)
        neutral_home_share = home_share - (self.baseline_home_share - EVEN_SHARE)
        opponent_share = 1 - neutral_home_share if for_home_team else neutral_home_share
        return min(MAX_STRENGTH, max(MIN_STRENGTH, opponent_share))


def home_share_by_team_ids(matches: list[MatchOdds],
                           team_id_by_name: dict[str, int]) -> dict[tuple[int, int], float]:
    """Raises ``KeyError`` naming any club the odds file spells differently."""
    unknown = {m.home_club for m in matches} - team_id_by_name.keys()
    if unknown:
        raise KeyError(f"Odds clubs not in FPL's teams: {sorted(unknown)}")
    return {
        (team_id_by_name[m.home_club], team_id_by_name[m.away_club]): m.home_share
        for m in matches
    }


def strength_and_goals_conceded(season: SeasonData,
                                fixture_strength: FixtureStrength) -> list[tuple[float, int]]:
    """(opponent strength, goals conceded) for both sides of every
    finished fixture, to test a strength source against what happened."""
    pairs = []
    for fixture in season.fixtures:
        if fixture.team_h_score is None or fixture.team_a_score is None:
            continue
        pairs.append((fixture_strength.strength(season, fixture, True), fixture.team_a_score))
        pairs.append((fixture_strength.strength(season, fixture, False), fixture.team_h_score))
    return pairs
