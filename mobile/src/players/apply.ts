/**
 * Pure filter + sort logic. No UI, no async — easy to reason about and
 * trivial to unit-test if the project ever adds mobile tests.
 */
import { FIELD_DEFS } from './fields';
import type { FilterState, JoinedPlayer, SortState } from './types';

/** Apply a free-text search across name + team. Empty query returns all. */
export function applySearch(
  players: readonly JoinedPlayer[],
  query: string,
): JoinedPlayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...players];
  return players.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.team.toLowerCase().includes(q),
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

/** True when any filter is active. Drives the "Filter (n)" badge count. */
export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.positions.length > 0) n += 1;
  if (f.teams.length > 0) n += 1;
  for (const range of Object.values(f.ranges)) {
    if (range && (range.min != null || range.max != null)) n += 1;
  }
  return n;
}
