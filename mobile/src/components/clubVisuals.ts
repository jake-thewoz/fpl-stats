/**
 * Club home-kit colours and patterns, drawn by `ClubShirt`. Keyed by FPL's
 * ``team.short_name`` (3-letter code), which is what ``JoinedPlayer.team``
 * ships on every list row.
 *
 * The pattern variants the shirt knows how to draw:
 *
 * - ``solid``: one colour. Most clubs.
 * - ``framed``: primary body with secondary sleeves (Arsenal's red with
 *   white sleeves, Villa's claret with sky-blue sleeves).
 * - ``stripes``: alternating vertical bands of two colours (Brentford,
 *   Newcastle, Brighton, Bournemouth, Crystal Palace).
 * - ``trimmed``: primary body with a secondary collar and outline. For
 *   white kits (Spurs, Fulham, Leeds), where the trim is what tells them
 *   apart.
 *
 * The shirt carries its own outline, so white and pale kits stay visible
 * on light surfaces; no club needs a substitute colour for contrast.
 *
 * Similar pairs (Liverpool / Forest / Man Utd red, Man City / Coventry sky
 * blue) are accepted: kit accuracy over distinguishability. Clubs outside
 * the current season stay in the map so they render if promoted again.
 *
 * Hex values are best-effort renderings of each club's home kit; nudge any
 * one freely if a club ships looking off.
 */

export type ClubPatternVariant = 'solid' | 'framed' | 'stripes' | 'trimmed';

export type ClubVisual = {
  pattern: ClubPatternVariant;
  /** Pattern colour(s). ``solid`` → 1; ``framed`` → body, sleeves;
   *  ``stripes`` → the two alternating bands; ``trimmed`` → body, trim. */
  colors: readonly string[];
};

export const CLUB_VISUALS: Record<string, ClubVisual> = {
  ARS: { pattern: 'framed', colors: ['#ef0107', '#ffffff'] },
  AVL: { pattern: 'framed', colors: ['#670e36', '#95bfe5'] },
  BHA: { pattern: 'stripes', colors: ['#0057b8', '#ffffff'] },
  BOU: { pattern: 'stripes', colors: ['#da291c', '#000000'] },
  BRE: { pattern: 'stripes', colors: ['#e30613', '#ffffff'] },
  BUR: { pattern: 'framed', colors: ['#6c1d45', '#99d6ea'] },
  CHE: { pattern: 'solid', colors: ['#034694'] },
  COV: { pattern: 'solid', colors: ['#6cb4e4'] },
  CRY: { pattern: 'stripes', colors: ['#1b458f', '#c4122e'] },
  EVE: { pattern: 'solid', colors: ['#003399'] },
  FUL: { pattern: 'trimmed', colors: ['#ffffff', '#000000'] },
  HUL: { pattern: 'stripes', colors: ['#f5a12d', '#000000'] },
  IPS: { pattern: 'framed', colors: ['#0044a9', '#ffffff'] },
  LEE: { pattern: 'trimmed', colors: ['#ffffff', '#1d428a'] },
  LIV: { pattern: 'solid', colors: ['#c8102e'] },
  MCI: { pattern: 'solid', colors: ['#6cabdd'] },
  MUN: { pattern: 'solid', colors: ['#da291c'] },
  NEW: { pattern: 'stripes', colors: ['#000000', '#ffffff'] },
  NFO: { pattern: 'solid', colors: ['#dd0000'] },
  SUN: { pattern: 'stripes', colors: ['#eb1a22', '#ffffff'] },
  TOT: { pattern: 'trimmed', colors: ['#ffffff', '#132257'] },
  WHU: { pattern: 'framed', colors: ['#7a263a', '#1bb1e7'] },
  WOL: { pattern: 'solid', colors: ['#fdb913'] },
};
