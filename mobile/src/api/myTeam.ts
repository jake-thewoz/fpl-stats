import type { Entry, EntryResponse } from './entry';
import {
  PicksNotFoundError,
  type EntryGameweek,
  type EntryGameweekResponse,
  type Pick,
} from './entryGameweek';
import type { GameweekLiveResponse } from './gameweekLive';
import type { Player, PlayersResponse } from './players';

export const FREE_HIT_CHIP = 'freehit';
const FIRST_GAMEWEEK = 1;
const STARTING_XI_SIZE = 11;

export type SquadEntry = {
  pick: Pick;
  player: Player | null;
  // Raw per-player points the player scored this gameweek, before the
  // captain multiplier.
  gwPointsRaw: number | null;
  // Points contribution = raw × multiplier. Sums to the team's GW total.
  gwPoints: number | null;
  minutes: number | null;
  isStarter: boolean;
};

export type MyTeamData = {
  entry: Entry;
  gameweek: number | null;
  picks: EntryGameweek | null;
  squad: SquadEntry[];
  // Populated when entry loads fine but picks for the current GW aren't
  // available yet (e.g. brand-new team, gameweek not started). Lets the UI
  // show bio + rank while explaining why the squad list is empty.
  picksError: string | null;
  // True when active_chip on the current GW is 'freehit' AND we successfully
  // fell back to last-GW picks for the squad list. Lets the UI explain
  // that the players shown are the persistent team, not the FH eleven.
  // False when no FH is active, or when the fallback fetch failed and we're
  // still showing the FH temporary squad.
  showingPersistentSquad: boolean;
};

/** What the assembler needs from each query: its data, if any, and its
 *  error, if the last fetch failed. TanStack's query results fit this. */
export type QuerySnapshot<T> = {
  data: T | undefined;
  error: Error | null;
};

export type MyTeamSources = {
  entry: QuerySnapshot<EntryResponse>;
  players: QuerySnapshot<PlayersResponse>;
  picks: QuerySnapshot<EntryGameweekResponse>;
  live: QuerySnapshot<GameweekLiveResponse>;
  /** Previous gameweek's picks, only consulted when Free Hit is active. */
  previousPicks: QuerySnapshot<EntryGameweekResponse>;
};

function isSettled<T>(snapshot: QuerySnapshot<T>): boolean {
  return snapshot.data !== undefined || snapshot.error != null;
}

/** Whether the previous gameweek's picks are needed to show the user's
 *  persistent squad: true when Free Hit is active this gameweek. */
export function needsPreviousPicks(
  picks: EntryGameweekResponse | undefined,
  gameweek: number,
): boolean {
  return picks?.entry.active_chip === FREE_HIT_CHIP && gameweek > FIRST_GAMEWEEK;
}

/**
 * Builds the My Team view from its cached endpoint responses. Returns
 * `undefined` while a required response is still loading, or when one
 * failed in a way the screen can't recover from (the caller surfaces
 * that query's error).
 */
export function assembleMyTeam(sources: MyTeamSources): MyTeamData | undefined {
  const entry = sources.entry.data?.entry;
  const players = sources.players.data?.players;
  if (entry === undefined || players === undefined) return undefined;

  const gw = entry.current_event;
  if (gw == null) {
    return {
      entry,
      gameweek: null,
      picks: null,
      squad: [],
      picksError: null,
      showingPersistentSquad: false,
    };
  }

  const picksResponse = sources.picks.data;
  if (picksResponse === undefined) {
    const err = sources.picks.error;
    if (err instanceof PicksNotFoundError) {
      return {
        entry,
        gameweek: gw,
        picks: null,
        squad: [],
        picksError: err.message,
        showingPersistentSquad: false,
      };
    }
    return undefined;
  }

  // If live data failed (e.g. pre-kickoff 404), we still render the squad
  // — GW points just come through as null and the UI shows "—".
  if (!isSettled(sources.live)) return undefined;
  const livePointsById = new Map<number, { points: number; minutes: number }>();
  for (const el of sources.live.data?.elements ?? []) {
    livePointsById.set(el.id, { points: el.total_points, minutes: el.minutes });
  }

  const picks = picksResponse.entry;

  // Free Hit fallback: when FH is active in the current GW, the picks
  // endpoint returns the temporary FH eleven, not the user's persistent
  // squad. That makes "browse my real team" impossible without auth.
  // Workaround: use the previous GW's picks for the squad list. We keep
  // the original ``picks`` (with active_chip='freehit') so the banner
  // still surfaces FH state.
  //
  // Caveat: this won't reflect transfers the user made between gw-1 and
  // FH activation. Most users don't transfer-then-FH, and the banner
  // makes the data source explicit ("showing your team from last
  // gameweek"), so this is acceptable for v1.
  let squadPicks: Pick[] = picks.squad;
  let showingPersistentSquad = false;
  if (needsPreviousPicks(picksResponse, gw)) {
    if (!isSettled(sources.previousPicks)) return undefined;
    // A failed previous-GW fetch (404, network) falls back to the FH
    // temporary squad. The banner still explains the state.
    const previous = sources.previousPicks.data;
    if (previous !== undefined) {
      squadPicks = previous.entry.squad;
      showingPersistentSquad = true;
    }
  }

  const playersById = new Map<number, Player>();
  for (const p of players) playersById.set(p.id, p);

  const squad: SquadEntry[] = squadPicks.map((pick) => {
    const live = livePointsById.get(pick.element);
    const raw = live?.points ?? null;
    return {
      pick,
      player: playersById.get(pick.element) ?? null,
      gwPointsRaw: raw,
      gwPoints: raw == null ? null : raw * pick.multiplier,
      minutes: live?.minutes ?? null,
      isStarter: pick.position <= STARTING_XI_SIZE,
    };
  });

  return {
    entry,
    gameweek: gw,
    picks,
    squad,
    picksError: null,
    showingPersistentSquad,
  };
}
