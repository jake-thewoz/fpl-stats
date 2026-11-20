"""Chips for the season replay: each season's real chip rules, and chip
policies that decide which chip, if any, to play each gameweek.

- ``no_chips``: the baseline.
- ``SimpleRules``: bench boost when the squad has the most fixtures in
  view, triple captain when the likely captain plays twice, free hit
  when the squad has the fewest fixtures, wildcard at a fixed week.
- ``best_chip_schedule``: the ``hindsight_chips`` ceiling. It knows the
  actual points, so it is a measure of what timing could be worth, not
  a strategy anyone can follow.

The archive's fixture list is the final one: doubles and blanks look
known from August. ``SimpleRules`` sees only ``FIXTURE_LOOKAHEAD_GAMEWEEKS``
ahead, roughly when FPL announces them.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from season_data import SeasonData
from season_replay import (
    BENCH_BOOST,
    FREE_HIT,
    TRIPLE_CAPTAIN,
    WILDCARD,
    ChipState,
    ChipWindow,
    ReplayConfig,
    SQUAD_CHIPS,
    ReplayResult,
    Scorer,
    archive_player,
    run_replay,
)

NO_CHIPS = "no_chips"
SIMPLE_RULES = "simple_rules"
HINDSIGHT_CHIPS = "hindsight_chips"

FIXTURE_LOOKAHEAD_GAMEWEEKS = 4
LAST_GAMEWEEK = 38
# Played this far through its window, as a fraction of the window's length.
SIMPLE_WILDCARD_WINDOW_FRACTION = 0.5
# Squad fixtures above one each (15) before bench boost is worth playing.
BENCH_BOOST_MIN_EXTRA_FIXTURES = 2
# Squad fixtures below one each before a free hit is worth playing.
FREE_HIT_MIN_MISSING_FIXTURES = 3
TRIPLE_CAPTAIN_MIN_FIXTURES = 2
# When several chips want the same week, the first listed wins.
CHIP_PRIORITY = (WILDCARD, FREE_HIT, BENCH_BOOST, TRIPLE_CAPTAIN)
SCORING_CHIPS = (BENCH_BOOST, TRIPLE_CAPTAIN)

_FIRST_HALF_END = 19
_FREE_HIT_FIRST_GAMEWEEK = 2

# Checked against FPL's announcements for each season.
CHIP_WINDOWS_BY_SEASON: dict[str, tuple[ChipWindow, ...]] = {
    # First wildcard until the GW20 deadline, second from then on; one
    # each of free hit, bench boost and triple captain all season.
    "2023-24": (
        ChipWindow(WILDCARD, 1, 20),
        ChipWindow(WILDCARD, 21, LAST_GAMEWEEK),
        ChipWindow(FREE_HIT, _FREE_HIT_FIRST_GAMEWEEK, LAST_GAMEWEEK),
        ChipWindow(BENCH_BOOST, 1, LAST_GAMEWEEK),
        ChipWindow(TRIPLE_CAPTAIN, 1, LAST_GAMEWEEK),
    ),
    # As 2023-24 but the wildcards split at the GW19 deadline. The
    # Assistant Manager chip (GW24 on) is not modelled.
    "2024-25": (
        ChipWindow(WILDCARD, 1, _FIRST_HALF_END),
        ChipWindow(WILDCARD, _FIRST_HALF_END + 1, LAST_GAMEWEEK),
        ChipWindow(FREE_HIT, _FREE_HIT_FIRST_GAMEWEEK, LAST_GAMEWEEK),
        ChipWindow(BENCH_BOOST, 1, LAST_GAMEWEEK),
        ChipWindow(TRIPLE_CAPTAIN, 1, LAST_GAMEWEEK),
    ),
    # Two of every chip: one set up to the GW19 deadline, one after.
    "2025-26": tuple(
        window
        for chip in CHIP_PRIORITY
        for window in (
            ChipWindow(chip, _FREE_HIT_FIRST_GAMEWEEK if chip == FREE_HIT else 1,
                       _FIRST_HALF_END),
            ChipWindow(chip, _FIRST_HALF_END + 1, LAST_GAMEWEEK),
        )
    ),
}


def no_chips(state: ChipState) -> str | None:
    return None


def squad_fixture_counts(state: ChipState, gameweek: int) -> dict[int, int]:
    """player_id -> fixtures in ``gameweek`` for each squad player, by
    his club now."""
    fixtures_by_club: Counter[int] = Counter()
    for fixture in state.season.fixtures:
        if fixture.event == gameweek:
            fixtures_by_club[fixture.team_h] += 1
            fixtures_by_club[fixture.team_a] += 1
    return {
        player_id: fixtures_by_club[archive_player(state.season, player_id, state.gameweek).team]
        for player_id in state.squad
    }


@dataclass(frozen=True)
class SimpleRules:
    """One-glance chip rules a casual manager might follow. Each chip
    left unplayed near the end of its window is played anyway, so none
    is wasted."""

    lookahead: int = FIXTURE_LOOKAHEAD_GAMEWEEKS

    def __call__(self, state: ChipState) -> str | None:
        playable = [chip for chip in CHIP_PRIORITY if state.playable_window(chip)]
        if not playable:
            return None
        forced = self._forced(state, playable)
        if forced:
            return forced
        for chip in playable:
            if self._wants(state, chip):
                return chip
        return None

    def _wants(self, state: ChipState, chip: str) -> bool:
        window = state.playable_window(chip)
        assert window is not None
        visible = [
            week for week in range(state.gameweek, state.gameweek + self.lookahead)
            if window.contains(week)
        ]
        squad_size = sum(state.rules.squad_size_by_position.values())
        if chip == WILDCARD:
            first = max(window.first_gameweek, state.start_gameweek + 1)
            return state.gameweek == first + int(
                (window.last_gameweek - first) * SIMPLE_WILDCARD_WINDOW_FRACTION)
        fixtures_by_week = {
            week: sum(squad_fixture_counts(state, week).values()) for week in visible
        }
        this_week = fixtures_by_week[state.gameweek]
        if chip == BENCH_BOOST:
            return (this_week >= squad_size + BENCH_BOOST_MIN_EXTRA_FIXTURES
                    and this_week == max(fixtures_by_week.values()))
        if chip == FREE_HIT:
            return (this_week <= squad_size - FREE_HIT_MIN_MISSING_FIXTURES
                    and this_week == min(fixtures_by_week.values()))
        captain = max(state.squad,
                      key=lambda p: (state.scores.get(p, {}).get(state.gameweek, 0.0), -p))
        captain_fixtures = {
            week: squad_fixture_counts(state, week)[captain] for week in visible
        }
        return (captain_fixtures[state.gameweek] >= TRIPLE_CAPTAIN_MIN_FIXTURES
                and captain_fixtures[state.gameweek] == max(captain_fixtures.values()))

    @staticmethod
    def _forced(state: ChipState, playable: list[str]) -> str | None:
        """A chip that must be played now: there are no more weeks left
        before its window closes than chips still waiting in it."""
        for chip in playable:
            window = state.playable_window(chip)
            assert window is not None
            waiting = sum(
                1 for other in state.unplayed
                if other.contains(state.gameweek)
                and other.last_gameweek <= window.last_gameweek
            )
            if window.last_gameweek - state.gameweek + 1 <= waiting:
                return chip
        return None


@dataclass(frozen=True)
class ScheduledChips:
    """Plays ``chip_by_gameweek`` exactly; used by the hindsight search."""

    chip_by_gameweek: dict[int, str]

    def __call__(self, state: ChipState) -> str | None:
        return self.chip_by_gameweek.get(state.gameweek)


def best_chip_schedule(
    season: SeasonData, scorer: Scorer, config: ReplayConfig,
) -> tuple[dict[int, str], ReplayResult]:
    """The ``hindsight_chips`` ceiling: each chip in turn (wildcards,
    then free hits, then bench boost and triple captain) goes in the
    legal week that adds the most actual points, given the chips already
    placed, or is left unplayed if no week adds any.

    Squad chips change every week after them, so each candidate week is
    a full replay. Bench boost and triple captain don't change the
    squad, so their gain in a week is read off one replay: the bench's
    points and the captain's points. One chip at a time, so it is a
    strong ceiling rather than a proven maximum."""
    def replay(schedule: dict[int, str]) -> ReplayResult:
        return run_replay(season, scorer,
                          replace(config, chip_policy=ScheduledChips(dict(schedule))))

    schedule: dict[int, str] = {}
    best = replay(schedule)
    windows = sorted(config.chip_windows, key=lambda w: (_chip_rank(w.chip), w.first_gameweek))
    for window in windows:
        if window.chip not in SQUAD_CHIPS:
            continue
        best_week = None
        for week in _open_weeks(window, schedule, config, best):
            trial = replay(schedule | {week: window.chip})
            if trial.total_points > best.total_points:
                best, best_week = trial, week
        if best_week is not None:
            schedule[best_week] = window.chip

    for window in windows:
        if window.chip not in SCORING_CHIPS:
            continue
        gain_by_week = {
            week.gameweek: _scoring_chip_gain(window.chip, week.bench_points, week.captain_bonus)
            for week in best.gameweeks
            if window.contains(week.gameweek) and week.gameweek not in schedule
        }
        if gain_by_week and max(gain_by_week.values()) > 0:
            week = max(gain_by_week, key=lambda w: (gain_by_week[w], -w))
            schedule[week] = window.chip
    return schedule, replay(schedule)


def chip_gains(
    season: SeasonData, scorer: Scorer, config: ReplayConfig, result: ReplayResult,
) -> dict[int, int]:
    """gameweek -> points the chip played that week added: the total
    minus the total of the same season with that one chip left out."""
    played = result.chips_played
    gains = {}
    for week in played:
        without = {w: chip for w, chip in played.items() if w != week}
        other = run_replay(season, scorer, replace(config, chip_policy=ScheduledChips(without)))
        gains[week] = result.total_points - other.total_points
    return gains


def _scoring_chip_gain(chip: str, bench_points: int, captain_bonus: int) -> int:
    """With the normal captain bonus equal to his points, triple captain
    adds that again; bench boost adds what the bench scored."""
    return bench_points if chip == BENCH_BOOST else captain_bonus


def _open_weeks(window: ChipWindow, schedule: dict[int, str], config: ReplayConfig,
                result: ReplayResult) -> list[int]:
    return [
        week.gameweek for week in result.gameweeks
        if window.contains(week.gameweek)
        and week.gameweek > config.start_gameweek
        and week.gameweek not in schedule
        and not (window.chip == FREE_HIT and FREE_HIT in (
            schedule.get(week.gameweek - 1), schedule.get(week.gameweek + 1)))
    ]


def _chip_rank(chip: str) -> int:
    return CHIP_PRIORITY.index(chip)
