/**
 * FPL rank / point formatting helpers used by the Friends screen.
 *
 * Ranks compact above 10k so a 2.7M overall rank still fits in the
 * narrow column. Below 10k the full localized number reads cleanly.
 */

/** Ranks at or above this format as `1.2M`. */
export const RANK_MILLIONS_MIN = 1_000_000;
/** Ranks at or above this (and below `RANK_MILLIONS_MIN`) format as `123k`. */
export const RANK_THOUSANDS_MIN = 10_000;

export function formatRank(n: number | null): string {
  if (n == null) return '—';
  if (n >= RANK_MILLIONS_MIN) return `${(n / RANK_MILLIONS_MIN).toFixed(1)}M`;
  if (n >= RANK_THOUSANDS_MIN) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

export function formatInt(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}
