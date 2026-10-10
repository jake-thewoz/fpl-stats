import { POSITION_CODES, type PositionCode } from '../../players/positions';
import type { MyTeamRow } from './types';

/** One player's place in a lineup. Captaincy lives here rather than on
 *  the row so a lineup other than the one the user actually picked
 *  (e.g. a suggested XI) can carry its own armband. */
export type LineupSlot = {
  row: MyTeamRow;
  isCaptain: boolean;
  isViceCaptain: boolean;
  /** Set on a suggested lineup: 'in' = benched player promoted to the XI,
   *  'out' = starter moved to the bench. */
  change?: LineupChange;
};

export type LineupChange = 'in' | 'out';

export type Lineup = {
  /** Starting XI, in no particular order — the pitch groups by position. */
  starters: LineupSlot[];
  /** Bench in substitution order (backup GK first, as FPL enforces). */
  bench: LineupSlot[];
};

/** The lineup the user actually picked for the gameweek. */
export function lineupFromPicks(rows: readonly MyTeamRow[]): Lineup {
  const toSlot = (row: MyTeamRow): LineupSlot => ({
    row,
    isCaptain: row.isCaptain,
    isViceCaptain: row.isViceCaptain,
  });
  const bySquadSlot = [...rows].sort((a, b) => a.squadSlot - b.squadSlot);
  return {
    starters: bySquadSlot.filter((row) => row.isStarter).map(toSlot),
    bench: bySquadSlot.filter((row) => !row.isStarter).map(toSlot),
  };
}

/** Starters grouped into pitch rows, goalkeeper first. Positions with no
 *  starters are omitted so a partial squad doesn't render empty bands. */
export function startersByPosition(
  lineup: Lineup,
): { position: PositionCode; slots: LineupSlot[] }[] {
  return POSITION_CODES.map((position) => ({
    position,
    slots: lineup.starters.filter((slot) => slot.row.position === position),
  })).filter((band) => band.slots.length > 0);
}

/** Outfield shape in the usual "DEF-MID-FWD" notation, e.g. "4-4-2". */
export function formationLabel(lineup: Lineup): string {
  return startersByPosition(lineup)
    .filter((band) => band.position !== 'GKP')
    .map((band) => band.slots.length)
    .join('-');
}
