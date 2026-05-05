/**
 * Tier scoring for the Transfers compare-table cells.
 *
 * Two metrics live on `SuggestionPlayer` — FPL fixture difficulty
 * (1–5 scale, lower = easier) and a ClubELO-derived expected score
 * (0–1, higher = better). Both map onto the same three-stop tone
 * scale so the table cells share the same heat-map vocabulary.
 *
 * Thresholds were tuned by eye against current-season fixtures —
 * they're surface-level UX tuning, not derived constants, so they
 * live here next to the screen rather than at the API layer.
 */

/** Inclusive: difficulty ≤ this maps to "good". */
export const DIFFICULTY_GOOD_MAX = 2.5;
/** Exclusive: difficulty < this maps to "mid". */
export const DIFFICULTY_MID_MAX = 3.5;

/** Inclusive: ELO expected score ≥ this maps to "good". */
export const ELO_GOOD_MIN = 0.55;
/** Inclusive: ELO expected score ≥ this maps to "mid". */
export const ELO_MID_MIN = 0.45;

export type ColorTone = 'good' | 'mid' | 'bad' | null;

/** Returns `null` for null inputs so the caller can render a neutral
 *  cell — null doesn't mean "bad", it means "no data". */
export function difficultyTone(value: number | null): ColorTone {
  if (value == null) return null;
  if (value <= DIFFICULTY_GOOD_MAX) return 'good';
  if (value < DIFFICULTY_MID_MAX) return 'mid';
  return 'bad';
}

export function eloTone(value: number | null): ColorTone {
  if (value == null) return null;
  if (value >= ELO_GOOD_MIN) return 'good';
  if (value >= ELO_MID_MIN) return 'mid';
  return 'bad';
}
