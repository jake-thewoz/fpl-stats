"""Point-in-time xP for every player: "standing just before gameweek G,
using only what was known then, what would we have predicted for G,
G+1, …?" The engine the season replay runs on.

Nothing from round ``as_of_gw`` or later influences a prediction except
the fixture list, which is public in advance. The feature functions
already ignore rows with ``round >= as_of_gw``; this module keeps
everything else (minutes, club) to earlier rounds too.

Chance of playing is the player's season play rate before ``as_of_gw``
(``season_play_rate``). The archive has no historical injury or
suspension flags, so that is the whole availability signal here: a
player injured last week looks as available as his minutes say.

The horizon goes through ``xp_for_horizon``, the same function the
nightly analyzer uses. With no injury flags, availability starts and
recovers at the play rate, so it stays flat across the horizon, as it
does in production for an unflagged player.

Known limits: a player counts from his first row (registration) and
keeps counting after he leaves the league, damped only by his falling
play rate, because departures are not in the data.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Protocol

from schemas import Fixture, PlayerHistoryRow
from season_data import SeasonData
from xp_v2 import FixtureContext, V2Coefficients, xp_for_horizon
from xp_v2_features import (
    FeatureWindow,
    PositionPriors,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    merge_team_xgc,
    season_play_rate,
)

NEUTRAL_OPPONENT_STRENGTH = 0.5
# FPL difficulty runs 1 (easiest) to 5 (hardest); mapped linearly onto
# 0..1, the same formula as ``opp_strength_from_difficulty`` in
# lambdas/analyze_player_xp_v2/compute.py.
EASIEST_FPL_DIFFICULTY = 1
FPL_DIFFICULTY_SPAN = 4


class FixtureStrength(Protocol):
    def strength(self, season: SeasonData, fixture: Fixture, for_home_team: bool) -> float:
        """Opponent strength in 0..1 from the given side's point of view."""
        ...


@dataclass(frozen=True)
class NeutralStrength:
    """Every opponent is mid-table: what the offline scripts used before."""

    def strength(self, season: SeasonData, fixture: Fixture, for_home_team: bool) -> float:
        return NEUTRAL_OPPONENT_STRENGTH


@dataclass(frozen=True)
class FplDifficultyStrength:
    """FPL's published 1–5 fixture difficulty, mapped onto 0..1."""

    def strength(self, season: SeasonData, fixture: Fixture, for_home_team: bool) -> float:
        difficulty = fixture.team_h_difficulty if for_home_team else fixture.team_a_difficulty
        if difficulty is None:
            return NEUTRAL_OPPONENT_STRENGTH
        return (difficulty - EASIEST_FPL_DIFFICULTY) / FPL_DIFFICULTY_SPAN


def predict_horizon(
    season: SeasonData,
    as_of_gw: int,
    horizon: int,
    coefs: V2Coefficients,
    priors: PositionPriors,
    window: FeatureWindow,
    fixture_strength: FixtureStrength,
) -> dict[int, dict[int, float]]:
    """player_id -> {gameweek -> predicted points}, for as_of_gw .. as_of_gw + horizon - 1."""
    target_gameweeks = range(as_of_gw, as_of_gw + horizon)
    rows_by_player: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    rows_by_team: dict[int, list[PlayerHistoryRow]] = defaultdict(list)
    for row in season.rows:
        rows_by_player[row.element].append(row)
        team_id = season.team_by_player_round.get((row.element, row.round))
        if team_id is not None and row.round < as_of_gw:
            rows_by_team[team_id].append(row)

    fixtures_by_team_gameweek: dict[tuple[int, int], list[Fixture]] = defaultdict(list)
    for fixture in season.fixtures:
        if fixture.event in target_gameweeks:
            fixtures_by_team_gameweek[(fixture.team_h, fixture.event)].append(fixture)
            fixtures_by_team_gameweek[(fixture.team_a, fixture.event)].append(fixture)

    team_xgc_by_team: dict[int, float] = {}
    predictions: dict[int, dict[int, float]] = {}
    for player_id, player_rows in rows_by_player.items():
        position = season.position_by_player.get(player_id)
        if position is None or min(row.round for row in player_rows) > as_of_gw:
            continue
        team_id = _club_before(season, player_rows, as_of_gw)
        if team_id is None:
            continue

        if team_id not in team_xgc_by_team:
            team_xgc_by_team[team_id] = compute_team_xgc_at_gw(
                team_history_rows=rows_by_team[team_id],
                as_of_gw=as_of_gw, priors=priors, window=window,
            )
        rates = merge_team_xgc(
            compute_rates_at_gw(
                history=player_rows, position=position,
                as_of_gw=as_of_gw, priors=priors, window=window,
            ),
            team_xgc_by_team[team_id],
        )
        minutes_prob = season_play_rate(
            season_minutes=sum(row.minutes for row in player_rows if row.round < as_of_gw),
            gws_completed=as_of_gw - 1,
        )
        fixtures_by_gw = {
            gameweek: [
                _fixture_context(season, fixture, team_id, fixture_strength)
                for fixture in fixtures_by_team_gameweek[(team_id, gameweek)]
            ]
            for gameweek in target_gameweeks
        }
        components_by_gw = xp_for_horizon(
            position=position, rates=rates, fixtures_by_gw=fixtures_by_gw,
            base_minutes_prob=minutes_prob, recovered_minutes_prob=minutes_prob, coefs=coefs,
        )
        predictions[player_id] = {
            gameweek: components.total for gameweek, components in components_by_gw.items()
        }
    return predictions


def _club_before(
    season: SeasonData, player_rows: list[PlayerHistoryRow], as_of_gw: int,
) -> int | None:
    """The player's club in his last round before ``as_of_gw``, else his
    first known club."""
    earlier = [row.round for row in player_rows if row.round < as_of_gw]
    club_round = max(earlier) if earlier else min(row.round for row in player_rows)
    return season.team_by_player_round.get((player_rows[0].element, club_round))


def _fixture_context(
    season: SeasonData, fixture: Fixture, team_id: int, fixture_strength: FixtureStrength,
) -> FixtureContext:
    is_home = fixture.team_h == team_id
    return FixtureContext(
        home=is_home,
        opponent_strength=fixture_strength.strength(season, fixture, for_home_team=is_home),
        fpl_difficulty=fixture.team_h_difficulty if is_home else fixture.team_a_difficulty,
    )
