/**
 * Per-screen AsyncStorage persistence for the unified columns + filters.
 *
 * Each screen has its own keys so a Players layout doesn't clobber a
 * My Team layout. Garbage stored values fall back to defaults silently
 * — a corrupt entry shouldn't brick the screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FieldKey, FilterState, SortState } from './types';
import { EMPTY_FILTER } from './types';
import { DEFAULT_COLUMNS, DEFAULT_SORT, FIELD_DEFS } from './fields';

export type ScreenKey = 'players' | 'myTeam';

const KEY_COLUMNS = (screen: ScreenKey) => `mobile.${screen}.columns.v1`;
const KEY_FILTERS = (screen: ScreenKey) => `mobile.${screen}.filters.v1`;
const KEY_SORT = (screen: ScreenKey) => `mobile.${screen}.sort.v1`;

function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === 'string' && value in FIELD_DEFS;
}

export async function loadColumns(screen: ScreenKey): Promise<FieldKey[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_COLUMNS(screen));
    if (!raw) return DEFAULT_COLUMNS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const valid = parsed.filter(isFieldKey);
    return valid.length > 0 ? valid : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export async function saveColumns(
  screen: ScreenKey,
  columns: FieldKey[],
): Promise<void> {
  await AsyncStorage.setItem(KEY_COLUMNS(screen), JSON.stringify(columns));
}

export async function loadFilters(screen: ScreenKey): Promise<FilterState> {
  try {
    const raw = await AsyncStorage.getItem(KEY_FILTERS(screen));
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      ranges:
        typeof parsed.ranges === 'object' && parsed.ranges != null
          ? parsed.ranges
          : {},
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export async function saveFilters(
  screen: ScreenKey,
  filters: FilterState,
): Promise<void> {
  await AsyncStorage.setItem(KEY_FILTERS(screen), JSON.stringify(filters));
}

export async function loadSort(screen: ScreenKey): Promise<SortState> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SORT(screen));
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<SortState>;
    if (!isFieldKey(parsed.field)) return DEFAULT_SORT;
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return DEFAULT_SORT;
    return { field: parsed.field, dir: parsed.dir };
  } catch {
    return DEFAULT_SORT;
  }
}

export async function saveSort(
  screen: ScreenKey,
  sort: SortState,
): Promise<void> {
  await AsyncStorage.setItem(KEY_SORT(screen), JSON.stringify(sort));
}
