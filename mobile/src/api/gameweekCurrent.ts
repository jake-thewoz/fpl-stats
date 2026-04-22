import { API_BASE_URL } from '../config';

export type Gameweek = {
  id: number;
  name: string;
  deadline_time: string;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
};

export type FixtureSide = {
  id: number;
  short_name: string | null;
  name: string | null;
  score: number | null;
};

export type Fixture = {
  id: number;
  kickoff_time: string | null;
  started: boolean | null;
  finished: boolean;
  home: FixtureSide;
  away: FixtureSide;
};

export type GameweekCurrentResponse = {
  schema_version: number;
  gameweek: Gameweek | null;
  fixtures: Fixture[];
};

export async function fetchGameweekCurrent(
  signal?: AbortSignal,
): Promise<GameweekCurrentResponse> {
  const res = await fetch(`${API_BASE_URL}/gameweek/current`, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as GameweekCurrentResponse;
}
