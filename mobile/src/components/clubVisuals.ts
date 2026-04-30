/**
 * Club kit colours + pattern variants for the player-row gradient
 * background. Keyed by FPL's ``team.short_name`` (3-letter code), which
 * is what ``JoinedPlayer.team`` ships on every list row.
 *
 * The three pattern variants the renderer knows about:
 *
 * - ``solid``: single dominant kit colour. Most clubs.
 * - ``framed``: two colours arranged as a centred main-colour band with
 *   secondary-colour edges either side, mimicking sleeve trim (Arsenal-
 *   style red shirt with white sleeves, Villa's claret with sky-blue
 *   sleeves, etc.).
 * - ``stripes``: alternating vertical bands of two colours, mimicking a
 *   striped kit (Brentford red+white, Newcastle black+white, Brighton
 *   blue+white, Crystal Palace red+blue).
 *
 * Notes on a few specific calls:
 *
 * - **Tottenham / Fulham**: kits are mostly white. A "solid white" gradient
 *   would be invisible on the off-white surface, so we use a darker accent
 *   (Spurs navy, Fulham black) as the dominant colour. Loses some kit
 *   accuracy but keeps the row visually identifiable.
 * - **Closely-similar pairs** (Liverpool / Forest / Bournemouth red,
 *   Burnley / Villa claret-with-sky-blue, Man City / Brighton blue-ish):
 *   accepted per the original brief. Kit identity over distinguishability.
 *
 * Hex values are best-effort renderings of common-knowledge primary and
 * secondary kit colours; nudge any one freely if a club ships looking
 * off — they're per-club tunables.
 */

export type ClubPatternVariant = 'solid' | 'framed' | 'stripes';

export type ClubVisual = {
  pattern: ClubPatternVariant;
  /** Pattern colour(s). Length depends on variant: ``solid`` → 1,
   *  ``framed`` → 2 (primary, secondary), ``stripes`` → 2 (alternating). */
  colors: readonly string[];
};

export const CLUB_VISUALS: Record<string, ClubVisual> = {
  ARS: { pattern: 'framed', colors: ['#ef0107', '#ffffff'] },
  AVL: { pattern: 'framed', colors: ['#670e36', '#95bfe5'] },
  BHA: { pattern: 'stripes', colors: ['#0057b8', '#ffffff'] },
  BOU: { pattern: 'solid', colors: ['#da291c'] },
  BRE: { pattern: 'stripes', colors: ['#e30613', '#ffffff'] },
  BUR: { pattern: 'framed', colors: ['#6c1d45', '#99d6ea'] },
  CHE: { pattern: 'solid', colors: ['#034694'] },
  CRY: { pattern: 'stripes', colors: ['#1b458f', '#c4122e'] },
  EVE: { pattern: 'solid', colors: ['#003399'] },
  FUL: { pattern: 'framed', colors: ['#000000', '#ffffff'] },
  LEE: { pattern: 'solid', colors: ['#ffe14a'] },
  LIV: { pattern: 'solid', colors: ['#c8102e'] },
  MCI: { pattern: 'solid', colors: ['#6cabdd'] },
  MUN: { pattern: 'solid', colors: ['#da291c'] },
  NEW: { pattern: 'stripes', colors: ['#000000', '#ffffff'] },
  NFO: { pattern: 'solid', colors: ['#dd0000'] },
  SUN: { pattern: 'stripes', colors: ['#eb1a22', '#ffffff'] },
  TOT: { pattern: 'solid', colors: ['#132257'] },
  WHU: { pattern: 'framed', colors: ['#7a263a', '#1bb1e7'] },
  WOL: { pattern: 'solid', colors: ['#fdb913'] },
};
