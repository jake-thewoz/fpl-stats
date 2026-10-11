/** Display formatting for transfer suggestions. */

// FPL prices are in tenths of a million: a cost_change of 16 is £1.6m.
const PRICE_UNITS_PER_MILLION = 10;

/** Signed xP, e.g. "+11.1" or "−0.4". Zero reads as a gain ("+0.0"). */
export function formatXpDelta(deltaXp: number): string {
  return `${deltaXp >= 0 ? '+' : '−'}${Math.abs(deltaXp).toFixed(1)}`;
}

/**
 * The user's bank delta for a swap, e.g. "+£0.5m" or "−£1.6m".
 * `costChange` is FPL's API form (positive = the swap costs money), so
 * it's negated: positive here means the user gains money.
 */
export function bankDelta(costChange: number): number {
  return -costChange / PRICE_UNITS_PER_MILLION;
}

export function formatBankDelta(costChange: number): string {
  const delta = bankDelta(costChange);
  if (delta === 0) return '£0.0m';
  return `${delta > 0 ? '+' : '−'}£${Math.abs(delta).toFixed(1)}m`;
}
