/**
 * Pure filter + sort logic. No UI, no async — easy to reason about and
 * trivial to unit-test if the project ever adds mobile tests.
 */
import { FIELD_DEFS, FIELDS_IN_PICKER_ORDER } from './fields';
import type {
  FieldKey,
  FilterState,
  JoinedPlayer,
  RangeFilter,
  SortState,
} from './types';

/** Apply a free-text search across name + team. Empty query returns all. */
export function applySearch(
  players: readonly JoinedPlayer[],
  query: string,
): JoinedPlayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...players];
  return players.filter(
    (p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q),
  );
}

/** Apply the structured filter state. Empty filter passes through. */
export function applyFilters(
  players: readonly JoinedPlayer[],
  f: FilterState,
): JoinedPlayer[] {
  return players.filter((p) => {
    if (f.positions.length > 0 && !f.positions.includes(p.position)) return false;
    if (f.teams.length > 0 && !f.teams.includes(p.team)) return false;
    for (const [key, range] of Object.entries(f.ranges) as [
      keyof typeof FIELD_DEFS,
      { min: number | null; max: number | null },
    ][]) {
      if (!range) continue;
      const value = FIELD_DEFS[key].accessor(p);
      // Null values fail any active range filter — a player with no xP
      // shouldn't appear when the user is filtering "xP >= 5".
      if (value == null) {
        if (range.min != null || range.max != null) return false;
        continue;
      }
      if (range.min != null && value < range.min) return false;
      if (range.max != null && value > range.max) return false;
    }
    return true;
  });
}

/** Sort by the chosen field and direction. Stable secondary sort by name
 *  so equal-value rows have a deterministic order across renders. */
export function applySort(
  players: readonly JoinedPlayer[],
  sort: SortState,
): JoinedPlayer[] {
  const accessor = FIELD_DEFS[sort.field].accessor;
  const dir = sort.dir === 'asc' ? 1 : -1;
  // Sort nulls to the end regardless of direction — "no data" is never
  // ranked above real data.
  return [...players].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return a.name.localeCompare(b.name);
    return av < bv ? -dir : dir;
  });
}

/** Composes the standard pipeline used by both screens. */
export function applyAll(
  players: readonly JoinedPlayer[],
  query: string,
  filters: FilterState,
  sort: SortState,
): JoinedPlayer[] {
  return applySort(applyFilters(applySearch(players, query), filters), sort);
}

/** One removable chip per active filter constraint (#103). */
export type ActiveFilterChip = {
  /** Stable React key. */
  id: string;
  label: string;
  /** Returns the filter state with only this constraint dropped. */
  remove: (filters: FilterState) => FilterState;
};

const CATEGORY_VALUE_SEPARATOR = ', ';
const RANGE_MIN_SYMBOL = '≥';
const RANGE_MAX_SYMBOL = '≤';
const RANGE_SPAN_SEPARATOR = '–';

// The dialog leaves `{ min: null, max: null }` behind when a user empties
// both inputs, so key presence alone doesn't mean the range is active.
function isActiveRange(range: RangeFilter | undefined): range is RangeFilter {
  return range != null && (range.min != null || range.max != null);
}

function rangeChipLabel(key: FieldKey, range: RangeFilter): string {
  const { shortLabel, format } = FIELD_DEFS[key];
  if (range.min != null && range.max != null) {
    return `${shortLabel} ${format(range.min)}${RANGE_SPAN_SEPARATOR}${format(range.max)}`;
  }
  if (range.min != null) return `${shortLabel} ${RANGE_MIN_SYMBOL} ${format(range.min)}`;
  return `${shortLabel} ${RANGE_MAX_SYMBOL} ${format(range.max)}`;
}

/** Chips in the same order the filter dialog lists its sections:
 *  position, numeric ranges, team. */
export function activeFilterChips(f: FilterState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (f.positions.length > 0) {
    chips.push({
      id: 'positions',
      label: `Position: ${f.positions.join(CATEGORY_VALUE_SEPARATOR)}`,
      remove: (current) => ({ ...current, positions: [] }),
    });
  }
  for (const { key } of FIELDS_IN_PICKER_ORDER) {
    const range = f.ranges[key];
    if (!isActiveRange(range)) continue;
    chips.push({
      id: `range:${key}`,
      label: rangeChipLabel(key, range),
      remove: (current) => {
        const { [key]: _removed, ...remainingRanges } = current.ranges;
        return { ...current, ranges: remainingRanges };
      },
    });
  }
  if (f.teams.length > 0) {
    chips.push({
      id: 'teams',
      label: `Team: ${f.teams.join(CATEGORY_VALUE_SEPARATOR)}`,
      remove: (current) => ({ ...current, teams: [] }),
    });
  }
  return chips;
}

/** Drives the "Filter (n)" badge count. Derived from the chips so the
 *  badge and the chip strip can never disagree. */
export function activeFilterCount(f: FilterState): number {
  return activeFilterChips(f).length;
}
