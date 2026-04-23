import { fetchEntry, type Entry } from './entry';
import {
  fetchEntryGameweek,
  PicksNotFoundError,
  type EntryGameweek,
  type Pick,
} from './entryGameweek';
import { fetchGameweekLive } from './gameweekLive';
import { fetchPlayers, type Player } from './players';

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
};

export async function fetchMyTeam(
  teamId: string,
  signal?: AbortSignal,
): Promise<MyTeamData> {
  const [entryResp, playersResp] = await Promise.all([
    fetchEntry(teamId, signal),
    fetchPlayers(signal),
  ]);

  const playersById = new Map<number, Player>();
  for (const p of playersResp.players) playersById.set(p.id, p);

  const gw = entryResp.entry.current_event;
  if (gw == null) {
    return {
      entry: entryResp.entry,
      gameweek: null,
      picks: null,
      squad: [],
      picksError: null,
    };
  }

  // Picks + live scores in parallel — both keyed on the same gameweek.
  const [picksResult, liveResult] = await Promise.allSettled([
    fetchEntryGameweek(teamId, gw, signal),
    fetchGameweekLive(gw, signal),
  ]);

  if (picksResult.status === 'rejected') {
    const err = picksResult.reason;
    if (err instanceof PicksNotFoundError) {
      return {
        entry: entryResp.entry,
        gameweek: gw,
        picks: null,
        squad: [],
        picksError: err.message,
      };
    }
    throw err;
  }

  // If live data failed (e.g. pre-kickoff 404), we still render the squad
  // — GW points just come through as null and the UI shows "—".
  const livePointsById = new Map<number, { points: number; minutes: number }>();
  if (liveResult.status === 'fulfilled') {
    for (const el of liveResult.value.elements) {
      livePointsById.set(el.id, {
        points: el.total_points,
        minutes: el.minutes,
      });
    }
  }

  const picks = picksResult.value.entry;
  const squad: SquadEntry[] = picks.squad.map((pick) => {
    const live = livePointsById.get(pick.element);
    const raw = live?.points ?? null;
    return {
      pick,
      player: playersById.get(pick.element) ?? null,
      gwPointsRaw: raw,
      gwPoints: raw == null ? null : raw * pick.multiplier,
      minutes: live?.minutes ?? null,
      isStarter: pick.position <= 11,
    };
  });

  return {
    entry: entryResp.entry,
    gameweek: gw,
    picks,
    squad,
    picksError: null,
  };
}
