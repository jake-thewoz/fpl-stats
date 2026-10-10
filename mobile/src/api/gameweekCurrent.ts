import { requestJson } from './http';

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
  /** Latest GW whose deadline has passed: live, or most recently played.
   *  Null pre-season. */
  gameweek: Gameweek | null;
  /** First GW whose deadline is still ahead. Null after the final one. */
  next_gameweek: Gameweek | null;
  fixtures: Fixture[];
};

export async function fetchGameweekCurrent(
  signal?: AbortSignal,
): Promise<GameweekCurrentResponse> {
  return requestJson<GameweekCurrentResponse>('/gameweek/current', { signal });
}
