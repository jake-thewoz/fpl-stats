/**
 * Fixture difficulty colouring: the three-tone scale for the Transfers
 * compare-table cells, and the five-stop chip scale for the fixture strip.
 *
 * FPL fixture difficulty on `SuggestionPlayer` (1–5 scale, lower =
 * easier) maps onto a three-stop tone scale so the table cells share
 * the same heat-map vocabulary.
 *
 * Thresholds were tuned by eye against current-season fixtures —
 * they're surface-level UX tuning, not derived constants, so they
 * live here next to the screen rather than at the API layer.
 */

import type { Colors } from '../theme/colors';
import { HARDEST_DIFFICULTY } from '../fixtures/upcoming';
import { mixHex, type HeatColor } from '../theme/heat';

/** Inclusive: difficulty ≤ this maps to "good". */
export const DIFFICULTY_GOOD_MAX = 2.5;
/** Exclusive: difficulty < this maps to "mid". */
export const DIFFICULTY_MID_MAX = 3.5;

export type ColorTone = 'good' | 'mid' | 'bad' | null;

/** Returns `null` for null inputs so the caller can render a neutral
 *  cell — null doesn't mean "bad", it means "no data". */
export function difficultyTone(value: number | null): ColorTone {
  if (value == null) return null;
  if (value <= DIFFICULTY_GOOD_MAX) return 'good';
  if (value < DIFFICULTY_MID_MAX) return 'mid';
  return 'bad';
}

const EASIEST_DIFFICULTY = 1;
const EASY_DIFFICULTY = 2;
const HARD_DIFFICULTY = 4;
/** How far the in-between ratings (2 and 4) lean from the neutral chip
 *  toward mint or coral. Strong enough to tell apart from a 3, soft
 *  enough that `textPrimary` still reads on top. */
const EASY_TINT = 0.4;
const HARD_TINT = 0.45;

/**
 * Chip colours for one fixture on FPL's 1–5 difficulty scale, used by the
 * fixture strip: mint (1) → mint tint (2) → neutral (3) → coral tint (4)
 * → coral (5). An unrated fixture renders neutral.
 */
export function fixtureDifficultyColor(
  difficulty: number | null,
  colors: Colors,
): HeatColor {
  if (difficulty == null)
    return { background: colors.surfaceRaised, text: colors.textMuted };
  if (difficulty <= EASIEST_DIFFICULTY)
    return { background: colors.good, text: colors.onGood };
  if (difficulty <= EASY_DIFFICULTY) {
    return {
      background: mixHex(colors.surfaceRaised, colors.good, EASY_TINT),
      text: colors.textPrimary,
    };
  }
  if (difficulty < HARD_DIFFICULTY)
    return { background: colors.surfaceRaised, text: colors.textMuted };
  if (difficulty < HARDEST_DIFFICULTY) {
    return {
      background: mixHex(colors.surfaceRaised, colors.bad, HARD_TINT),
      text: colors.textPrimary,
    };
  }
  return { background: colors.bad, text: colors.onBad };
}
