/**
 * Light + dark palettes for the app theme.
 *
 * Both export the same `Colors` shape — a set of *semantic* tokens
 * (`background`, `accent`, `textMuted`, etc.) that screens and
 * components consume through `useTheme()` / `useThemedStyles()`. Adding
 * or renaming a token is a contract change: every palette has to define
 * it, and every consumer reads it through the typed shape.
 *
 * Light mode is the original Coolors palette: a near-black, eggplant,
 * mauve, sage, and mint on near-white surfaces. Dark mode is a
 * complementary palette on a slightly purple-cool near-black surface so
 * the eggplant/mauve hue family stays at home in both modes — see the
 * dark-palette commentary below for the per-token reasoning.
 */

export const lightPalette = {
  black: '#070707',
  eggplant: '#553555',
  mauve: '#755b69',
  sage: '#96c5b0',
  mint: '#adf1d2',
} as const;

/**
 * Dark-mode palette tuning notes:
 *
 * - **`background` `#0e0d12`** — slightly purple-cool near-black. A pure
 *   neutral grey would clash with the eggplant accent; pulling a hint
 *   of violet keeps the surface family-related to the brand hue.
 * - **`surface` `#171520`** — one step lighter than background, same
 *   undertone, so cards and headers separate from the page without
 *   needing a hard border.
 * - **`border`** — white-at-low-opacity. Mirrors the light palette
 *   trick of a low-opacity neutral border that harmonizes with every
 *   palette hue rather than picking one.
 * - **`accent` `#c69ab8`** — light mauve. The light-mode eggplant
 *   (`#553555`) and the original dark-mode mauve (`#755b69`) both
 *   disappear against a near-black surface; pushing further up the
 *   lightness scale keeps the mauve hue but gives enough contrast for
 *   tab-bar icons, sort arrows, and chip text to actually read.
 * - **`textMuted` `#c2b3be`** — bright desaturated mauve. A
 *   neutral grey on a purple-cool surface looks dingy; keeping a hint
 *   of the brand hue makes muted text feel intentional. Tuned upward
 *   from the original `#a394a0` for legibility on small UI like the
 *   tab bar's inactive-tab labels.
 * - **`accentSoft`** — sage stays put (it already reads well on dark).
 * - **`highlight`** — mint stays put for the same reason.
 * - **`onAccent`** stays black-on-light-mauve. The brighter dark-mode
 *   accent is too light for white text to read confidently against;
 *   black gives a clean, high-contrast pairing.
 * - **`danger`/`warning`** brighter variants. The light-mode
 *   `#c0495c` red drowns on a dark background; `#e0667a` lifts it.
 *   Same logic for `warning`.
 */
export const darkPalette = {
  black: '#070707',
  eggplant: '#553555',
  // Light mauve — the dark-mode-specific accent variant. Bright enough
  // to read against `surface` and `background` while staying in the
  // brand hue family.
  mauveLight: '#c69ab8',
  sage: '#96c5b0',
  mint: '#adf1d2',
} as const;

/** Semantic token shape every palette must implement. Adding a token
 *  here is a contract change — palettes need to fill it in. */
export type Colors = {
  background: string;
  surface: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  /** Primary brand color — used for interactive accents and selected state. */
  accent: string;
  /** Softer secondary accent — good for non-critical highlights. */
  accentSoft: string;
  /** Lightest brand tone — good for subtle backgrounds or hover states. */
  highlight: string;
  /** Readable text/icon colors on top of the respective accent backgrounds. */
  onAccent: string;
  onAccentSoft: string;
  onHighlight: string;
  danger: string;
  warning: string;
  /** Readable text/icon colors on top of warning/danger backgrounds. */
  onWarning: string;
  onDanger: string;
  /** Position chip colors — earth-toned mapping of FPL's classic
   *  GKP=yellow / DEF=blue / MID=green / FWD=red. Used by the
   *  ``PositionChip`` component on the player-list sublines. */
  posGkp: string;
  posDef: string;
  posMid: string;
  posFwd: string;
  onPosGkp: string;
  onPosDef: string;
  onPosMid: string;
  onPosFwd: string;
};

export const lightColors: Colors = {
  background: '#fbfbfc',
  surface: '#ffffff',
  border: 'rgba(7, 7, 7, 0.08)',
  textPrimary: lightPalette.black,
  textMuted: lightPalette.mauve,
  accent: lightPalette.eggplant,
  accentSoft: lightPalette.sage,
  highlight: lightPalette.mint,
  onAccent: '#ffffff',
  onAccentSoft: lightPalette.black,
  onHighlight: lightPalette.black,
  danger: '#c0495c',
  warning: '#e0b340',
  // Black on warning's amber ≈ 7:1; white on danger's brick ≈ 4.6:1.
  onWarning: lightPalette.black,
  onDanger: '#ffffff',
  // Earth-toned position chips. Darker / more saturated than the
  // dark-mode counterparts so they read against the off-white surface.
  posGkp: '#d4a017',  // amber
  posDef: '#4f7c9c',  // slate-blue
  posMid: '#5c9c7e',  // sage-green (deeper than accentSoft so chips don't blur into "good fixture" cells)
  posFwd: '#b8584b',  // terracotta
  onPosGkp: lightPalette.black,
  onPosDef: '#ffffff',
  onPosMid: lightPalette.black,
  onPosFwd: '#ffffff',
};

export const darkColors: Colors = {
  background: '#0e0d12',
  surface: '#171520',
  border: 'rgba(255, 255, 255, 0.10)',
  textPrimary: '#f4f1f7',
  textMuted: '#c2b3be',
  // Light mauve — bright enough to read against the near-black surface
  // for tab-bar icons, sort arrows, and chip text.
  accent: darkPalette.mauveLight,
  accentSoft: darkPalette.sage,
  highlight: darkPalette.mint,
  // Black on light-mauve gives crisp 8.4:1 contrast; white drops to ~3:1
  // and makes filled buttons feel washed out.
  onAccent: darkPalette.black,
  onAccentSoft: darkPalette.black,
  onHighlight: darkPalette.black,
  // Lifted versions of light-mode danger/warning for legibility on dark.
  danger: '#e0667a',
  warning: '#f0c860',
  // Both lifted tones land light enough that black text wins on contrast
  // (warning ~10:1 / danger ~6:1); white falls below 3:1 on warning.
  onWarning: darkPalette.black,
  onDanger: darkPalette.black,
  // Lifted versions of the light-mode position chips. Same hues, pushed
  // up the lightness scale to read against the near-black background.
  // All four pair with black text in dark mode.
  posGkp: '#e6b740',
  posDef: '#7eaad0',
  posMid: '#a8d5c0',
  posFwd: '#d2776b',
  onPosGkp: darkPalette.black,
  onPosDef: darkPalette.black,
  onPosMid: darkPalette.black,
  onPosFwd: darkPalette.black,
};
