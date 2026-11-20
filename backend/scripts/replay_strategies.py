"""Scorers for the season replay: each says how good every player looks
for the next few gameweeks, standing just before ``as_of_gw``.

Only ``hindsight`` reads the future; it is the ceiling, not a strategy.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from replay_predictions import FixtureStrength, predict_horizon
from season_data import SeasonData
from season_replay import Scores
from xp_v2 import V2Coefficients
from xp_v2_features import FeatureWindow, PositionPriors

XP = "xp"
XP_NO_TRANSFERS = "xp_no_transfers"
XP_USE_BANKED = "xp_use_banked"
XP_ALLOW_HITS = "xp_allow_hits"
XP_PLANNER_SHORT = "xp_planner_h3"
XP_PLANNER_LONG = "xp_planner_h5"
FORM = "form"
OWNERSHIP = "ownership"
HINDSIGHT = "hindsight"

# Gameweeks averaged by the form scorer. A round without a match counts
# as 0 points, so players who left the league fade out.
FORM_WINDOW_GAMEWEEKS = 4


@dataclass
class XpScorer:
    """The app's xP as of each gameweek. Results are cached so ``xp``
    and ``xp_no_transfers`` share one set of predictions."""

    coefs: V2Coefficients
    priors: PositionPriors
    window: FeatureWindow
    fixture_strength: FixtureStrength
    _cache: dict[tuple[str, int, int], Scores] = field(default_factory=dict, repr=False)

    def __call__(self, season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
        key = (season.season, as_of_gw, horizon)
        if key not in self._cache:
            self._cache[key] = predict_horizon(
                season, as_of_gw, horizon, self.coefs, self.priors, self.window,
                self.fixture_strength,
            )
        return self._cache[key]


def form_scorer(season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
    """Average points over the last ``FORM_WINDOW_GAMEWEEKS`` gameweeks,
    the same for every week ahead."""
    first_counted = as_of_gw - FORM_WINDOW_GAMEWEEKS
    points_by_player: dict[int, int] = defaultdict(int)
    for row in season.rows:
        if first_counted <= row.round < as_of_gw:
            points_by_player[row.element] += row.total_points
    return _repeat(
        {player: points / FORM_WINDOW_GAMEWEEKS for player, points in points_by_player.items()},
        as_of_gw, horizon,
    )


def ownership_scorer(season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
    """How many managers owned the player in his last round before ``as_of_gw``."""
    latest: dict[int, tuple[int, int]] = {}
    for (player_id, round_number), selected in season.selected_by_player_round.items():
        if round_number < as_of_gw and round_number > latest.get(player_id, (0, 0))[0]:
            latest[player_id] = (round_number, selected)
    return _repeat(
        {player_id: float(selected) for player_id, (_, selected) in latest.items()},
        as_of_gw, horizon,
    )


def hindsight_scorer(season: SeasonData, as_of_gw: int, horizon: int) -> Scores:
    """Actual points in each target week: the most any manager could know."""
    scores: Scores = defaultdict(dict)
    target_gameweeks = range(as_of_gw, as_of_gw + horizon)
    for row in season.rows:
        if row.round in target_gameweeks:
            by_gameweek = scores[row.element]
            by_gameweek[row.round] = by_gameweek.get(row.round, 0.0) + row.total_points
    return dict(scores)


def _repeat(score_by_player: dict[int, float], as_of_gw: int, horizon: int) -> Scores:
    return {
        player_id: {gameweek: score for gameweek in range(as_of_gw, as_of_gw + horizon)}
        for player_id, score in score_by_player.items()
    }
