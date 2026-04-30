/**
 * Field metadata shared by both screens. Adding a new column/filter is one
 * entry here — both screens pick it up automatically.
 */
import type { FieldKey, JoinedPlayer, SortDir } from './types';

export type FieldDef = {
  key: FieldKey;
  /** Long label for picker rows ("Expected points"). */
  label: string;
  /** Short label for column headers ("xP"). */
  shortLabel: string;
  /** Default sort direction the first time the user taps this column. */
  defaultSortDir: SortDir;
  /** Read the value off a JoinedPlayer for sort/filter/format. */
  accessor: (p: JoinedPlayer) => number | null;
  /** Render a cell value as a string. */
  format: (value: number | null) => string;
};

const fmtNumber = (v: number | null): string =>
  v == null ? '—' : v.toFixed(1);
const fmtPrice = (v: number | null): string =>
  v == null ? '—' : `£${v.toFixed(1)}`;
const fmtInt = (v: number | null): string =>
  v == null ? '—' : String(v);
const fmtPercent = (v: number | null): string =>
  v == null ? '—' : `${v.toFixed(1)}%`;
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
    defaultSortDir: 'desc',
    accessor: (p) => p.xp,
    format: fmtNumber,
  },
  xp_h3: {
    key: 'xp_h3',
    label: 'Expected points (next 3 GWs)',
    shortLabel: 'xP·3',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h3,
    format: fmtNumber,
  },
  xp_h5: {
    key: 'xp_h5',
    label: 'Expected points (next 5 GWs)',
    shortLabel: 'xP·5',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h5,
    format: fmtNumber,
  },
  form: {
    key: 'form',
    label: 'Form',
    shortLabel: 'Form',
    defaultSortDir: 'desc',
    accessor: (p) => p.form,
    format: fmtNumber,
  },
  price: {
    key: 'price',
    label: 'Price',
    shortLabel: 'Price',
    defaultSortDir: 'desc',
    accessor: (p) => p.price,
    format: fmtPrice,
  },
  total_points: {
    key: 'total_points',
    label: 'Total points',
    shortLabel: 'Points',
    defaultSortDir: 'desc',
    accessor: (p) => p.total_points,
    format: fmtInt,
  },
  defcon: {
    key: 'defcon',
    label: 'Defensive contributions',
    shortLabel: 'Defcon',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon,
    format: fmtInt,
  },
  defcon_per_90: {
    key: 'defcon_per_90',
    label: 'Defcon per 90',
    shortLabel: 'Defcon/90',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon_per_90,
    format: fmtNumber,
  },
  points_per_game: {
    key: 'points_per_game',
    label: 'Points per game',
    shortLabel: 'PPG',
    defaultSortDir: 'desc',
    accessor: (p) => p.points_per_game,
    format: fmtNumber,
  },
  selected_by_percent: {
    key: 'selected_by_percent',
    label: 'Selected by %',
    shortLabel: 'Sel %',
    defaultSortDir: 'desc',
    accessor: (p) => p.selected_by_percent,
    format: fmtPercent,
  },
  minutes: {
    key: 'minutes',
    label: 'Minutes',
    shortLabel: 'Mins',
    defaultSortDir: 'desc',
    accessor: (p) => p.minutes,
    format: fmtInt,
  },
  goals_scored: {
    key: 'goals_scored',
    label: 'Goals',
    shortLabel: 'G',
    defaultSortDir: 'desc',
    accessor: (p) => p.goals_scored,
    format: fmtInt,
  },
  assists: {
    key: 'assists',
    label: 'Assists',
    shortLabel: 'A',
    defaultSortDir: 'desc',
    accessor: (p) => p.assists,
    format: fmtInt,
  },
  clean_sheets: {
    key: 'clean_sheets',
    label: 'Clean sheets',
    shortLabel: 'CS',
    defaultSortDir: 'desc',
    accessor: (p) => p.clean_sheets,
    format: fmtInt,
  },
  bonus: {
    key: 'bonus',
    label: 'Bonus points',
    shortLabel: 'Bonus',
    defaultSortDir: 'desc',
    accessor: (p) => p.bonus,
    format: fmtInt,
  },
  bps: {
    key: 'bps',
    label: 'BPS',
    shortLabel: 'BPS',
    defaultSortDir: 'desc',
    accessor: (p) => p.bps,
    format: fmtInt,
  },
  ict_index: {
    key: 'ict_index',
    label: 'ICT index',
    shortLabel: 'ICT',
    defaultSortDir: 'desc',
    accessor: (p) => p.ict_index,
    format: fmtNumber,
  },
  expected_goals: {
    key: 'expected_goals',
    label: 'Expected goals',
    shortLabel: 'xG',
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_goals,
    format: fmtNumber,
  },
  expected_assists: {
    key: 'expected_assists',
    label: 'Expected assists',
    shortLabel: 'xA',
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_assists,
    format: fmtNumber,
  },
  cost_change_event: {
    key: 'cost_change_event',
    label: 'Price change (this GW)',
    shortLabel: 'Δ£',
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

/** Defaults a brand-new install gets. Picked to emphasise xP — the
 *  newest signal, what the unified rebuild is for. */
export const DEFAULT_COLUMNS: FieldKey[] = ['xp', 'form', 'price'];

export const DEFAULT_SORT = { field: 'xp' as FieldKey, dir: 'desc' as SortDir };
