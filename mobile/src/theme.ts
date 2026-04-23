// App-wide color palette. Raw values come from the Coolors palette we picked:
// a near-black, eggplant, mauve, sage, and mint. `colors` exposes semantic
// roles so screens don't hardcode hex values and we can retune the palette in
// one place later.

export const palette = {
  black: '#070707',
  eggplant: '#553555',
  mauve: '#755b69',
  sage: '#96c5b0',
  mint: '#adf1d2',
} as const;

// Semantic tokens for UI roles. A couple of values live outside the 5-color
// palette on purpose:
//   - `background`/`surface`: the palette has no light neutral, so we use
//     near-white for readable content surfaces.
//   - `border`: subtle black-at-low-opacity reads as a neutral divider that
//     harmonizes with every palette hue instead of picking one.
//   - `danger`/`warning`: the palette has no red or yellow; these are
//     harmonized tones we can pull into the palette proper later.
export const colors = {
  background: '#fbfbfc',
  surface: '#ffffff',
  border: 'rgba(7, 7, 7, 0.08)',
  textPrimary: palette.black,
  textMuted: palette.mauve,
  // Primary brand color — used for interactive accents and selected state.
  accent: palette.eggplant,
  // Softer secondary accent — good for non-critical highlights.
  accentSoft: palette.sage,
  // Lightest brand tone — good for subtle backgrounds or hover states.
  highlight: palette.mint,
  // Readable text/icon colors on top of the respective accent backgrounds.
  onAccent: '#ffffff',
  onAccentSoft: palette.black,
  onHighlight: palette.black,
  danger: '#c0495c',
  warning: '#e0b340',
} as const;
