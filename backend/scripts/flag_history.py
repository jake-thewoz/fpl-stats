"""FPL injury and suspension flags over time, from the change log that
``spikes/archive_flag_history.py`` writes (#245). Pure: the CLI
``spikes/flag_history.py`` does the reading and printing.

A player's flag is FPL's ``status`` plus ``chance_of_playing_next_round``.
A chance of 100 is FPL's default for anyone recently flagged and then
cleared, so it counts the same as no chance at all: available.
"""
from __future__ import annotations

import gzip
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from schemas import Bootstrap, parse_fpl_datetime

AVAILABLE_STATUS = "a"
FULL_CHANCE = 100
PERCENT = 100
# How much a player's chance of playing must move for a change to count.
MATERIAL_CHANGE = 0.25
STATUS_FIELD = "status"
CHANCE_FIELD = "chance_of_playing_next_round"
SNAPSHOT_TIME_FORMAT = "%Y-%m-%dT%H-%M-%SZ"
SECONDS_PER_HOUR = 3600
# Written by spikes/archive_flag_history.py (gitignored).
CHANGE_LOG_PATH = Path(__file__).parent / "spikes" / "flag_history" / "changes.jsonl.gz"
# The xP analyzer's daily runs as (hour, minute) UTC: XP_DAILY_RUN and
# XP_PRE_DEADLINE_RUN in backend/lib/fpl-stats-stack.ts (#260).
XP_RUN_TIMES_UTC = ((4, 30), (16, 0))


def read_change_log(path: Path = CHANGE_LOG_PATH) -> list[dict]:
    """The flag change log's rows: one per player per snapshot that changed."""
    with gzip.open(path, "rt") as handle:
        return [json.loads(line) for line in handle]


@dataclass(frozen=True)
class FlagState:
    status: str | None
    chance: int | None

    @property
    def availability(self) -> float:
        """Chance of playing in 0..1: the stated chance if any, else 1 for
        an available player and 0 for anyone else (injured, suspended,
        unavailable, not in the squad)."""
        if self.chance is not None and self.chance < FULL_CHANCE:
            return self.chance / PERCENT
        return 1.0 if self.status in (AVAILABLE_STATUS, None) else 0.0

    @property
    def flagged(self) -> bool:
        return self.availability < 1.0


UNFLAGGED = FlagState(AVAILABLE_STATUS, None)


@dataclass(frozen=True)
class FlagChange:
    player_id: int
    time: datetime
    before: FlagState
    after: FlagState

    @property
    def material(self) -> bool:
        return abs(self.after.availability - self.before.availability) >= MATERIAL_CHANGE


def parse_snapshot_time(snapshot: str) -> datetime:
    return datetime.strptime(snapshot, SNAPSHOT_TIME_FORMAT).replace(tzinfo=timezone.utc)


def flag_changes(rows: Iterable[dict]) -> list[FlagChange]:
    """Every change of status or chance, in time order. A player's first
    row is his starting state, not a change."""
    state: dict[int, FlagState] = {}
    changes = []
    for row in sorted(rows, key=lambda r: r["snapshot"]):
        player_id, fields = row["player_id"], row["fields"]
        if player_id is None or (STATUS_FIELD not in fields and CHANCE_FIELD not in fields):
            continue
        before = state.get(player_id)
        after = FlagState(
            fields.get(STATUS_FIELD, before.status if before else None),
            fields[CHANCE_FIELD] if CHANCE_FIELD in fields else (before.chance if before else None),
        )
        state[player_id] = after
        if before is not None and before != after:
            changes.append(FlagChange(player_id, parse_snapshot_time(row["snapshot"]),
                                      before, after))
    return changes


@dataclass(frozen=True)
class FlagTimeline:
    """Each player's starting state and changes, to ask what his flag was
    at any moment."""

    start: dict[int, FlagState]
    changes_by_player: dict[int, list[FlagChange]]

    @classmethod
    def of(cls, rows: Iterable[dict]) -> FlagTimeline:
        rows = list(rows)
        start: dict[int, FlagState] = {}
        for row in sorted(rows, key=lambda r: r["snapshot"]):
            player_id, fields = row["player_id"], row["fields"]
            if player_id is not None and player_id not in start:
                start[player_id] = FlagState(fields.get(STATUS_FIELD), fields.get(CHANCE_FIELD))
        by_player: dict[int, list[FlagChange]] = defaultdict(list)
        for change in flag_changes(rows):
            by_player[change.player_id].append(change)
        return cls(start, dict(by_player))

    def at(self, player_id: int, moment: datetime) -> FlagState:
        state = self.start.get(player_id, UNFLAGGED)
        for change in self.changes_by_player.get(player_id, []):
            if change.time > moment:
                break
            state = change.after
        return state


def next_deadline(moment: datetime,
                  deadline_by_gameweek: dict[int, datetime]) -> tuple[int, datetime] | None:
    upcoming = [(deadline, gw) for gw, deadline in deadline_by_gameweek.items()
                if deadline > moment]
    if not upcoming:
        return None
    deadline, gameweek = min(upcoming)
    return gameweek, deadline


def last_daily_run(before: datetime, run_hour: int, run_minute: int) -> datetime:
    """The latest daily run (UTC) at or before ``before``."""
    run = before.replace(hour=run_hour, minute=run_minute, second=0, microsecond=0)
    return run if run <= before else run - timedelta(days=1)


def deadlines(bootstrap: Bootstrap) -> dict[int, datetime]:
    """Each gameweek's deadline (UTC)."""
    return {gw.id: parse_fpl_datetime(gw.deadline_time) for gw in bootstrap.gameweeks}


def last_run(before: datetime, run_times: Iterable[tuple[int, int]]) -> datetime:
    """The latest of several daily runs (UTC) at or before ``before``."""
    return max(last_daily_run(before, hour, minute) for hour, minute in run_times)


@dataclass(frozen=True)
class DeadlineFlags:
    """Each player's flag as the app saw it for a gameweek: at the last
    xP run before that gameweek's deadline."""

    timeline: FlagTimeline
    deadline_by_gameweek: dict[int, datetime]
    run_times: tuple[tuple[int, int], ...] = XP_RUN_TIMES_UTC

    def flag(self, player_id: int, gameweek: int) -> FlagState:
        run = last_run(self.deadline_by_gameweek[gameweek], self.run_times)
        return self.timeline.at(player_id, run)


@dataclass(frozen=True)
class TimedChange:
    change: FlagChange
    gameweek: int
    hours_before_deadline: float
    after_last_run: bool


def time_changes(changes: Iterable[FlagChange], deadline_by_gameweek: dict[int, datetime],
                 run_hour: int, run_minute: int) -> list[TimedChange]:
    """Each change with the next deadline, how long before it the change
    came, and whether it came after the last daily xP run before that
    deadline, i.e. too late for the app's numbers."""
    timed = []
    for change in changes:
        upcoming = next_deadline(change.time, deadline_by_gameweek)
        if upcoming is None:
            continue
        gameweek, deadline = upcoming
        timed.append(TimedChange(
            change=change,
            gameweek=gameweek,
            hours_before_deadline=(deadline - change.time).total_seconds() / SECONDS_PER_HOUR,
            after_last_run=change.time > last_daily_run(deadline, run_hour, run_minute),
        ))
    return timed


@dataclass(frozen=True)
class PlayerWeek:
    """One player's gameweek: his flag at the last xP run before the
    deadline and at the deadline, the play-rate prediction the replay
    makes without flags, and what happened."""

    player_id: int
    gameweek: int
    flag_at_run: FlagState
    flag_at_deadline: FlagState
    play_rate: float
    predicted: float
    actual_points: int
    played: bool


def flag_adjusted(predicted: float, play_rate: float, flag: FlagState) -> float:
    """The prediction with a flagged player's chance of playing in place
    of his play rate, as production's xP does. Points scale with the
    chance of playing, so a ratio is enough."""
    if not flag.flagged:
        return predicted
    if play_rate <= 0:
        return 0.0
    return predicted * flag.availability / play_rate


@dataclass(frozen=True)
class FlagSummary:
    label: str
    player_weeks: int
    mean_play_rate: float
    share_played: float
    mean_actual: float
    mean_predicted: float
    mean_flag_adjusted: float
    error_without_flags: float
    error_with_flags: float


def summarize(label: str, weeks: list[PlayerWeek], *, use_run_flag: bool = False) -> FlagSummary:
    """Mean absolute error of the play-rate prediction against the same
    prediction adjusted by the deadline flag (or the last run's flag)."""
    def adjusted(week: PlayerWeek, flag: FlagState) -> float:
        return flag_adjusted(week.predicted, week.play_rate, flag)

    count = len(weeks)
    flag_of = (lambda w: w.flag_at_run) if use_run_flag else (lambda w: w.flag_at_deadline)
    return FlagSummary(
        label=label,
        player_weeks=count,
        mean_play_rate=sum(w.play_rate for w in weeks) / count,
        share_played=sum(w.played for w in weeks) / count,
        mean_actual=sum(w.actual_points for w in weeks) / count,
        mean_predicted=sum(w.predicted for w in weeks) / count,
        mean_flag_adjusted=sum(adjusted(w, flag_of(w)) for w in weeks) / count,
        error_without_flags=sum(abs(w.predicted - w.actual_points) for w in weeks) / count,
        error_with_flags=sum(abs(adjusted(w, flag_of(w)) - w.actual_points)
                             for w in weeks) / count,
    )


def stale_at_deadline(week: PlayerWeek) -> bool:
    """The flag moved materially between the last xP run and the deadline."""
    return (abs(week.flag_at_deadline.availability - week.flag_at_run.availability)
            >= MATERIAL_CHANGE)
