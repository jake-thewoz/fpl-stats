import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  fetchGameweekCurrent,
  type GameweekCurrentResponse,
} from '../api/gameweekCurrent';
import { useFetch } from '../hooks/useFetch';
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
  const { state, onRefresh } = useFetch(fetchGameweekCurrent);

  // A failed refetch keeps the last good response on screen rather than
  // blanking the banner until the next attempt.
  const lastGood = useRef<GameweekCurrentResponse | null>(null);
  if (state.status === 'ok') lastGood.current = state.data;
  const data = lastGood.current;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state.status === 'loading') return;
    const delay =
      state.status === 'ok'
        ? nextRefreshDelayMs(state.data, Date.now())
        : STATUS_REFRESH_MAX_MS;
    const id = setTimeout(onRefresh, delay);
    return () => clearTimeout(id);
  }, [state, onRefresh]);

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
