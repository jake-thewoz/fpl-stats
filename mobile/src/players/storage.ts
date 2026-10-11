/**
 * AsyncStorage persistence for the unified columns + filters + sort.
 *
 * Single global keys — both Players and My Team read/write the same
 * settings so a column the user pinned on one screen shows on the
 * other automatically. Per-screen storage keys were the original
 * design but were over-engineering: the whole point of the rebuild
 * is "see the same view on both", and forcing the user to configure
 * twice fights that.
 *
 * Garbage stored values fall back to defaults silently — a corrupt
 * entry shouldn't brick either screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FieldKey, FilterState, SortState } from './types';
import { EMPTY_FILTER } from './types';
import { DEFAULT_COLUMNS, DEFAULT_SORT, FIELD_DEFS, INTRODUCED_COLUMNS } from './fields';

const KEY_COLUMNS = 'mobile.columns.v1';
const KEY_FILTERS = 'mobile.filters.v1';
const KEY_SORT = 'mobile.sort.v1';
const KEY_INTRODUCED_COLUMNS = 'mobile.columns.introduced.v1';

function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === 'string' && value in FIELD_DEFS;
}

export async function loadColumns(): Promise<FieldKey[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_COLUMNS);
    const introduced = await takeUnseenIntroducedColumns();
    if (!raw) return DEFAULT_COLUMNS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const valid = parsed.filter(isFieldKey);
    if (valid.length === 0) return DEFAULT_COLUMNS;
    const added = introduced.filter((key) => !valid.includes(key));
    if (added.length === 0) return valid;
    const withIntroduced = insertAtDefaultPositions(valid, added);
    await saveColumns(withIntroduced);
    return withIntroduced;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** Introduced columns this install hasn't been given yet, marked as given
 *  from now on. A fresh install gets them through `DEFAULT_COLUMNS`. */
async function takeUnseenIntroducedColumns(): Promise<FieldKey[]> {
  const raw = await AsyncStorage.getItem(KEY_INTRODUCED_COLUMNS);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  const seen = Array.isArray(parsed) ? parsed.filter(isFieldKey) : [];
  const unseen = INTRODUCED_COLUMNS.filter((key) => !seen.includes(key));
  if (unseen.length > 0) {
    await AsyncStorage.setItem(
      KEY_INTRODUCED_COLUMNS,
      JSON.stringify(INTRODUCED_COLUMNS),
    );
  }
  return unseen;
}

/** Places each added column after the column that precedes it in
 *  `DEFAULT_COLUMNS`, or first when none of its predecessors are shown. */
export function insertAtDefaultPositions(
  columns: readonly FieldKey[],
  added: readonly FieldKey[],
): FieldKey[] {
  const result = [...columns];
  for (const key of added) {
    const defaultIndex = DEFAULT_COLUMNS.indexOf(key);
    const predecessors = DEFAULT_COLUMNS.slice(0, Math.max(defaultIndex, 0));
    const anchor = [...predecessors].reverse().find((p) => result.includes(p));
    result.splice(anchor == null ? 0 : result.indexOf(anchor) + 1, 0, key);
  }
  return result;
}

export async function saveColumns(columns: FieldKey[]): Promise<void> {
  await AsyncStorage.setItem(KEY_COLUMNS, JSON.stringify(columns));
}

export async function loadFilters(): Promise<FilterState> {
  try {
    const raw = await AsyncStorage.getItem(KEY_FILTERS);
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      ranges:
        typeof parsed.ranges === 'object' && parsed.ranges != null ? parsed.ranges : {},
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export async function saveFilters(filters: FilterState): Promise<void> {
  await AsyncStorage.setItem(KEY_FILTERS, JSON.stringify(filters));
}

export async function loadSort(): Promise<SortState> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SORT);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<SortState>;
    if (!isFieldKey(parsed.field)) return DEFAULT_SORT;
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return DEFAULT_SORT;
    return { field: parsed.field, dir: parsed.dir };
  } catch {
    return DEFAULT_SORT;
  }
}

export async function saveSort(sort: SortState): Promise<void> {
  await AsyncStorage.setItem(KEY_SORT, JSON.stringify(sort));
}
