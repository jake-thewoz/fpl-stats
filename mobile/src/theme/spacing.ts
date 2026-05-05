/**
 * Spacing scale in pixels.
 *
 * Values are derived from actual usage across the app's `makeStyles`
 * blocks — not invented from a "perfect" geometric scale. Steps were
 * kept where they earn their place by appearing in real layouts (e.g.
 * `lg2 = 14` is a real button vertical-padding height that sits between
 * `lg = 12` and `xl = 16`). One-off oddities (`1`, `3`, `5`, `11`,
 * `13`, etc.) stay inline at the call site with a `// why` comment.
 */
export const spacing = {
  /** 2px — hairline gap, micro-margin */
  hairline: 2,
  /** 4px — tight inset, half-row gap */
  xs: 4,
  /** 6px — small inset */
  sm: 6,
  /** 8px — default inset / gap */
  md: 8,
  /** 10px — medium inset */
  base: 10,
  /** 12px — common row vertical padding */
  lg: 12,
  /** 14px — taller row / button vertical padding */
  lg2: 14,
  /** 16px — standard horizontal screen padding, card padding */
  xl: 16,
  /** 20px — larger card / hero padding */
  xl2: 20,
  /** 24px — section / header padding */
  xxl: 24,
  /** 32px — large block / screen-bottom padding */
  xxxl: 32,
  /** 48px — safe-area top inset */
  safeTop: 48,
} as const;

/**
 * Border radius scale.
 *
 * Same derivation rule as `spacing` — values reflect real usage. Tiny
 * outliers (`3`, `4`, `11`) and one-off `12` stay inline.
 */
export const radius = {
  /** 6px — small chips, inner buttons */
  sm: 6,
  /** 8px — buttons, inputs */
  md: 8,
  /** 10px — cards, list rows */
  base: 10,
  /** 16px — large cards, dialogs */
  lg: 16,
} as const;
