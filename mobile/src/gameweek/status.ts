/**
 * Live-gameweek state derived from `/gameweek/current` plus the clock.
 *
 * Match status comes from kickoff time, not FPL's `started` / `finished`
 * flags, which reach our cache only every 30 minutes. A match counts as
 * live from kickoff until `LIVE_MATCH_WINDOW_MS` later, mirroring the
 * backend's `match_window.LIVE_WINDOW`. `finished` is still honoured,
 * since it only flips after the match is over.
 */
import type { Fixture, Gameweek, GameweekCurrentResponse } from '../api/gameweekCurrent';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Kickoff to full time plus stoppages, with margin for delays. */
export const LIVE_MATCH_WINDOW_MS = 2 * HOUR_MS;
/** How often derived statuses are re-evaluated against the clock. */
export const STATUS_TICK_MS = MINUTE_MS;
/** Upper bound between refetches, so a deadline rollover or a late
 *  `finished` flag is picked up even without a deadline to aim at. */
export const STATUS_REFRESH_MAX_MS = 10 * MINUTE_MS;
/** Refetch this long after a deadline, giving the backend's clock-based
 *  current-GW switch a moment of slack. */
export const DEADLINE_REFRESH_SLACK_MS = MINUTE_MS;

export type MatchStatus = 'upcoming' | 'live' | 'done';

export type GameweekPhase =
  | { kind: 'live'; gameweek: Gameweek; played: number; total: number }
  | { kind: 'between'; next: Gameweek }
  | { kind: 'none' };

export function fixtureStatus(fixture: Fixture, now: number): MatchStatus {
  if (fixture.finished) return 'done';
  if (fixture.kickoff_time == null) return 'upcoming';
  const kickoff = Date.parse(fixture.kickoff_time);
  if (Number.isNaN(kickoff) || now < kickoff) return 'upcoming';
  return now < kickoff + LIVE_MATCH_WINDOW_MS ? 'live' : 'done';
}

/** A club with two fixtures this GW is live if either is, otherwise
 *  upcoming while any match is left, and done only when all are. */
const STATUS_PRECEDENCE: readonly MatchStatus[] = ['live', 'upcoming', 'done'];

/** Each club's match status this gameweek, keyed by short name (the
 *  form `Player.team` uses). Clubs without a fixture are absent. */
export function clubMatchStatuses(
  fixtures: readonly Fixture[],
  now: number,
): Map<string, MatchStatus> {
  const statuses = new Map<string, MatchStatus>();
  for (const fixture of fixtures) {
    const status = fixtureStatus(fixture, now);
    for (const side of [fixture.home, fixture.away]) {
      if (side.short_name == null) continue;
      const existing = statuses.get(side.short_name);
      if (
        existing == null ||
        STATUS_PRECEDENCE.indexOf(status) < STATUS_PRECEDENCE.indexOf(existing)
      ) {
        statuses.set(side.short_name, status);
      }
    }
  }
  return statuses;
}

/** Live from the current GW's deadline until its last match is done;
 *  otherwise counting down to the next deadline, if there is one. */
export function gameweekPhase(data: GameweekCurrentResponse, now: number): GameweekPhase {
  const { gameweek, fixtures } = data;
  if (gameweek != null && fixtures.length > 0) {
    const played = fixtures.filter((f) => fixtureStatus(f, now) === 'done').length;
    if (played < fixtures.length) {
      return { kind: 'live', gameweek, played, total: fixtures.length };
    }
  }
  if (data.next_gameweek != null) return { kind: 'between', next: data.next_gameweek };
  return { kind: 'none' };
}

/** Delay until the next refetch: just after the next deadline, so the
 *  banner flips to live on time, capped at `STATUS_REFRESH_MAX_MS`. The
 *  slack doubles as a floor, so a device clock running ahead of the
 *  server's can't spin a refetch loop around a deadline. */
export function nextRefreshDelayMs(data: GameweekCurrentResponse, now: number): number {
  const deadline = data.next_gameweek
    ? Date.parse(data.next_gameweek.deadline_time)
    : NaN;
  if (Number.isNaN(deadline)) return STATUS_REFRESH_MAX_MS;
  const untilDeadline = deadline - now + DEADLINE_REFRESH_SLACK_MS;
  return Math.max(
    DEADLINE_REFRESH_SLACK_MS,
    Math.min(untilDeadline, STATUS_REFRESH_MAX_MS),
  );
}
