import { API_BASE_URL } from '../config';

/** One row from the player-xp analyzer's output. */
export type PlayerXp = {
  player_id: number;
  web_name: string;
  team_id: number;
  position_id: number;
  /** Projected expected points for the upcoming GW (1 fixture). */
  xp: number;
  /** Sum of next 3 GWs of expected points. Null when the writer didn't
   *  store horizon data on this row (legacy / blank-GW edge cases). */
  xp_h3: number | null;
  /** Sum of next 5 GWs of expected points. End-of-season-clamped to
   *  the GWs actually remaining. Null in the same cases as xp_h3. */
  xp_h5: number | null;
};

export type PlayersXpResponse = {
  schema_version: number | null;
  /** Same value across every row in a run; lifted to top level. */
  computed_at: string | null;
  /** Next GW the projection's `xp` field covers. */
  gameweek: number | null;
  /** GW ids the horizon sums cover, ordered ascending. xp_h3 sums
   *  the first 3 entries; xp_h5 sums the first 5 (or fewer if the
   *  season has fewer GWs left). */
  horizon_gw_ids: number[];
  players: PlayerXp[];
};

export async function fetchPlayersXp(
  signal?: AbortSignal,
): Promise<PlayersXpResponse> {
  const res = await fetch(`${API_BASE_URL}/analytics/players/xp`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PlayersXpResponse;
}
