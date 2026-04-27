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
 * - **`accent`** — promoted from eggplant to **mauve** on dark. The
 *   eggplant disappears against a near-black surface; mauve is the
 *   same hue, brighter chroma, and reads as "interactive" without
 *   overpowering content text.
 * - **`textMuted`** — a desaturated mauve (`#a394a0`). Pure grey on a
 *   purple-cool surface looks dingy; keeping a hint of the brand hue
 *   makes muted text feel intentional.
 * - **`accentSoft`** — sage stays put (it already reads well on dark).
 * - **`highlight`** — mint stays put for the same reason.
 * - **`onAccent`** flips to white on the dark palette since the dark
 *   accent (mauve) is mid-tone — white reads more confidently than
 *   the light-mode eggplant-on-white pairing did.
 * - **`danger`/`warning`** brighter variants. The light-mode
 *   `#c0495c` red drowns on a dark background; `#e0667a` lifts it.
 *   Same logic for `warning`.
 */
export const darkPalette = {
  black: '#070707',
  eggplant: '#553555',
  mauve: '#755b69',
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
};

export const darkColors: Colors = {
  background: '#0e0d12',
  surface: '#171520',
  border: 'rgba(255, 255, 255, 0.10)',
  textPrimary: '#f4f1f7',
  textMuted: '#a394a0',
  // Promoted from eggplant to mauve so it actually reads on dark.
  accent: darkPalette.mauve,
  accentSoft: darkPalette.sage,
  highlight: darkPalette.mint,
  onAccent: '#ffffff',
  onAccentSoft: darkPalette.black,
  onHighlight: darkPalette.black,
  // Lifted versions of light-mode danger/warning for legibility on dark.
  danger: '#e0667a',
  warning: '#f0c860',
};
