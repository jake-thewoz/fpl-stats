/**
 * Single source of truth for FPL element_type (position) metadata.
 *
 * The same four positions were defined three different ways in three
 * screens — string-only `['GKP', 'DEF', 'MID', 'FWD']` in PlayersScreen
 * and MyTeamScreen, and `[{id, label}]` in TransfersScreen. This module
 * is the canonical mapping; all three screens read from here.
 */

/** FPL element_type ids. Stable across seasons. */
export const POSITION_IDS = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
} as const;

export type PositionCode = keyof typeof POSITION_IDS;
export type PositionId = (typeof POSITION_IDS)[PositionCode];

/** Display order for player lists and group headers. */
export const POSITION_CODES = [
  'GKP',
  'DEF',
  'MID',
  'FWD',
] as const satisfies readonly PositionCode[];

export type PositionMeta = {
  id: PositionId;
  code: PositionCode;
  label: string;
};

/** Id-keyed position metadata — used by the Transfers position-filter
 *  dialog where the element_type id is the canonical identifier. */
export const POSITIONS_WITH_LABELS: readonly PositionMeta[] = [
  { id: POSITION_IDS.GKP, code: 'GKP', label: 'Goalkeepers' },
  { id: POSITION_IDS.DEF, code: 'DEF', label: 'Defenders' },
  { id: POSITION_IDS.MID, code: 'MID', label: 'Midfielders' },
  { id: POSITION_IDS.FWD, code: 'FWD', label: 'Forwards' },
] as const;
