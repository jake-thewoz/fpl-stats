import { requestJson } from './http';

/**
 * The FPL per-player stats beyond those on `/players`, served column-wise
 * by `/players/stats` so ~700 players × 34 stats stay small on the wire.
 * Each key is FPL's own field name. Prices are in £m; everything else is
 * FPL's unit.
 */
export const PLAYER_STAT_KEYS = [
  'event_points',
  'dreamteam_count',
  'ep_next',
  'expected_goal_involvements',
  'expected_goals_per_90',
  'expected_assists_per_90',
  'expected_goal_involvements_per_90',
  'penalties_missed',
  'goals_conceded',
  'goals_conceded_per_90',
  'expected_goals_conceded',
  'expected_goals_conceded_per_90',
  'clean_sheets_per_90',
  'saves',
  'saves_per_90',
  'penalties_saved',
  'own_goals',
  'tackles',
  'clearances_blocks_interceptions',
  'recoveries',
  'starts',
  'starts_per_90',
  'yellow_cards',
  'red_cards',
  'influence',
  'creativity',
  'threat',
  'transfers_in',
  'transfers_out',
  'transfers_in_event',
  'transfers_out_event',
  'cost_change_start',
  'value_form',
  'value_season',
] as const;

export type PlayerStatKey = (typeof PLAYER_STAT_KEYS)[number];

/** One player's stats. A stat is missing when the response lacked it. */
export type PlayerStatValues = Partial<Record<PlayerStatKey, number | null>>;

export type PlayerStatsResponse = {
  schema_version: number;
  fetched_at: string;
  count: number;
  /** Player ids; every `stats` column lines up with this list. */
  ids: number[];
  stats: Partial<Record<PlayerStatKey, (number | null)[]>>;
};

export async function fetchPlayerStats(
  signal?: AbortSignal,
): Promise<PlayerStatsResponse> {
  return requestJson<PlayerStatsResponse>('/players/stats', { signal });
}

/** Turns the column-wise response into one record per player id. */
export function indexPlayerStats(
  response: PlayerStatsResponse,
): Map<number, PlayerStatValues> {
  const byId = new Map<number, PlayerStatValues>();
  response.ids.forEach((id, index) => {
    const values: PlayerStatValues = {};
    for (const key of PLAYER_STAT_KEYS) {
      const column = response.stats[key];
      if (column !== undefined) values[key] = column[index] ?? null;
    }
    byId.set(id, values);
  });
  return byId;
}
