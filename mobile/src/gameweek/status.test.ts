import type { Fixture, Gameweek, GameweekCurrentResponse } from '../api/gameweekCurrent';
import {
  DEADLINE_REFRESH_SLACK_MS,
  LIVE_MATCH_WINDOW_MS,
  STATUS_REFRESH_MAX_MS,
  clubMatchStatuses,
  fixtureStatus,
  gameweekPhase,
  nextRefreshDelayMs,
} from './status';

const KICKOFF = Date.parse('2026-10-17T14:00:00Z');
const MINUTE_MS = 60 * 1000;

function fixture(
  id: number,
  home: string,
  away: string,
  kickoff: number | null,
  finished = false,
): Fixture {
  return {
    id,
    kickoff_time: kickoff == null ? null : new Date(kickoff).toISOString(),
    started: null,
    finished,
    home: { id, short_name: home, name: home, score: null },
    away: { id: id + 100, short_name: away, name: away, score: null },
  };
}

function gameweek(id: number, deadline: string): Gameweek {
  return {
    id,
    name: `Gameweek ${id}`,
    deadline_time: deadline,
    is_current: false,
    is_next: false,
    finished: false,
  };
}

const GW8 = gameweek(8, '2026-10-17T12:30:00Z');
const GW9 = gameweek(9, '2026-10-24T12:30:00Z');

function response(
  fixtures: Fixture[],
  next: Gameweek | null = GW9,
): GameweekCurrentResponse {
  return { schema_version: 1, gameweek: GW8, next_gameweek: next, fixtures };
}

describe('fixtureStatus', () => {
  it('is upcoming before kickoff and with no kickoff time', () => {
    expect(fixtureStatus(fixture(1, 'ARS', 'CHE', KICKOFF), KICKOFF - 1)).toBe(
      'upcoming',
    );
    expect(fixtureStatus(fixture(1, 'ARS', 'CHE', null), KICKOFF)).toBe('upcoming');
  });

  it('is live from kickoff until the window closes, then done', () => {
    const match = fixture(1, 'ARS', 'CHE', KICKOFF);
    expect(fixtureStatus(match, KICKOFF)).toBe('live');
    expect(fixtureStatus(match, KICKOFF + LIVE_MATCH_WINDOW_MS - 1)).toBe('live');
    expect(fixtureStatus(match, KICKOFF + LIVE_MATCH_WINDOW_MS)).toBe('done');
  });

  it('trusts finished even inside the live window', () => {
    expect(fixtureStatus(fixture(1, 'ARS', 'CHE', KICKOFF, true), KICKOFF)).toBe('done');
  });
});

describe('clubMatchStatuses', () => {
  it('marks both sides of each fixture', () => {
    const statuses = clubMatchStatuses(
      [fixture(1, 'ARS', 'CHE', KICKOFF), fixture(2, 'LIV', 'MCI', KICKOFF + 1)],
      KICKOFF,
    );
    expect(Object.fromEntries(statuses)).toEqual({
      ARS: 'live',
      CHE: 'live',
      LIV: 'upcoming',
      MCI: 'upcoming',
    });
  });

  it('keeps a double-gameweek club upcoming until its second match is played', () => {
    const fixtures = [
      fixture(1, 'ARS', 'CHE', KICKOFF, true),
      fixture(2, 'LIV', 'ARS', KICKOFF + 3 * LIVE_MATCH_WINDOW_MS),
    ];
    expect(clubMatchStatuses(fixtures, KICKOFF + LIVE_MATCH_WINDOW_MS).get('ARS')).toBe(
      'upcoming',
    );
  });

  it('prefers live over a finished first leg', () => {
    const second = KICKOFF + 3 * LIVE_MATCH_WINDOW_MS;
    const fixtures = [
      fixture(1, 'ARS', 'CHE', KICKOFF, true),
      fixture(2, 'LIV', 'ARS', second),
    ];
    expect(clubMatchStatuses(fixtures, second).get('ARS')).toBe('live');
  });
});

describe('gameweekPhase', () => {
  it('is live while any fixture is unplayed, counting played ones', () => {
    const fixtures = [
      fixture(1, 'ARS', 'CHE', KICKOFF, true),
      fixture(2, 'LIV', 'MCI', KICKOFF + LIVE_MATCH_WINDOW_MS),
    ];
    expect(gameweekPhase(response(fixtures), KICKOFF + LIVE_MATCH_WINDOW_MS)).toEqual({
      kind: 'live',
      gameweek: GW8,
      played: 1,
      total: 2,
    });
  });

  it('is live between the deadline and the first kickoff', () => {
    const phase = gameweekPhase(
      response([fixture(1, 'ARS', 'CHE', KICKOFF)]),
      KICKOFF - 1,
    );
    expect(phase).toMatchObject({ kind: 'live', played: 0, total: 1 });
  });

  it('counts down to the next deadline once every match is done', () => {
    const fixtures = [fixture(1, 'ARS', 'CHE', KICKOFF, true)];
    expect(gameweekPhase(response(fixtures), KICKOFF)).toEqual({
      kind: 'between',
      next: GW9,
    });
  });

  it('counts down pre-season, with no current gameweek', () => {
    const preseason = { ...response([]), gameweek: null, next_gameweek: GW8 };
    expect(gameweekPhase(preseason, KICKOFF)).toEqual({ kind: 'between', next: GW8 });
  });

  it('has nothing to show once the season is over', () => {
    const fixtures = [fixture(1, 'ARS', 'CHE', KICKOFF, true)];
    expect(gameweekPhase(response(fixtures, null), KICKOFF)).toEqual({ kind: 'none' });
  });
});

describe('nextRefreshDelayMs', () => {
  const nineDeadline = Date.parse(GW9.deadline_time);

  it('caps the wait when the deadline is far away', () => {
    expect(nextRefreshDelayMs(response([]), KICKOFF)).toBe(STATUS_REFRESH_MAX_MS);
  });

  it('refetches just after a deadline that is close', () => {
    const now = nineDeadline - 3 * MINUTE_MS;
    expect(nextRefreshDelayMs(response([]), now)).toBe(
      3 * MINUTE_MS + DEADLINE_REFRESH_SLACK_MS,
    );
  });

  it('never refetches sooner than the slack when the deadline looks passed', () => {
    expect(nextRefreshDelayMs(response([]), nineDeadline + MINUTE_MS)).toBe(
      DEADLINE_REFRESH_SLACK_MS,
    );
  });

  it('falls back to the cap after the final deadline', () => {
    expect(nextRefreshDelayMs(response([], null), KICKOFF)).toBe(STATUS_REFRESH_MAX_MS);
  });
});
