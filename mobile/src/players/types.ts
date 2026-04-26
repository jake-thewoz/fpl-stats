/**
 * Shared types for the unified players + my-team list UX.
 *
 * Both screens project their underlying data onto the same `JoinedPlayer`
 * shape and consume the same `FieldKey` enum, so columns and filters
 * behave identically on both — that's the whole point of the rebuild
 * (#73).
 */

/** Common per-player view model used on both Players and My Team. */
export type JoinedPlayer = {
  /** FPL element id. Stable across the season. */
  id: number;
  /** web_name (short display name). */
  name: string;
  /** Team short_name (e.g. 'ARS'). */
  team: string;
  /** Position short (GKP / DEF / MID / FWD). */
  position: string;
  /** £m, e.g. 9.5. */
  price: number;
  /** Season-to-date total. */
  total_points: number;
  /** FPL form score (parsed to number). */
  form: number;
  /** Projected xP for the upcoming GW. null when the analyzer hasn't
   *  scored this player (e.g. fresh deploy, position not in xp output). */
  xp: number | null;
};

/** The set of column/filter keys the UI knows about. */
export type FieldKey = 'form' | 'price' | 'total_points' | 'xp';

/** Numeric-range filter (min and/or max nullable for "no bound"). */
export type RangeFilter = {
  min: number | null;
  max: number | null;
};

/** The full filter state for a list. */
export type FilterState = {
  /** Position short_name set. Empty = no position filter. */
  positions: string[];
  /** Team short_name set. Empty = no team filter. */
  teams: string[];
  /** One range entry per numeric field key. */
  ranges: Partial<Record<FieldKey, RangeFilter>>;
};

export const EMPTY_FILTER: FilterState = {
  positions: [],
  teams: [],
  ranges: {},
};

export type SortDir = 'asc' | 'desc';

export type SortState = {
  /** Which column the user is sorting by. */
  field: FieldKey;
  dir: SortDir;
};
