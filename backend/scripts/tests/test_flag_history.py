"""Flag history from the snapshot change log, worked out by hand."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from flag_history import (
    UNFLAGGED,
    DeadlineFlags,
    FlagState,
    FlagTimeline,
    PlayerWeek,
    flag_adjusted,
    flag_changes,
    last_daily_run,
    last_run,
    stale_at_deadline,
    summarize,
    time_changes,
)

PLAYER = 7
RUN_HOUR, RUN_MINUTE = 4, 30
DEADLINE = datetime(2026, 11, 6, 18, 30, tzinfo=timezone.utc)  # a Friday evening
INJURED = FlagState("i", 0)
DOUBTFUL = FlagState("d", 50)


def _row(snapshot: str, fields: dict, player_id: int | None = PLAYER) -> dict:
    return {"snapshot": snapshot, "player_id": player_id, "fields": fields}


ROWS = [
    _row("2026-11-01T00-00-00Z", {"status": "a", "chance_of_playing_next_round": None,
                                  "now_cost": 55}),
    _row("2026-11-03T12-00-00Z", {"now_cost": 56}),                       # price only
    _row("2026-11-06T10-00-00Z", {"status": "d", "chance_of_playing_next_round": 50}),
    _row("2026-11-06T15-00-00Z", {"status": "i", "chance_of_playing_next_round": 0}),
    _row("2026-11-07T00-00-00Z", {}, player_id=None),                     # quiet snapshot
]


def test_availability_and_flagged():
    assert UNFLAGGED.availability == 1.0 and not UNFLAGGED.flagged
    # A chance of 100 is FPL's default after a flag clears: available.
    assert FlagState("a", 100).availability == 1.0
    assert DOUBTFUL.availability == 0.5 and DOUBTFUL.flagged
    # Suspended with no chance given: not playing.
    assert FlagState("s", None).availability == 0.0


def test_flag_changes_skip_the_starting_state_and_price_moves():
    changes = flag_changes(ROWS)
    assert [(c.before, c.after) for c in changes] == [
        (UNFLAGGED, DOUBTFUL), (DOUBTFUL, INJURED)]
    assert all(c.material for c in changes)


def test_timeline_answers_what_the_flag_was_at_any_moment():
    timeline = FlagTimeline.of(ROWS)
    assert timeline.at(PLAYER, datetime(2026, 11, 5, tzinfo=timezone.utc)) == UNFLAGGED
    assert timeline.at(PLAYER, datetime(2026, 11, 6, 12, tzinfo=timezone.utc)) == DOUBTFUL
    assert timeline.at(PLAYER, DEADLINE) == INJURED
    assert timeline.at(99, DEADLINE) == UNFLAGGED


def test_last_daily_run_before_a_deadline():
    assert last_daily_run(DEADLINE, RUN_HOUR, RUN_MINUTE) == DEADLINE.replace(hour=4, minute=30)
    early = DEADLINE.replace(hour=3)
    assert last_daily_run(early, RUN_HOUR, RUN_MINUTE) == datetime(
        2026, 11, 5, 4, 30, tzinfo=timezone.utc)


def test_changes_after_the_last_run_are_too_late_for_the_app():
    timed = time_changes(flag_changes(ROWS), {10: DEADLINE}, RUN_HOUR, RUN_MINUTE)
    # Both changes came on deadline day, after the 04:30 run.
    assert [(t.gameweek, t.hours_before_deadline, t.after_last_run) for t in timed] == [
        (10, 8.5, True), (10, 3.5, True)]


def test_flag_adjusted_swaps_play_rate_for_the_chance():
    assert flag_adjusted(4.0, 0.8, DOUBTFUL) == pytest.approx(2.5)
    assert flag_adjusted(4.0, 0.8, UNFLAGGED) == 4.0
    assert flag_adjusted(4.0, 0.0, DOUBTFUL) == 0.0


def _week(flag_at_run, flag_at_deadline, predicted=4.0, actual=0) -> PlayerWeek:
    return PlayerWeek(PLAYER, 10, flag_at_run, flag_at_deadline, play_rate=0.8,
                      predicted=predicted, actual_points=actual, played=actual > 0)


def test_summarize_compares_errors_with_and_without_the_flag():
    weeks = [_week(UNFLAGGED, INJURED), _week(UNFLAGGED, DOUBTFUL, actual=2)]
    summary = summarize("flagged", weeks)
    # Without flags: |4 − 0| and |4 − 2|. With: injured → 0 (error 0),
    # doubtful → 2.5 (error 0.5).
    assert (summary.error_without_flags, summary.error_with_flags) == (3.0, 0.25)
    assert summarize("flagged", weeks, use_run_flag=True).error_with_flags == 3.0


def test_stale_when_the_flag_moved_after_the_run():
    assert stale_at_deadline(_week(UNFLAGGED, INJURED))
    assert not stale_at_deadline(_week(DOUBTFUL, DOUBTFUL))


TWO_RUNS = ((4, 30), (16, 0))


def test_last_run_is_the_latest_of_the_daily_runs():
    assert last_run(DEADLINE, TWO_RUNS) == DEADLINE.replace(hour=16, minute=0)
    morning = DEADLINE.replace(hour=11)
    assert last_run(morning, TWO_RUNS) == morning.replace(hour=4, minute=30)
    before_dawn = DEADLINE.replace(hour=2)
    assert last_run(before_dawn, TWO_RUNS) == datetime(2026, 11, 5, 16, tzinfo=timezone.utc)


def test_deadline_flags_are_the_flags_at_the_last_run_before_the_deadline():
    gameweek = 11
    rows = ROWS + [
        # After the 16:00 run, before the 18:30 deadline: too late for the app.
        _row("2026-11-06T17-00-00Z", {"status": "a", "chance_of_playing_next_round": None}),
    ]
    flags = DeadlineFlags(FlagTimeline.of(rows), {gameweek: DEADLINE}, TWO_RUNS)
    assert flags.flag(PLAYER, gameweek) == INJURED
    assert flags.flag(PLAYER + 1, gameweek) == UNFLAGGED

