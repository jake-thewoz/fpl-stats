"""CLI: when do FPL's injury flags change, and what are they worth? (#245)

Reads the change log from ``archive_flag_history.py`` and this season's
results from the cache table, then prints:

1. Flag changes per gameweek: how many came in the last day before the
   deadline, and how many after the last daily xP run, too late for the
   app's numbers.
2. What a flag is worth: the replay's play-rate prediction against the
   same prediction with the deadline flag's chance of playing.
3. Stale flags: player-weeks whose flag moved between the last xP run and
   the deadline, scored with the run's flag and the deadline's.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 spikes/archive_flag_history.py    # refresh the change log first
    python3 spikes/flag_history.py
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(_SCRIPTS_DIR.parent / "layers" / "fpl_schemas" / "python"))
sys.path.insert(0, str(_SCRIPTS_DIR))

from data import cache_table, load_bootstrap  # noqa: E402
from flag_history import (  # noqa: E402
    FlagSummary,
    FlagTimeline,
    PlayerWeek,
    deadlines,
    flag_changes,
    last_daily_run,
    read_change_log,
    stale_at_deadline,
    summarize,
    time_changes,
)
from replay_predictions import FplDifficultyStrength, predict_horizon  # noqa: E402
from season_archive import load_current_season  # noqa: E402
from xp_v2 import load_default_coefficients  # noqa: E402
from xp_v2_features import FeatureWindow, load_default_priors, season_play_rate  # noqa: E402

# The daily xP analyzer's schedule (AnalyzePlayerXpV2Schedule in the stack), UTC.
XP_RUN_HOUR = 4
XP_RUN_MINUTE = 30
LAST_DAY_HOURS = 24
# Play rates need a few gameweeks of minutes before they mean anything.
FIRST_SCORED_GAMEWEEK = 3
SINGLE_GAMEWEEK = 1
REGULAR_PLAY_RATE = 0.5
AVAILABILITY_BUCKETS = (0.0, 0.25, 0.5, 0.75)


def _summary_row(summary: FlagSummary) -> str:
    return (f"| {summary.label} | {summary.player_weeks} | {summary.mean_play_rate:.2f} | "
            f"{summary.share_played:.0%} | {summary.mean_actual:.2f} | "
            f"{summary.mean_predicted:.2f} | {summary.mean_flag_adjusted:.2f} | "
            f"{summary.error_without_flags:.2f} | {summary.error_with_flags:.2f} |")


SUMMARY_HEADER = (
    "| player-weeks | n | play rate | played | actual pts | predicted | with flag | "
    "error without flag | error with flag |\n|---|---|---|---|---|---|---|---|---|"
)


def main() -> int:
    rows = read_change_log()
    table = cache_table()
    deadline_by_gameweek = deadlines(load_bootstrap(table))
    season = load_current_season(table)
    last_round = max(row.round for row in season.rows)

    timed = [t for t in time_changes(flag_changes(rows), deadline_by_gameweek,
                                     XP_RUN_HOUR, XP_RUN_MINUTE)
             if t.change.material and t.gameweek <= last_round + 1]
    print(f"# Flag history — {season.season}\n")
    print(f"Material changes: chance of playing moved by 25 points or more. "
          f"xP runs daily at {XP_RUN_HOUR:02d}:{XP_RUN_MINUTE:02d} UTC.\n")
    print("| GW | material changes | in the last 24h | after the last xP run |")
    print("|---|---|---|---|")
    by_gameweek: dict[int, list] = defaultdict(list)
    for item in timed:
        by_gameweek[item.gameweek].append(item)
    for gameweek in sorted(by_gameweek):
        items = by_gameweek[gameweek]
        print(f"| {gameweek} | {len(items)} | "
              f"{sum(i.hours_before_deadline <= LAST_DAY_HOURS for i in items)} | "
              f"{sum(i.after_last_run for i in items)} |")
    print(f"| **all** | {len(timed)} | "
          f"{sum(i.hours_before_deadline <= LAST_DAY_HOURS for i in timed)} | "
          f"{sum(i.after_last_run for i in timed)} |\n")

    timeline = FlagTimeline.of(rows)
    actual: dict[tuple[int, int], tuple[int, int]] = defaultdict(lambda: (0, 0))
    for row in season.rows:
        points, minutes = actual[(row.element, row.round)]
        actual[(row.element, row.round)] = (points + row.total_points, minutes + row.minutes)
    minutes_before: dict[tuple[int, int], int] = defaultdict(int)
    for (player_id, round_number), (_, minutes) in actual.items():
        for later in range(round_number + 1, last_round + 1):
            minutes_before[(player_id, later)] += minutes

    weeks: list[PlayerWeek] = []
    coefs, priors, window = load_default_coefficients(), load_default_priors(), FeatureWindow()
    for gameweek in range(FIRST_SCORED_GAMEWEEK, last_round + 1):
        deadline = deadline_by_gameweek[gameweek]
        run = last_daily_run(deadline, XP_RUN_HOUR, XP_RUN_MINUTE)
        predictions = predict_horizon(season, gameweek, SINGLE_GAMEWEEK, coefs, priors, window,
                                      FplDifficultyStrength())
        for player_id, by_gameweek in predictions.items():
            points, minutes = actual[(player_id, gameweek)]
            weeks.append(PlayerWeek(
                player_id=player_id, gameweek=gameweek,
                flag_at_run=timeline.at(player_id, run),
                flag_at_deadline=timeline.at(player_id, deadline),
                play_rate=season_play_rate(season_minutes=minutes_before[(player_id, gameweek)],
                                           gws_completed=gameweek - 1),
                predicted=by_gameweek[gameweek], actual_points=points, played=minutes > 0,
            ))

    flagged = [w for w in weeks if w.flag_at_deadline.flagged]
    print(f"## What a flag is worth (GW{FIRST_SCORED_GAMEWEEK}–{last_round})\n")
    print(SUMMARY_HEADER)
    print(_summary_row(summarize("unflagged at deadline",
                                 [w for w in weeks if not w.flag_at_deadline.flagged])))
    print(_summary_row(summarize("flagged at deadline", flagged)))
    print(_summary_row(summarize(
        f"flagged, play rate ≥ {REGULAR_PLAY_RATE}",
        [w for w in flagged if w.play_rate >= REGULAR_PLAY_RATE])))
    for availability in AVAILABILITY_BUCKETS:
        bucket = [w for w in flagged if w.flag_at_deadline.availability == availability]
        if bucket:
            print(_summary_row(summarize(f"chance {availability:.0%}", bucket)))
    total_without = sum(abs(w.predicted - w.actual_points) for w in flagged)
    total_with = summarize("", flagged).error_with_flags * len(flagged)
    print(f"\nAcross flagged player-weeks, flags cut total absolute error by "
          f"{total_without - total_with:.0f} points "
          f"({len(flagged) / (last_round - FIRST_SCORED_GAMEWEEK + 1):.0f} flagged players "
          f"a gameweek).\n")

    stale = [w for w in weeks if stale_at_deadline(w)]
    print("## Flags that changed after the last xP run\n")
    if not stale:
        print("None.")
        return 0
    print(SUMMARY_HEADER)
    print(_summary_row(summarize("with the last run's flag", stale, use_run_flag=True)))
    print(_summary_row(summarize("with the deadline's flag", stale)))
    print(f"\n{len(stale)} player-weeks over "
          f"{last_round - FIRST_SCORED_GAMEWEEK + 1} gameweeks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
