import { API_BASE_URL } from '../config';

export type Player = {
  id: number;
  name: string;
  team: string;
  position: string;
  total_points: number;
  form: string;
  price: number;
  // Official FPL stats (added in #102). Each is nullable — older cached
  // bootstrap rows or legacy responses won't include them. Numeric strings
  // on the FPL side are parsed to float at the backend boundary; price-like
  // values arrive in £m.
  defcon: number | null;
  defcon_per_90: number | null;
  selected_by_percent: number | null;
  points_per_game: number | null;
  minutes: number | null;
  goals_scored: number | null;
  assists: number | null;
  clean_sheets: number | null;
  bonus: number | null;
  bps: number | null;
  ict_index: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  /** Cost change this gameweek, in £m units (e.g. 0.1 = +£0.1m). */
  cost_change_event: number | null;
};

export type PlayersResponse = {
  schema_version: number;
  count: number;
  players: Player[];
};

export async function fetchPlayers(signal?: AbortSignal): Promise<PlayersResponse> {
  const res = await fetch(`${API_BASE_URL}/players`, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as PlayersResponse;
}
