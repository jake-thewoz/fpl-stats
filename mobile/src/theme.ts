// App-wide color palette. Named raw values come from the Coolors palette we
// picked: coffee bean, ebony, muted teal, tan, white smoke. `colors` exposes
// semantic roles so screens don't hardcode hex values and we can retune the
// palette in one place later.

export const palette = {
  coffeeBean: '#230903',
  ebony: '#656256',
  teal: '#9ebc9f',
  tan: '#d3b88c',
  whiteSmoke: '#f4f2f3',
} as const;

export const colors = {
  background: palette.whiteSmoke,
  surface: '#ffffff',
  border: palette.tan,
  textPrimary: palette.coffeeBean,
  textMuted: palette.ebony,
  accent: palette.teal,
  // Text/icon color that reads well on top of `accent`.
  onAccent: palette.coffeeBean,
  warm: palette.tan,
  // The palette has no red yet — reuse the darkest tone for error copy until
  // we pick a dedicated error color.
  danger: palette.coffeeBean,
} as const;
