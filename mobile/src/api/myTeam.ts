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
  // True when active_chip on the current GW is 'freehit' AND we successfully
  // fell back to last-GW picks for the squad list. Lets the UI explain
  // that the players shown are the persistent team, not the FH eleven.
  // False when no FH is active, or when the fallback fetch failed and we're
  // still showing the FH temporary squad.
  showingPersistentSquad: boolean;
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
      showingPersistentSquad: false,
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
        showingPersistentSquad: false,
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

  // Free Hit fallback: when FH is active in the current GW, the picks
  // endpoint returns the temporary FH eleven, not the user's persistent
  // squad. That makes "browse my real team" impossible without auth.
  // Workaround: if we detect FH and there's a previous GW to fall back
  // to, refetch picks for ``gw - 1`` and use those for the squad list.
  // We keep the original ``picks`` (with active_chip='freehit') so the
  // banner still surfaces FH state.
  //
  // Caveat: this won't reflect transfers the user made between gw-1 and
  // FH activation. Most users don't transfer-then-FH, and the banner
  // makes the data source explicit ("showing your team from last
  // gameweek"), so this is acceptable for v1.
  let squadPicks: Pick[] = picks.squad;
  let showingPersistentSquad = false;
  if (picks.active_chip === 'freehit' && gw > 1) {
    try {
      const fallback = await fetchEntryGameweek(teamId, gw - 1, signal);
      squadPicks = fallback.entry.squad;
      showingPersistentSquad = true;
    } catch {
      // Couldn't fetch the previous-GW picks (404, network) — fall back
      // to the FH temporary squad. The banner still explains the state.
    }
  }

  const squad: SquadEntry[] = squadPicks.map((pick) => {
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
    showingPersistentSquad,
  };
}
