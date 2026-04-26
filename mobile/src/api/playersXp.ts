import { API_BASE_URL } from '../config';

/** One row from the player-xp analyzer's output. */
export type PlayerXp = {
  player_id: number;
  web_name: string;
  team_id: number;
  position_id: number;
  xp: number;
};

export type PlayersXpResponse = {
  schema_version: number | null;
  /** Same value across every row in a run; lifted to top level. */
  computed_at: string | null;
  /** GW the projection covers. */
  gameweek: number | null;
  players: PlayerXp[];
};

export async function fetchPlayersXp(
  signal?: AbortSignal,
): Promise<PlayersXpResponse> {
  const res = await fetch(`${API_BASE_URL}/analytics/players/xp`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PlayersXpResponse;
}
