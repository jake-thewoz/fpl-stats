import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gameweekCurrentQuery } from '../query/queries';
import {
  STATUS_REFRESH_MAX_MS,
  STATUS_TICK_MS,
  clubMatchStatuses,
  gameweekPhase,
  nextRefreshDelayMs,
  type GameweekPhase,
  type MatchStatus,
} from './status';

type GameweekStatus = {
  phase: GameweekPhase;
  /** Club short name → match status. Empty unless a gameweek is live, so
   *  players don't all carry a "played" tick for days between gameweeks. */
  clubStatuses: ReadonlyMap<string, MatchStatus>;
};

const NO_STATUS: GameweekStatus = { phase: { kind: 'none' }, clubStatuses: new Map() };

const GameweekStatusContext = createContext<GameweekStatus>(NO_STATUS);

/**
 * App-wide live-gameweek state for the banner and per-player match
 * status. Fetches `/gameweek/current` once for every tab, re-evaluates
 * against the clock each minute, and refetches just after the next
 * deadline (or every few minutes, whichever is sooner).
 */
export function GameweekStatusProvider({ children }: { children: ReactNode }) {
  // A failed refetch keeps the last good response (query data survives
  // errors) rather than blanking the banner until the next attempt.
  const { data, refetch, dataUpdatedAt, errorUpdatedAt } =
    useQuery(gameweekCurrentQuery());

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Re-armed after every fetch outcome: the update timestamps change on
  // each success or failure.
  useEffect(() => {
    const neverFetched = data === undefined && errorUpdatedAt === 0;
    if (neverFetched) return;
    const delay =
      data !== undefined ? nextRefreshDelayMs(data, Date.now()) : STATUS_REFRESH_MAX_MS;
    const id = setTimeout(() => refetch(), delay);
    return () => clearTimeout(id);
  }, [data, refetch, dataUpdatedAt, errorUpdatedAt]);

  const value = useMemo<GameweekStatus>(() => {
    if (data == null) return NO_STATUS;
    const phase = gameweekPhase(data, now);
    return {
      phase,
      clubStatuses:
        phase.kind === 'live' ? clubMatchStatuses(data.fixtures, now) : new Map(),
    };
  }, [data, now]);

  return (
    <GameweekStatusContext.Provider value={value}>
      {children}
    </GameweekStatusContext.Provider>
  );
}

export function useGameweekPhase(): GameweekPhase {
  return useContext(GameweekStatusContext).phase;
}

/** This gameweek's match status for a club, by short name. Undefined
 *  outside a live gameweek or when the club has no fixture. */
export function useClubMatchStatus(teamShort: string): MatchStatus | undefined {
  return useContext(GameweekStatusContext).clubStatuses.get(teamShort);
}
