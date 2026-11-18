import { FIELD_DEFS } from '../../players/fields';
import { POSITION_CODES, type PositionCode } from '../../players/positions';
import type { FieldKey } from '../../players/types';
import type { Lineup, LineupSlot } from './lineup';
import { CAPTAIN_MULTIPLIER, STARTER_LIMITS, STARTING_XI_SIZE } from './suggestLineup';
import { solveSquad } from './squadSolver';
import type { MyTeamRow } from './types';

/** Signals a wildcard squad can be built for. Unlike a single lineup,
 *  a squad is held for weeks, so horizon xP and season totals make sense. */
export const WILDCARD_METRICS = [
  'xp_h5',
  'xp_h3',
  'xp',
  'total_points',
  'form',
  'points_per_game',
] as const satisfies readonly FieldKey[];
export type WildcardMetric = (typeof WILDCARD_METRICS)[number];
export const DEFAULT_WILDCARD_METRIC: WildcardMetric = 'xp_h5';

/** FPL squad shape: 2 GK, 5 DEF, 5 MID, 3 FWD. */
const SQUAD_SHAPE: Record<PositionCode, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const SQUAD_SIZE = 15;
const MAX_PER_CLUB = 3;
/** Most clubs a 15-man squad can fill to the three-player limit. */
const MAX_FULL_CLUBS = SQUAD_SIZE / MAX_PER_CLUB;

/** How much a bench player's score counts next to a starter's. Without
 *  this the solver spends on bench players who rarely play; at 0 it
 *  would pick bench players who never play at all. */
export const BENCH_WEIGHT = 0.1;

export type WildcardSuggestion = {
  lineup: Lineup;
  /** Squad cost in £m. */
  cost: number;
  /** XI total by the metric, captain counted double. */
  score: number;
  /** Players in the squad who aren't in the user's current one. */
  incoming: MyTeamRow[];
  /** Players in the user's current squad who aren't in this one. */
  outgoing: MyTeamRow[];
  /** False when the solver ran out of time before proving optimality. */
  optimal: boolean;
};

const tenths = (price: number) => Math.round(price * 10);

/**
 * Best 15-man squad from `pool` by `metric` within `budget` (£m), under
 * FPL's squad rules: 2/5/5/3, at most three per club, and a legal XI.
 *
 * Solved exactly (see `squadSolver.ts`): each player can start, sit on
 * the bench or be left out, and one starter wears the armband. The
 * objective is the XI's score with the captain doubled, plus the bench
 * at `BENCH_WEIGHT`, so money goes on players who start.
 *
 * `currentSquad` only feeds the in/out lists and the change markers.
 * Returns null when no legal squad fits the budget.
 */
export function buildWildcard(
  pool: readonly MyTeamRow[],
  metric: WildcardMetric,
  budget: number,
  currentSquad: readonly MyTeamRow[] = [],
): WildcardSuggestion | null {
  const score = (row: MyTeamRow) => FIELD_DEFS[metric].accessor(row) ?? 0;
  // xP is zeroed for players flagged out (injured, suspended, left the
  // league). Dropping them keeps backward-looking metrics like total
  // points from picking someone who won't play.
  const available = pool.filter((row) => row.xp !== 0);
  const candidates = pruneDominated(available, score);

  const byId = new Map(candidates.map((row) => [row.id, row]));
  const solution = solveSquad(
    candidates.map((row) => ({
      id: row.id,
      position: row.position as PositionCode,
      club: row.team,
      cost: tenths(row.price),
      value: score(row),
    })),
    {
      budget: tenths(budget),
      squadShape: SQUAD_SHAPE,
      starterLimits: STARTER_LIMITS,
      startingXiSize: STARTING_XI_SIZE,
      maxPerClub: MAX_PER_CLUB,
      benchWeight: BENCH_WEIGHT,
      captainMultiplier: CAPTAIN_MULTIPLIER,
    },
  );
  if (!solution) return null;
  const rowsFor = (ids: number[]) =>
    ids.map((id) => byId.get(id)).filter((row): row is MyTeamRow => row != null);
  const starters = rowsFor(solution.starters);
  const benchRows = rowsFor(solution.bench);
  const captainId = solution.captain;

  const byScore = (a: MyTeamRow, b: MyTeamRow) => score(b) - score(a);
  const viceId = [...starters].sort(byScore).find((row) => row.id !== captainId)?.id;
  const currentIds = new Set(currentSquad.map((row) => row.id));
  const toSlot = (row: MyTeamRow): LineupSlot => ({
    row,
    isCaptain: row.id === captainId,
    isViceCaptain: row.id === viceId,
    change: currentIds.has(row.id) ? undefined : 'new',
  });
  // Backup keeper first, as FPL requires; outfielders best first.
  const bench = [
    ...benchRows.filter((row) => row.position === 'GKP'),
    ...benchRows.filter((row) => row.position !== 'GKP').sort(byScore),
  ];
  const squad = [...starters, ...bench];
  const squadIds = new Set(squad.map((row) => row.id));
  const captain = starters.find((row) => row.id === captainId);

  return {
    lineup: { starters: starters.map(toSlot), bench: bench.map(toSlot) },
    cost: squad.reduce((sum, row) => sum + tenths(row.price), 0) / 10,
    score:
      starters.reduce((sum, row) => sum + score(row), 0) +
      (captain ? score(captain) * (CAPTAIN_MULTIPLIER - 1) : 0),
    incoming: squad.filter((row) => !currentIds.has(row.id)),
    outgoing: currentSquad.filter((row) => !squadIds.has(row.id)),
    optimal: solution.optimal,
  };
}

/**
 * Drops players who can never be in an optimal squad, to keep the
 * search small. A player is dominated by anyone in the same
 * position who costs no more and scores no less. Swapping in a dominator
 * never hurts, unless it's already picked or its club is full: at most
 * `SQUAD_SHAPE − 1` clubs hold the position's other picks and at most
 * `MAX_FULL_CLUBS` are full. So a player with dominators from more
 * distinct clubs than that can always be swapped out, and is dropped.
 */
function pruneDominated(
  pool: readonly MyTeamRow[],
  score: (row: MyTeamRow) => number,
): MyTeamRow[] {
  const kept: MyTeamRow[] = [];
  for (const position of POSITION_CODES) {
    const limit = SQUAD_SHAPE[position] - 1 + MAX_FULL_CLUBS;
    const rows = pool.filter((row) => row.position === position);
    for (const row of rows) {
      const clubs = new Set<string>();
      for (const other of rows) {
        if (other.id === row.id) continue;
        const cheaperOrEqual = tenths(other.price) <= tenths(row.price);
        const betterOrEqual = score(other) >= score(row);
        const strictly =
          tenths(other.price) < tenths(row.price) ||
          score(other) > score(row) ||
          other.id < row.id;
        if (cheaperOrEqual && betterOrEqual && strictly) {
          clubs.add(other.team);
          if (clubs.size > limit) break;
        }
      }
      if (clubs.size <= limit) kept.push(row);
    }
  }
  return kept;
}
