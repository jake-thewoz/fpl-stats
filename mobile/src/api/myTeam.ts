import { fetchEntry, type Entry } from './entry';
import {
  fetchEntryGameweek,
  PicksNotFoundError,
  type EntryGameweek,
} from './entryGameweek';
import { fetchPlayers, type Player } from './players';

export type MyTeamData = {
  entry: Entry;
  gameweek: number | null;
  picks: EntryGameweek | null;
  playersById: Record<number, Player>;
  // Populated when entry loads fine but picks for the current GW aren't
  // available yet (e.g. brand-new team, gameweek not started). Lets the UI
  // show bio + rank while explaining why the squad list is empty.
  picksError: string | null;
};

export async function fetchMyTeam(
  teamId: string,
  signal?: AbortSignal,
): Promise<MyTeamData> {
  const [entryResp, playersResp] = await Promise.all([
    fetchEntry(teamId, signal),
    fetchPlayers(signal),
  ]);

  const playersById: Record<number, Player> = {};
  for (const p of playersResp.players) playersById[p.id] = p;

  const gw = entryResp.entry.current_event;
  if (gw == null) {
    return {
      entry: entryResp.entry,
      gameweek: null,
      picks: null,
      playersById,
      picksError: null,
    };
  }

  try {
    const picksResp = await fetchEntryGameweek(teamId, gw, signal);
    return {
      entry: entryResp.entry,
      gameweek: gw,
      picks: picksResp.entry,
      playersById,
      picksError: null,
    };
  } catch (err) {
    if (err instanceof PicksNotFoundError) {
      return {
        entry: entryResp.entry,
        gameweek: gw,
        picks: null,
        playersById,
        picksError: err.message,
      };
    }
    throw err;
  }
}
