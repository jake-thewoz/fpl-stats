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
  /** Defensive contributions — a 25/26 scoring lever (DEF 10+ / MID-FWD 12+
   *  per match = +2 pts). null when ingest hasn't picked it up. */
  defcon: number | null;
  defcon_per_90: number | null;
  selected_by_percent: number | null;
  points_per_game: number | null;
  minutes: number | null;
  goals_scored: number | null;
  assists: number | null;
  clean_sheets: number | null;
  bonus: number | null;
  bps: number | null;
  ict_index: number | null;
  expected_goals: number | null;
  expected_assists: number | null;
  /** Cost change this GW in £m units (positive = price up). */
  cost_change_event: number | null;
};

/** The set of column/filter keys the UI knows about. */
export type FieldKey =
  | 'xp'
  | 'form'
  | 'price'
  | 'total_points'
  | 'defcon'
  | 'defcon_per_90'
  | 'selected_by_percent'
  | 'points_per_game'
  | 'minutes'
  | 'goals_scored'
  | 'assists'
  | 'clean_sheets'
  | 'bonus'
  | 'bps'
  | 'ict_index'
  | 'expected_goals'
  | 'expected_assists'
  | 'cost_change_event';

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
