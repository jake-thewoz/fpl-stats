import { API_BASE_URL } from '../config';

/** One side of a transfer suggestion (the out or in player). */
export type SuggestionPlayer = {
  player_id: number;
  web_name: string;
  team_id: number;
  position_id: number;
  /** Price in 0.1m units, e.g. 95 = £9.5m. */
  now_cost: number;
  /** Projected expected points across the requested horizon. */
  horizon_xp: number;
};

/** A single ranked swap. */
export type TransferSuggestion = {
  out: SuggestionPlayer;
  in: SuggestionPlayer;
  /** in.horizon_xp − out.horizon_xp. Higher is better. */
  delta_xp: number;
  /** in.now_cost − out.now_cost in 0.1m units. Positive = costs you money. */
  cost_change: number;
};

export type TransferSuggestionsResponse = {
  team_id: number;
  /** Number of GWs in the projection (clamped to season-remaining). */
  horizon_gws: number;
  /** The actual GW ids the projection covers, ascending. */
  horizon_gw_ids: number[];
  season_over: boolean;
  preseason: boolean;
  /** Sum of horizon_xp across the user's 15. Null when no fixtures to score. */
  current_squad_xp?: number;
  /** Top N (server-capped at 10), ranked by delta_xp desc. */
  suggestions: TransferSuggestion[];
};

/** Picks not cached on the server side and FPL didn't have any either —
 * the user hasn't loaded their squad yet. UI surfaces a "open My Team
 * first" CTA rather than a generic error. */
export class PicksNotFoundError extends Error {
  constructor(teamId: string) {
    super(`Picks not found for team ${teamId}`);
    this.name = 'PicksNotFoundError';
  }
}

/** FPL has no record of this team id at all. */
export class EntryNotFoundError extends Error {
  constructor(teamId: string) {
    super(`Entry not found for team ${teamId}`);
    this.name = 'EntryNotFoundError';
  }
}

export async function fetchTransferSuggestions(
  teamId: string,
  horizon: number,
  /** FPL element_type ids to filter to (1=GKP, 2=DEF, 3=MID, 4=FWD).
   * Empty = no filter (all positions). */
  positions: readonly number[],
  signal?: AbortSignal,
): Promise<TransferSuggestionsResponse> {
  const params = new URLSearchParams({ horizon: String(horizon) });
  if (positions.length > 0) {
    params.set('positions', positions.join(','));
  }
  const url = `${API_BASE_URL}/analytics/squad/${teamId}/transfers?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (res.status === 404) {
    // Both entry-not-found and picks-not-found come back as 404 with
    // distinguishing payload — use the body to pick the right error type.
    const body = await res.json().catch(() => ({}));
    if (body?.error === 'entry not found') throw new EntryNotFoundError(teamId);
    if (body?.error === 'picks not found') throw new PicksNotFoundError(teamId);
    throw new Error('Not found');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TransferSuggestionsResponse;
}
