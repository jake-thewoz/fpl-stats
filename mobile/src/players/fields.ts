/**
 * Field metadata shared by both screens. Adding a new column/filter is one
 * entry here — both screens pick it up automatically.
 */
import { HEAT_CEILING } from '../theme/heat';
import type { FieldKey, JoinedPlayer, SortDir } from './types';

export type FieldDef = {
  key: FieldKey;
  /** Long label for picker rows ("Expected points"). */
  label: string;
  /** Short label for column headers ("xP"). */
  shortLabel: string;
  /** One plain-English sentence for someone new to FPL stats. */
  description: string;
  /** Default sort direction the first time the user taps this column. */
  defaultSortDir: SortDir;
  /** Read the value off a JoinedPlayer for sort/filter/format. */
  accessor: (p: JoinedPlayer) => number | null;
  /** Render a cell value as a string. */
  format: (value: number | null) => string;
};

const fmtNumber = (v: number | null): string => (v == null ? '—' : v.toFixed(1));
const fmtPrice = (v: number | null): string => (v == null ? '—' : `£${v.toFixed(1)}`);
const fmtInt = (v: number | null): string => (v == null ? '—' : String(v));
const fmtPercent = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);
// Cost change: signed £m delta. +0.1 / -0.2 / 0.0
const fmtCostChange = (v: number | null): string => {
  if (v == null) return '—';
  if (v === 0) return '£0.0';
  const sign = v > 0 ? '+' : '−';
  return `${sign}£${Math.abs(v).toFixed(1)}`;
};

export const FIELD_DEFS: Record<FieldKey, FieldDef> = {
  xp: {
    key: 'xp',
    label: 'Expected points (next GW)',
    shortLabel: 'xP',
    description: 'Points our model expects the player to score in the next gameweek.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp,
    format: fmtNumber,
  },
  xp_h3: {
    key: 'xp_h3',
    label: 'Expected points (next 3 GWs)',
    shortLabel: 'xP·3',
    description: 'Expected points added up over the next three gameweeks.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h3,
    format: fmtNumber,
  },
  xp_h5: {
    key: 'xp_h5',
    label: 'Expected points (next 5 GWs)',
    shortLabel: 'xP·5',
    description: 'Expected points added up over the next five gameweeks.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h5,
    format: fmtNumber,
  },
  form: {
    key: 'form',
    label: 'Form',
    shortLabel: 'Form',
    description: "FPL's average points per game over the last 30 days.",
    defaultSortDir: 'desc',
    accessor: (p) => p.form,
    format: fmtNumber,
  },
  price: {
    key: 'price',
    label: 'Price',
    shortLabel: 'Price',
    description: 'Current FPL price, in millions.',
    defaultSortDir: 'desc',
    accessor: (p) => p.price,
    format: fmtPrice,
  },
  total_points: {
    key: 'total_points',
    label: 'Total points',
    shortLabel: 'Points',
    description: 'FPL points scored so far this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.total_points,
    format: fmtInt,
  },
  defcon: {
    key: 'defcon',
    label: 'Defensive contributions',
    shortLabel: 'Defcon',
    description:
      'Defensive contributions this season: tackles, blocks, interceptions and clearances (plus recoveries for midfielders and forwards). Enough in one match earns 2 points.',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon,
    format: fmtInt,
  },
  defcon_per_90: {
    key: 'defcon_per_90',
    label: 'Defcon per 90',
    shortLabel: 'Defcon/90',
    description:
      'Defensive contributions per 90 minutes played, so part-time players compare fairly.',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon_per_90,
    format: fmtNumber,
  },
  points_per_game: {
    key: 'points_per_game',
    label: 'Points per game',
    shortLabel: 'PPG',
    description: 'Average FPL points per appearance this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.points_per_game,
    format: fmtNumber,
  },
  selected_by_percent: {
    key: 'selected_by_percent',
    label: 'Selected by %',
    shortLabel: 'Sel %',
    description: 'Share of all FPL managers who own the player.',
    defaultSortDir: 'desc',
    accessor: (p) => p.selected_by_percent,
    format: fmtPercent,
  },
  minutes: {
    key: 'minutes',
    label: 'Minutes',
    shortLabel: 'Mins',
    description: 'Minutes played this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.minutes,
    format: fmtInt,
  },
  goals_scored: {
    key: 'goals_scored',
    label: 'Goals',
    shortLabel: 'G',
    description: 'Goals scored this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.goals_scored,
    format: fmtInt,
  },
  assists: {
    key: 'assists',
    label: 'Assists',
    shortLabel: 'A',
    description: 'Assists this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.assists,
    format: fmtInt,
  },
  clean_sheets: {
    key: 'clean_sheets',
    label: 'Clean sheets',
    shortLabel: 'CS',
    description:
      "Matches this season where the player's team conceded nothing while they played 60+ minutes.",
    defaultSortDir: 'desc',
    accessor: (p) => p.clean_sheets,
    format: fmtInt,
  },
  bonus: {
    key: 'bonus',
    label: 'Bonus points',
    shortLabel: 'Bonus',
    description:
      'Bonus points earned this season. The top three performers in each match get 3, 2 and 1.',
    defaultSortDir: 'desc',
    accessor: (p) => p.bonus,
    format: fmtInt,
  },
  bps: {
    key: 'bps',
    label: 'BPS',
    shortLabel: 'BPS',
    description:
      "Bonus Points System score: FPL's per-match performance rating that decides who gets bonus points.",
    defaultSortDir: 'desc',
    accessor: (p) => p.bps,
    format: fmtInt,
  },
  ict_index: {
    key: 'ict_index',
    label: 'ICT index',
    shortLabel: 'ICT',
    description:
      "FPL's Influence, Creativity and Threat index, a rating of attacking involvement.",
    defaultSortDir: 'desc',
    accessor: (p) => p.ict_index,
    format: fmtNumber,
  },
  expected_goals: {
    key: 'expected_goals',
    label: 'Expected goals',
    shortLabel: 'xG',
    description:
      "Expected goals: how many goals the player's shots would usually produce.",
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_goals,
    format: fmtNumber,
  },
  expected_assists: {
    key: 'expected_assists',
    label: 'Expected assists',
    shortLabel: 'xA',
    description:
      "Expected assists: how many assists the player's passes would usually produce.",
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_assists,
    format: fmtNumber,
  },
  cost_change_event: {
    key: 'cost_change_event',
    label: 'Price change (this GW)',
    shortLabel: 'Δ£',
    description: 'How much the price has moved this gameweek.',
    defaultSortDir: 'desc',
    accessor: (p) => p.cost_change_event,
    format: fmtCostChange,
  },
};

/** All fields, in the order the picker should display them. xP first as
 *  the headline signal, then defcon (the priority field driving #102), then
 *  the canonical FPL stats grouped by family (scoring → involvement →
 *  defensive → composite/expected → market). */
export const FIELDS_IN_PICKER_ORDER: FieldDef[] = [
  FIELD_DEFS.xp,
  FIELD_DEFS.xp_h3,
  FIELD_DEFS.xp_h5,
  FIELD_DEFS.defcon,
  FIELD_DEFS.defcon_per_90,
  FIELD_DEFS.form,
  FIELD_DEFS.price,
  FIELD_DEFS.total_points,
  FIELD_DEFS.points_per_game,
  FIELD_DEFS.minutes,
  FIELD_DEFS.goals_scored,
  FIELD_DEFS.assists,
  FIELD_DEFS.clean_sheets,
  FIELD_DEFS.bonus,
  FIELD_DEFS.bps,
  FIELD_DEFS.ict_index,
  FIELD_DEFS.expected_goals,
  FIELD_DEFS.expected_assists,
  FIELD_DEFS.selected_by_percent,
  FIELD_DEFS.cost_change_event,
];

/** Names the gameweek the xP column projects, under its header, so it's
 *  explicit that projections cover the next deadline while a gameweek is
 *  live. */
export function xpHeaderSublabels(
  gameweek: number | null,
): Partial<Record<FieldKey, string>> | undefined {
  if (gameweek == null) return undefined;
  return { xp: `GW${gameweek}` };
}

/**
 * How a sorted column's cells are heat-coloured. A rate (per game, per 90,
 * per gameweek ahead) has a fixed ceiling. A season total grows every
 * gameweek, so its ceiling is per gameweek played and scales with the
 * season; a fixed one would turn every regular starter mint by spring.
 */
type ColumnHeat =
  | { kind: 'rate'; ceiling: number }
  | { kind: 'seasonTotal'; ceilingPerGameweek: number };

/**
 * Ceilings sit around an elite player's level, so only standouts reach
 * full mint. Price, ownership and price change are left out: a bigger
 * number there isn't a better pick.
 */
const XP_H3_GAMEWEEKS = 3;
const XP_H5_GAMEWEEKS = 5;

const COLUMN_HEAT: Partial<Record<FieldKey, ColumnHeat>> = {
  xp: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints },
  xp_h3: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints * XP_H3_GAMEWEEKS },
  xp_h5: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints * XP_H5_GAMEWEEKS },
  form: { kind: 'rate', ceiling: 8 },
  points_per_game: { kind: 'rate', ceiling: 7 },
  // The per-match defcon bonus threshold for midfielders and forwards.
  defcon_per_90: { kind: 'rate', ceiling: 12 },
  total_points: { kind: 'seasonTotal', ceilingPerGameweek: 7 },
  defcon: { kind: 'seasonTotal', ceilingPerGameweek: 12 },
  minutes: { kind: 'seasonTotal', ceilingPerGameweek: 90 },
  goals_scored: { kind: 'seasonTotal', ceilingPerGameweek: 0.75 },
  assists: { kind: 'seasonTotal', ceilingPerGameweek: 0.5 },
  clean_sheets: { kind: 'seasonTotal', ceilingPerGameweek: 0.5 },
  bonus: { kind: 'seasonTotal', ceilingPerGameweek: 1 },
  bps: { kind: 'seasonTotal', ceilingPerGameweek: 30 },
  ict_index: { kind: 'seasonTotal', ceilingPerGameweek: 8 },
  expected_goals: { kind: 'seasonTotal', ceilingPerGameweek: 0.75 },
  expected_assists: { kind: 'seasonTotal', ceilingPerGameweek: 0.4 },
};

/**
 * The value at which a column's heat cell turns fully mint, or null when
 * the column isn't heat-coloured. Season totals need `gameweeksPlayed`
 * and stay plain before the first gameweek or when it's unknown.
 */
export function heatCeiling(
  key: FieldKey,
  gameweeksPlayed: number | null,
): number | null {
  const heat = COLUMN_HEAT[key];
  if (heat == null) return null;
  if (heat.kind === 'rate') return heat.ceiling;
  if (gameweeksPlayed == null || gameweeksPlayed <= 0) return null;
  return heat.ceilingPerGameweek * gameweeksPlayed;
}

/** Gameweeks finished before the one xP projects. The live gameweek, if
 *  any, counts as played: its points are already in the season totals. */
export function gameweeksPlayedBefore(xpGameweek: number | null): number | null {
  return xpGameweek == null ? null : xpGameweek - 1;
}

/** Defaults a brand-new install gets. Picked to emphasise xP — the
 *  newest signal, what the unified rebuild is for. */
export const DEFAULT_COLUMNS: FieldKey[] = ['xp', 'form', 'price'];

export const DEFAULT_SORT = { field: 'xp' as FieldKey, dir: 'desc' as SortDir };
