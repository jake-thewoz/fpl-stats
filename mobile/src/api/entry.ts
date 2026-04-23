import { API_BASE_URL } from '../config';

export type Entry = {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  started_event: number;
  favourite_team: number | null;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  summary_event_points: number | null;
  summary_event_rank: number | null;
  current_event: number | null;
  last_deadline_value: number | null;
  last_deadline_bank: number | null;
  last_deadline_total_transfers: number | null;
};

export type EntryResponse = {
  schema_version: number;
  entry: Entry;
  fetched_at: number;
  cache: 'hit' | 'miss';
};

export class EntryNotFoundError extends Error {
  constructor(teamId: string) {
    super(`Team ${teamId} not found`);
    this.name = 'EntryNotFoundError';
  }
}

export async function fetchEntry(
  teamId: string,
  signal?: AbortSignal,
): Promise<EntryResponse> {
  const res = await fetch(`${API_BASE_URL}/entry/${teamId}`, { signal });
  if (res.status === 404) throw new EntryNotFoundError(teamId);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as EntryResponse;
}
