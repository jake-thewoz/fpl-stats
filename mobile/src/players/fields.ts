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
const fmtPoints = (v: number | null): string =>
  v == null ? '—' : String(v);

export const FIELD_DEFS: Record<FieldKey, FieldDef> = {
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
    format: fmtPoints,
  },
  xp: {
    key: 'xp',
    label: 'Expected points',
    shortLabel: 'xP',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp,
    format: fmtNumber,
  },
};

/** All fields, in the order the picker should display them. */
export const FIELDS_IN_PICKER_ORDER: FieldDef[] = [
  FIELD_DEFS.xp,
  FIELD_DEFS.form,
  FIELD_DEFS.price,
  FIELD_DEFS.total_points,
];

/** Defaults a brand-new install gets. Picked to emphasise xP — the
 *  newest signal, what the unified rebuild is for. */
export const DEFAULT_COLUMNS: FieldKey[] = ['xp', 'form', 'price'];

export const DEFAULT_SORT = { field: 'xp' as FieldKey, dir: 'desc' as SortDir };
