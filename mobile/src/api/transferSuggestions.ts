import { requestJson } from './http';

/** One side of a transfer move (the out or in player). */
export type SuggestionPlayer = {
  player_id: number;
  web_name: string;
  team_id: number;
  position_id: number;
  /** Price in 0.1m units, e.g. 95 = £9.5m. */
  now_cost: number;
  /** Projected expected points across the requested horizon. */
  horizon_xp: number;
  /** Weighted form score from the player-form analyzer. Null when no
   *  analytics row exists for this player yet (new arrival, ingest
   *  race). The mobile expand-on-tap card renders null as "—". */
  form_score: number | null;
  /** Mean of FPL's 1–5 fixture difficulty across the next ~5 fixtures.
   *  Lower is easier. Null when none of the upcoming fixtures had a
   *  difficulty value. */
  avg_upcoming_difficulty: number | null;
  /** Mean ClubELO-derived expected score (~win probability + half draw)
   *  across the next ~5 fixtures, on 0–1. Higher is more favourable.
   *  Null when no fixtures had ClubELO ratings on both sides. */
  avg_upcoming_elo_expected_score: number | null;
};

/** A single move within a bundle: out -> in. */
export type TransferMove = {
  out: SuggestionPlayer;
  in: SuggestionPlayer;
  /** in.horizon_xp − out.horizon_xp for this move alone. */
  delta_xp: number;
  /** in.now_cost − out.now_cost in 0.1m units. Positive = costs money. */
  cost_change: number;
};

/** A bundle is a 1-, 2-, or 3-move transfer package, scored by net
 *  delta-xp after subtracting the FT-aware hit cost. */
export type TransferBundle = {
  moves: TransferMove[];
  /** Number of transfers in this bundle (length of `moves`). */
  num_transfers: number;
  /** Points penalty for transfers beyond the user's free count:
   *  max(0, num_transfers − free_transfers) × 4. */
  hit_cost: number;
  /** Sum of move.delta_xp across the bundle. */
  delta_xp_gross: number;
  /** delta_xp_gross − hit_cost. Bundles are ranked descending by this. */
  delta_xp_net: number;
  /** Sum of move.cost_change across the bundle (net bank impact). */
  total_cost_change: number;
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
  /** FT count derived from FPL history (or override). The hit_cost on
   *  each bundle is computed against this. */
  free_transfers: number;
  /** The bundle-size ceiling actually applied (default 2, capped at 3). */
  max_transfers_considered: number;
  /** True when the current GW has Free Hit active. The server has already
   *  swapped the squad to the previous GW's persistent picks for the
   *  bundle math, so the suggestions apply to the user's real team —
   *  this flag exists so the UI can surface that fact. */
  freehit_active: boolean;
  /** Top N (server-capped at 10), ranked by delta_xp_net desc, then by
   *  num_transfers asc (prefer fewer moves at equal net). */
  bundles: TransferBundle[];
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
  /** Bundle-size ceiling. Default omitted → server picks DEFAULT_MAX_TRANSFERS=2. */
  maxTransfers?: number,
): Promise<TransferSuggestionsResponse> {
  const params = new URLSearchParams({ horizon: String(horizon) });
  if (positions.length > 0) {
    params.set('positions', positions.join(','));
  }
  if (maxTransfers !== undefined) {
    params.set('max_transfers', String(maxTransfers));
  }
  return requestJson<TransferSuggestionsResponse>(
    `/analytics/squad/${teamId}/transfers?${params.toString()}`,
    {
      signal,
      mapStatus: (status, body) => {
        if (status !== 404) return undefined;
        // Both entry-not-found and picks-not-found come back as 404 with
        // distinguishing payload — read the body to pick the right
        // error type.
        const errKey = (body as { error?: string } | undefined)?.error;
        if (errKey === 'entry not found') return new EntryNotFoundError(teamId);
        if (errKey === 'picks not found') return new PicksNotFoundError(teamId);
        return new Error('Not found');
      },
    },
  );
}
