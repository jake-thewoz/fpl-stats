import { API_BASE_URL } from '../config';

export type GameweekLiveElement = {
  id: number;
  total_points: number;
  minutes: number;
};

export type GameweekLiveResponse = {
  schema_version: number;
  gameweek: number;
  elements: GameweekLiveElement[];
  fetched_at: number;
  cache: 'hit' | 'miss';
};

export class GameweekLiveNotFoundError extends Error {
  constructor(gameweek: number) {
    super(`Live data for GW ${gameweek} not found`);
    this.name = 'GameweekLiveNotFoundError';
  }
}

export async function fetchGameweekLive(
  gameweek: number,
  signal?: AbortSignal,
): Promise<GameweekLiveResponse> {
  const res = await fetch(`${API_BASE_URL}/gameweek/${gameweek}/live`, { signal });
  if (res.status === 404) throw new GameweekLiveNotFoundError(gameweek);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as GameweekLiveResponse;
}
