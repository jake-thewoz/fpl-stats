/**
 * Light + dark palettes for the app theme.
 *
 * Both export the same `Colors` shape — a set of *semantic* tokens
 * (`background`, `accent`, `goodText`, etc.) that screens and components
 * consume through `useTheme()` / `useThemedStyles()`. Adding or renaming
 * a token is a contract change: every palette has to define it, and every
 * consumer reads it through the typed shape.
 *
 * The palette is saturated **grape and mint**, with coral for bad numbers.
 * Light and dark get equal weight; dark ("Plum") is lifted and visibly
 * purple rather than near-black, so dark mode feels colourful instead of
 * gloomy. Design reference: https://claude.ai/artifact/FcY2ixeJRnRiHHmaLt6em3
 *
 * Three families of token, and the rule for picking between them:
 *
 * - **Fills** (`accent`, `good`, `bad`, `warning`) are backgrounds, each
 *   paired with an `on*` colour for text sitting on top of them.
 * - **`*Text`** (`accentText`, `goodText`, `badText`) are the same hues
 *   tuned to read as text or icons on `surface` / `background`. Mint and
 *   coral are bright enough to fill a chip in light mode but too light to
 *   read as text on white, so light mode darkens them; dark mode lifts
 *   them slightly for the same reason in reverse.
 * - **Surfaces** (`background` < `surface` < `surfaceRaised`) step up in
 *   lightness in dark mode and down in light mode. `surfaceRaised` is the
 *   resting fill for chips, segmented-control tracks and empty heat cells.
 *
 * Every text pair is at least 4.5:1 (WCAG AA). The tightest are light
 * `goodText` on white (4.53) and white on the dark hero gradient's start
 * (4.71); don't lighten either.
 */

/** Colours of the app icon, splash and web manifest. These still carry
 *  the original eggplant/mint brand mark until the brand assets move to
 *  the new palette (issue #208); the in-app theme no longer uses them. */
export const brandPalette = {
  black: '#070707',
  eggplant: '#553555',
  mint: '#adf1d2',
} as const;

/** Semantic token shape every palette must implement. Adding a token
 *  here is a contract change — palettes need to fill it in. */
export type Colors = {
  background: string;
  surface: string;
  /** Chips, segmented-control tracks, and the empty end of the heat scale. */
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  /** Grape. Interactive accents, selected state, primary buttons. */
  accent: string;
  onAccent: string;
  /** Translucent grape for quiet selection: the selected-tab pill, active
   *  filter chips, the user's own row in a table. Text on it uses
   *  `accentText`. */
  accentSoft: string;
  /** Accent used as text or an icon on a surface. */
  accentText: string;
  /** Mint. A good number: heat fills, the LIVE pill, positive deltas. */
  good: string;
  onGood: string;
  goodText: string;
  /** Coral. A bad number: hard fixtures, negative deltas, destructive
   *  actions, errors. */
  bad: string;
  onBad: string;
  badText: string;
  /** Amber. Cautions that aren't a bad number, e.g. the Free Hit notice. */
  warning: string;
  onWarning: string;
  /** Hero card gradient, start → end, always carrying white text. A tuple
   *  so it drops straight into `LinearGradient`'s `colors` prop. */
  heroGradient: readonly [string, string];
  onHero: string;
  /** Modal-backdrop scrim. The same value in both palettes — a
   *  dim-the-world overlay reads more confidently than a theme-tinted one. */
  scrim: string;
  /** My Team pitch view: grass, the alternate mowing-stripe band, the
   *  touchline/halfway markings, and the name plate under each shirt. */
  pitch: string;
  pitchStripe: string;
  pitchLine: string;
  pitchTile: string;
};

const WHITE = '#ffffff';
const MINT = '#3ef0b4';
const ON_MINT = '#04261a';
const CORAL = '#ff6b81';
const ON_CORAL = '#2b0610';
// Amber is shared between modes like mint and coral: a saturated fill
// with dark text reads in both, so only the text-on-surface variants
// need per-mode tuning.
const AMBER = '#ffc24b';
const ON_AMBER = '#2a1a00';
const SCRIM = 'rgba(7, 7, 7, 0.45)';

export const lightColors: Colors = {
  background: '#fbf8fd',
  surface: WHITE,
  surfaceRaised: '#f0e8f5',
  border: 'rgba(26, 16, 32, 0.09)',
  textPrimary: '#1a1020',
  textMuted: '#6f5a7c',
  accent: '#7b2cbf',
  onAccent: WHITE,
  accentSoft: 'rgba(123, 44, 191, 0.12)',
  accentText: '#6a1fae',
  good: MINT,
  onGood: ON_MINT,
  goodText: '#08875e',
  bad: CORAL,
  onBad: ON_CORAL,
  badText: '#c92a43',
  warning: AMBER,
  onWarning: ON_AMBER,
  heroGradient: ['#8a35dc', '#5a1a9e'],
  onHero: WHITE,
  scrim: SCRIM,
  pitch: '#2f9a62',
  pitchStripe: '#35a56a',
  pitchLine: 'rgba(255, 255, 255, 0.5)',
  pitchTile: '#1a1020',
};

export const darkColors: Colors = {
  background: '#1a1124',
  surface: '#251832',
  surfaceRaised: '#332342',
  border: 'rgba(255, 255, 255, 0.09)',
  textPrimary: '#f8f3fb',
  textMuted: '#c6b5d1',
  accent: '#c77dff',
  // White on the light grape is under 3:1; near-black grape is crisp.
  onAccent: '#160b20',
  accentSoft: 'rgba(199, 125, 255, 0.20)',
  accentText: '#d9a6ff',
  good: MINT,
  onGood: ON_MINT,
  goodText: MINT,
  bad: CORAL,
  onBad: ON_CORAL,
  badText: '#ff8fa0',
  warning: AMBER,
  onWarning: ON_AMBER,
  heroGradient: ['#9a46ec', '#6420b0'],
  onHero: WHITE,
  scrim: SCRIM,
  // Darker grass than light mode so the pitch doesn't glow against the
  // plum page; lines dimmed to match.
  pitch: '#1f6b45',
  pitchStripe: '#237550',
  pitchLine: 'rgba(255, 255, 255, 0.35)',
  pitchTile: '#1a1022',
};
