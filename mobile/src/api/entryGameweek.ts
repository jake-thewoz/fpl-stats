import { API_BASE_URL } from '../config';

export type Pick = {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
};

export type EntryGameweek = {
  team_id: number;
  gameweek: number;
  points: number | null;
  total_points: number | null;
  bank: number | null;
  value: number | null;
  event_transfers: number | null;
  event_transfers_cost: number | null;
  points_on_bench: number | null;
  active_chip: string | null;
  captain: number | null;
  vice_captain: number | null;
  squad: Pick[];
};

export type EntryGameweekResponse = {
  schema_version: number;
  entry: EntryGameweek;
  fetched_at: number;
  cache: 'hit' | 'miss';
};

export class PicksNotFoundError extends Error {
  constructor(teamId: string, gameweek: number) {
    super(`Picks for team ${teamId} GW ${gameweek} not found`);
    this.name = 'PicksNotFoundError';
  }
}

export async function fetchEntryGameweek(
  teamId: string,
  gameweek: number,
  signal?: AbortSignal,
): Promise<EntryGameweekResponse> {
  const res = await fetch(
    `${API_BASE_URL}/entry/${teamId}/gameweek/${gameweek}`,
    { signal },
  );
  if (res.status === 404) throw new PicksNotFoundError(teamId, gameweek);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as EntryGameweekResponse;
}
