/**
 * Type-size scale in pixels.
 *
 * Values are derived from actual usage across the app's `makeStyles`
 * blocks. The `15`/`13`/`12` peak (`base`/`sm2`/`sm`) reflects iOS-style
 * defaults — body text, secondary, muted. Outlier sizes (`22`, `24`,
 * `28`) stay inline at the one or two call sites that need them.
 */
export const fontSize = {
  /** 11px — fine print, footnote */
  xs: 11,
  /** 12px — muted / metadata */
  sm: 12,
  /** 13px — secondary text, button labels */
  sm2: 13,
  /** 14px — standard body */
  md: 14,
  /** 15px — primary body text, list rows */
  base: 15,
  /** 16px — emphasis body, larger labels */
  lg: 16,
  /** 17px — section headers */
  lg2: 17,
  /** 18px — titles */
  xl: 18,
  /** 20px — large headings */
  xxl: 20,
} as const;
