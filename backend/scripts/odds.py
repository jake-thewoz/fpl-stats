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
import math
from dataclasses import dataclass, field

from replay_predictions import FixtureStrength, GoalMultipliers
from schemas import Fixture
from season_data import SeasonData

DRAW_SHARE = 0.5
EVEN_SHARE = 0.5
MIN_STRENGTH = 0.0
MAX_STRENGTH = 1.0
# Bookmakers price only the next round or so. Further ahead the app
# would not have odds, so the fallback strength is used instead.
ODDS_AVAILABLE_GAMEWEEKS = 1

PRE_MATCH_COLUMNS = ("AvgH", "AvgD", "AvgA", "Avg>2.5", "Avg<2.5")
CLOSING_COLUMNS = ("AvgCH", "AvgCD", "AvgCA", "AvgC>2.5", "AvgC<2.5")
# Expected goals from odds: each side's goals are independent Poisson,
# the total is fitted to the over/under 2.5 price and the split to the
# home-minus-away win probabilities.
UNDER_LINE_GOALS = 2
MAX_GOALS_COUNTED = 10
MIN_TOTAL_GOALS = 0.05
MAX_TOTAL_GOALS = 10.0
BISECTION_STEPS = 60
# A team's usual expected goals is the mean over its matches so far; with
# fewer than this many, the league's average from the season before is used.
MIN_MATCHES_FOR_TEAM_BASELINE = 3
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
    over_odds: float
    under_odds: float

    def _result_probabilities(self) -> tuple[float, float, float]:
        home, draw, away = (1 / self.home_odds, 1 / self.draw_odds, 1 / self.away_odds)
        total = home + draw + away
        return home / total, draw / total, away / total

    @property
    def home_share(self) -> float:
        """The home side's expected share of the result, margin removed."""
        home, draw, _ = self._result_probabilities()
        return home + DRAW_SHARE * draw

    @property
    def expected_goals(self) -> tuple[float, float]:
        """(home, away) expected goals implied by the odds."""
        over, under = 1 / self.over_odds, 1 / self.under_odds
        total = _solve_total_goals(under / (over + under))
        home, _, away = self._result_probabilities()
        home_fraction = _bisect(lambda fraction: _win_margin(fraction * total,
                                                             (1 - fraction) * total),
                                home - away, low=0.0, high=1.0)
        return home_fraction * total, (1 - home_fraction) * total


def _poisson(goals: int, rate: float) -> float:
    return math.exp(-rate) * rate ** goals / math.factorial(goals)


def _solve_total_goals(probability_under: float) -> float:
    """The Poisson total whose chance of at most ``UNDER_LINE_GOALS`` goals
    is ``probability_under``. That chance falls as the total rises."""
    def chance_of_under(total: float) -> float:
        return -sum(_poisson(goals, total) for goals in range(UNDER_LINE_GOALS + 1))
    return _bisect(chance_of_under, -probability_under, low=MIN_TOTAL_GOALS, high=MAX_TOTAL_GOALS)


def _win_margin(home_rate: float, away_rate: float) -> float:
    """P(home win) − P(away win) for independent Poisson scores."""
    home = [_poisson(goals, home_rate) for goals in range(MAX_GOALS_COUNTED + 1)]
    away = [_poisson(goals, away_rate) for goals in range(MAX_GOALS_COUNTED + 1)]
    return sum(
        home[h] * away[a] * ((h > a) - (h < a))
        for h in range(MAX_GOALS_COUNTED + 1) for a in range(MAX_GOALS_COUNTED + 1)
    )


def _bisect(increasing, target: float, *, low: float, high: float) -> float:
    """The x in [low, high] where the increasing function hits ``target``."""
    for _ in range(BISECTION_STEPS):
        middle = (low + high) / 2
        if increasing(middle) < target:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def parse_odds_csv(text: str, *, closing: bool) -> list[MatchOdds]:
    home_column, draw_column, away_column, over_column, under_column = (
        CLOSING_COLUMNS if closing else PRE_MATCH_COLUMNS)
    reader = csv.DictReader(io.StringIO(text.removeprefix(CSV_ENCODING_BOM)))
    return [
        MatchOdds(
            home_club=FPL_NAME_BY_ODDS_NAME.get(row[HOME_COLUMN], row[HOME_COLUMN]),
            away_club=FPL_NAME_BY_ODDS_NAME.get(row[AWAY_COLUMN], row[AWAY_COLUMN]),
            home_odds=float(row[home_column]),
            draw_odds=float(row[draw_column]),
            away_odds=float(row[away_column]),
            over_odds=float(row[over_column]),
            under_odds=float(row[under_column]),
        )
        for row in reader
        if row.get(HOME_COLUMN) and row.get(home_column)
    ]


def average_home_share(matches: list[MatchOdds]) -> float:
    return sum(match.home_share for match in matches) / len(matches)


def average_team_goals(matches: list[MatchOdds]) -> float:
    """Expected goals per team per match, across ``matches``."""
    return sum(sum(match.expected_goals) for match in matches) / (2 * len(matches))


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
    # (home id, away id) -> (home, away) expected goals; empty turns the
    # expected-goals input off, leaving only the 0..1 strength.
    expected_goals_by_clubs: dict[tuple[int, int], tuple[float, float]] = field(
        default_factory=dict)
    baseline_team_goals: float = 0.0
    # Measure goals conceded against the league average (the odds' view of
    # the defence) rather than the team's own usual.
    concede_vs_league: bool = False
    _team_baseline_cache: dict[tuple[str, int, int, bool], float] = field(
        default_factory=dict, repr=False, compare=False)

    def _has_odds(self, fixture: Fixture, as_of_gw: int | None) -> bool:
        too_far_ahead = (
            self.available_gameweeks is not None and as_of_gw is not None
            and fixture.event is not None
            and fixture.event >= as_of_gw + self.available_gameweeks
        )
        return (fixture.team_h, fixture.team_a) in self.home_share_by_clubs and not too_far_ahead

    def strength(self, season: SeasonData, fixture: Fixture, for_home_team: bool,
                 as_of_gw: int | None = None) -> float:
        if not self._has_odds(fixture, as_of_gw):
            return self.fallback.strength(season, fixture, for_home_team, as_of_gw)
        home_share = self.home_share_by_clubs[(fixture.team_h, fixture.team_a)]
        neutral_home_share = home_share - (self.baseline_home_share - EVEN_SHARE)
        opponent_share = 1 - neutral_home_share if for_home_team else neutral_home_share
        return min(MAX_STRENGTH, max(MIN_STRENGTH, opponent_share))

    def goal_multipliers(self, season: SeasonData, fixture: Fixture, for_home_team: bool,
                         as_of_gw: int | None = None) -> GoalMultipliers | None:
        """The side's expected goals scored in this match over its usual,
        and conceded over its usual (or the league's), or None when there
        are no odds to use."""
        pair = (fixture.team_h, fixture.team_a)
        if pair not in self.expected_goals_by_clubs or not self._has_odds(fixture, as_of_gw):
            return None
        home_goals, away_goals = self.expected_goals_by_clubs[pair]
        scored, conceded = (home_goals, away_goals) if for_home_team else (away_goals, home_goals)
        team = fixture.team_h if for_home_team else fixture.team_a
        as_of = as_of_gw if as_of_gw is not None else fixture.event
        concede_baseline = (self.baseline_team_goals if self.concede_vs_league
                            else self._usual_goals(season, team, as_of, scored=False))
        return GoalMultipliers(
            concede=conceded / concede_baseline,
            attack=scored / self._usual_goals(season, team, as_of, scored=True),
            concede_vs_league=self.concede_vs_league,
        )

    def _usual_goals(self, season: SeasonData, team: int, as_of_gw: int | None, *,
                     scored: bool) -> float:
        """The team's mean expected goals scored (or conceded) over matches
        before ``as_of_gw``, the same matches its rates come from."""
        key = (season.season, team, as_of_gw or 0, scored)
        if key not in self._team_baseline_cache:
            past = [
                goals[0] if (fixture.team_h == team) == scored else goals[1]
                for fixture in season.fixtures
                if team in (fixture.team_h, fixture.team_a)
                and fixture.event is not None and as_of_gw is not None
                and fixture.event < as_of_gw
                and (goals := self.expected_goals_by_clubs.get(
                    (fixture.team_h, fixture.team_a))) is not None
            ]
            self._team_baseline_cache[key] = (
                sum(past) / len(past) if len(past) >= MIN_MATCHES_FOR_TEAM_BASELINE
                else self.baseline_team_goals
            )
        return self._team_baseline_cache[key]


def home_share_by_team_ids(matches: list[MatchOdds],
                           team_id_by_name: dict[str, int]) -> dict[tuple[int, int], float]:
    """Raises ``KeyError`` naming any club the odds file spells differently."""
    return {pair: m.home_share for pair, m in _by_team_ids(matches, team_id_by_name).items()}


def expected_goals_by_team_ids(
    matches: list[MatchOdds], team_id_by_name: dict[str, int],
) -> dict[tuple[int, int], tuple[float, float]]:
    return {pair: m.expected_goals for pair, m in _by_team_ids(matches, team_id_by_name).items()}


def _by_team_ids(matches: list[MatchOdds],
                 team_id_by_name: dict[str, int]) -> dict[tuple[int, int], MatchOdds]:
    unknown = {m.home_club for m in matches} - team_id_by_name.keys()
    if unknown:
        raise KeyError(f"Odds clubs not in FPL's teams: {sorted(unknown)}")
    return {(team_id_by_name[m.home_club], team_id_by_name[m.away_club]): m for m in matches}


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
