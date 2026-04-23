import { API_BASE_URL } from '../config';

export type LeagueInfo = {
  id: number;
  name: string;
};

export type LeagueMember = {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  total: number;
};

export type LeagueMembersResponse = {
  schema_version: number;
  league: LeagueInfo;
  members: LeagueMember[];
  has_more: boolean;
  fetched_at: number;
  cache: 'hit' | 'miss';
};

export class LeagueNotFoundError extends Error {
  constructor(leagueId: string) {
    super(`League ${leagueId} not found`);
    this.name = 'LeagueNotFoundError';
  }
}

export async function fetchLeagueMembers(
  leagueId: string,
  signal?: AbortSignal,
): Promise<LeagueMembersResponse> {
  const res = await fetch(`${API_BASE_URL}/league/${leagueId}/members`, { signal });
  if (res.status === 404) throw new LeagueNotFoundError(leagueId);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as LeagueMembersResponse;
}
