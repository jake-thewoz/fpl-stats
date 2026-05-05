import { requestJson } from './http';

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
  return requestJson<LeagueMembersResponse>(`/league/${leagueId}/members`, {
    signal,
    mapStatus: (status) =>
      status === 404 ? new LeagueNotFoundError(leagueId) : undefined,
  });
}
