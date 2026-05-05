/**
 * Theme-independent visual effects.
 *
 * These are not part of `Colors` because they apply equally in light
 * and dark mode. Pressed-state opacity is the dominant case — every
 * `Pressable` reaches for the same dim-by-half effect; centralizing
 * the value makes it tunable in one place.
 *
 * Outliers (`0.7` ghost text, `0.85` card-press) stay inline with a
 * `// why` comment at the call site — naming a constant for a single
 * use earns nothing over the literal.
 */
export const effects = {
  /** Standard pressed feedback for primary buttons / rows. */
  pressed: { opacity: 0.5 },
  /** Subtle pressed feedback for dense controls (filter chips, theme rows). */
  pressedSubtle: { opacity: 0.6 },
  /** Disabled affordance — clearly inert without being invisible. */
  dimDisabled: { opacity: 0.4 },
} as const;
