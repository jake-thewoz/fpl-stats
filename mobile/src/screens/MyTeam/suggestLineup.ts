import { FIELD_DEFS } from '../../players/fields';
import type { PositionCode } from '../../players/positions';
import type { FieldKey } from '../../players/types';
import type { Lineup, LineupSlot } from './lineup';
import type { MyTeamRow } from './types';

/** Signals the picker can optimise for. All describe a single gameweek;
 *  horizon xP is left out because a lineup only scores for one week. */
export const LINEUP_METRICS = [
  'xp',
  'form',
  'points_per_game',
] as const satisfies readonly FieldKey[];
export type LineupMetric = (typeof LINEUP_METRICS)[number];
export const DEFAULT_LINEUP_METRIC: LineupMetric = 'xp';

/** FPL's legal starting-XI shape: exactly one keeper, then outfield
 *  counts within these bounds summing to ten. */
const STARTER_LIMITS: Record<PositionCode, { min: number; max: number }> = {
  GKP: { min: 1, max: 1 },
  DEF: { min: 3, max: 5 },
  MID: { min: 2, max: 5 },
  FWD: { min: 1, max: 3 },
};
const STARTING_XI_SIZE = 11;
/** The captain's score counts twice. Triple Captain is ignored: the
 *  suggestion is for next gameweek, and we can't see chips played there. */
const CAPTAIN_MULTIPLIER = 2;

export type LineupSuggestion = {
  lineup: Lineup;
  /** Metric total for the suggested XI, captain counted double. */
  suggestedScore: number;
  /** Same total for the user's own XI and armband, for comparison. */
  currentScore: number;
};

type Formation = Record<PositionCode, number>;

/** Every legal formation, e.g. { GKP: 1, DEF: 4, MID: 4, FWD: 2 }. */
function legalFormations(): Formation[] {
  const formations: Formation[] = [];
  for (let def = STARTER_LIMITS.DEF.min; def <= STARTER_LIMITS.DEF.max; def++) {
    for (let mid = STARTER_LIMITS.MID.min; mid <= STARTER_LIMITS.MID.max; mid++) {
      for (let fwd = STARTER_LIMITS.FWD.min; fwd <= STARTER_LIMITS.FWD.max; fwd++) {
        if (STARTER_LIMITS.GKP.min + def + mid + fwd === STARTING_XI_SIZE) {
          formations.push({ GKP: STARTER_LIMITS.GKP.min, DEF: def, MID: mid, FWD: fwd });
        }
      }
    }
  }
  return formations;
}

/**
 * Best XI, captain and vice from the squad by `metric`.
 *
 * Tries every legal formation, filling each position with its
 * highest-scoring players, and keeps the best total. That is exact, not
 * a heuristic: within a fixed formation the positions are independent,
 * so the top N per position is optimal. Captaincy can't change which
 * formation wins: the squad's top scorer leads their position, and every
 * formation starts at least one of each, so the best captain is in every
 * candidate XI.
 *
 * Ties go to the user's current choice, so equal-scoring alternatives
 * never show up as pointless swaps. A missing metric value scores 0.
 *
 * Returns null when the squad can't field a legal XI (e.g. a partial
 * squad because some players failed to load).
 */
export function suggestLineup(
  rows: readonly MyTeamRow[],
  metric: LineupMetric,
): LineupSuggestion | null {
  const score = (row: MyTeamRow) => FIELD_DEFS[metric].accessor(row) ?? 0;
  // Starters hold slots 1–11, so the slot tie-break favours them.
  const byPreference = (a: MyTeamRow, b: MyTeamRow) =>
    score(b) - score(a) || a.squadSlot - b.squadSlot;

  const rankedByPosition = (position: PositionCode) =>
    rows.filter((row) => row.position === position).sort(byPreference);
  const ranked: Record<PositionCode, MyTeamRow[]> = {
    GKP: rankedByPosition('GKP'),
    DEF: rankedByPosition('DEF'),
    MID: rankedByPosition('MID'),
    FWD: rankedByPosition('FWD'),
  };

  let best: { starters: MyTeamRow[]; total: number; kept: number } | null = null;
  for (const formation of legalFormations()) {
    const positions = Object.keys(formation) as PositionCode[];
    if (positions.some((position) => ranked[position].length < formation[position])) {
      continue;
    }
    const starters = positions.flatMap((position) =>
      ranked[position].slice(0, formation[position]),
    );
    const total = starters.reduce((sum, row) => sum + score(row), 0);
    const kept = starters.filter((row) => row.isStarter).length;
    if (!best || total > best.total || (total === best.total && kept > best.kept)) {
      best = { starters, total, kept };
    }
  }
  if (!best) return null;

  const [captain, viceCaptain] = [...best.starters].sort(
    (a, b) =>
      score(b) - score(a) ||
      Number(b.isCaptain) - Number(a.isCaptain) ||
      Number(b.isViceCaptain) - Number(a.isViceCaptain) ||
      a.squadSlot - b.squadSlot,
  );

  const starterIds = new Set(best.starters.map((row) => row.id));
  const toSlot = (row: MyTeamRow): LineupSlot => ({
    row,
    isCaptain: row.id === captain?.id,
    isViceCaptain: row.id === viceCaptain?.id,
    change:
      starterIds.has(row.id) && !row.isStarter
        ? 'in'
        : !starterIds.has(row.id) && row.isStarter
          ? 'out'
          : undefined,
  });

  const benchRows = rows.filter((row) => !starterIds.has(row.id));
  // FPL requires the backup keeper in the first bench slot; outfielders
  // follow in auto-sub priority, best first.
  const bench = [
    ...benchRows.filter((row) => row.position === 'GKP'),
    ...benchRows.filter((row) => row.position !== 'GKP').sort(byPreference),
  ];

  const lineup: Lineup = {
    starters: best.starters.map(toSlot),
    bench: bench.map(toSlot),
  };
  return {
    lineup,
    suggestedScore: lineupScore(best.starters, captain, score),
    currentScore: lineupScore(
      rows.filter((row) => row.isStarter),
      rows.find((row) => row.isCaptain),
      score,
    ),
  };
}

function lineupScore(
  starters: readonly MyTeamRow[],
  captain: MyTeamRow | undefined,
  score: (row: MyTeamRow) => number,
): number {
  const base = starters.reduce((sum, row) => sum + score(row), 0);
  return captain ? base + score(captain) * (CAPTAIN_MULTIPLIER - 1) : base;
}
