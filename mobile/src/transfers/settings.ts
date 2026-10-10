/**
 * User-adjustable inputs to the transfer-suggestion search, alongside the
 * horizon and position filter.
 *
 * The numeric limits mirror the backend's `analyze_transfer_suggestions`
 * constants (MAX_BUNDLE_SIZE, DEFAULT_MAX_TRANSFERS,
 * MAX_BANKED_FREE_TRANSFERS). The server clamps anyway; these only shape
 * what the picker offers.
 */

const MAX_BUNDLE_SIZE = 3;
const MAX_BANKED_FREE_TRANSFERS = 5;

export const MAX_TRANSFER_OPTIONS = range(1, MAX_BUNDLE_SIZE);
export const FREE_TRANSFER_OPTIONS = range(0, MAX_BANKED_FREE_TRANSFERS);
export const DEFAULT_MAX_TRANSFERS = 2;

export type TransferSettings = {
  /** Largest bundle size the search considers. */
  maxTransfers: number;
  /** User-entered FT count, or null to use the count derived from FPL
   *  history. */
  freeTransfersOverride: number | null;
};

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  maxTransfers: DEFAULT_MAX_TRANSFERS,
  freeTransfersOverride: null,
};

/** Picking the derived value clears the override, so the count keeps
 *  tracking FPL history across gameweeks instead of freezing. */
export function freeTransfersOverrideFor(
  picked: number,
  derived: number | undefined,
): number | null {
  return picked === derived ? null : picked;
}

/** How many filter-dialog settings differ from their defaults; drives
 *  the "Filter (N)" badge. */
export function countActiveFilters(
  positions: readonly number[],
  settings: TransferSettings,
): number {
  return (
    positions.length +
    (settings.maxTransfers !== DEFAULT_MAX_TRANSFERS ? 1 : 0) +
    (settings.freeTransfersOverride !== null ? 1 : 0)
  );
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function range(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
