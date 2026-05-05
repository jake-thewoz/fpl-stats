import { requestJson } from './http';

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
  return requestJson<GameweekLiveResponse>(`/gameweek/${gameweek}/live`, {
    signal,
    mapStatus: (status) =>
      status === 404 ? new GameweekLiveNotFoundError(gameweek) : undefined,
  });
}
