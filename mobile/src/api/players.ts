import { API_BASE_URL } from '../config';

export type Player = {
  id: number;
  name: string;
  team: string;
  position: string;
  total_points: number;
  form: string;
  price: number;
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
