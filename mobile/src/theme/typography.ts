/**
 * Type scale and font roles.
 *
 * Two families: **Sora** (geometric, for titles and the numbers that
 * matter) and **Rubik** (for running text). Styles never name a family.
 * They spread a role (`...fontRole.numeric`) and set an ordinary
 * `fontWeight`, and the app's `Text` component (`src/components/Text.tsx`)
 * resolves the pair to a loaded face like `Sora_700Bold`.
 *
 * That indirection exists because custom fonts in React Native are one
 * family per weight: `fontWeight: '700'` on `Rubik_400Regular` renders
 * faux-bold on web and falls back to the system font on Android.
 */
import type { TextStyle } from 'react-native';

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
  /** 23px — screen titles, in the `display` role */
  screenTitle: 23,
  /** 50px — the hero score on My Team, in the `numeric` role */
  heroScore: 50,
} as const;

export type FontRole = 'display' | 'numeric' | 'body';

type FaceWeight = 400 | 500 | 600 | 700 | 800;

const SORA_FACES: Partial<Record<FaceWeight, string>> = {
  600: 'Sora_600SemiBold',
  700: 'Sora_700Bold',
  800: 'Sora_800ExtraBold',
};

const RUBIK_FACES: Partial<Record<FaceWeight, string>> = {
  400: 'Rubik_400Regular',
  500: 'Rubik_500Medium',
  600: 'Rubik_600SemiBold',
  700: 'Rubik_700Bold',
};

/** Loaded faces per role. `src/theme/fonts.ts` loads exactly these. */
export const FONT_FACES: Record<FontRole, Partial<Record<FaceWeight, string>>> = {
  display: SORA_FACES,
  numeric: SORA_FACES,
  body: RUBIK_FACES,
};

/**
 * Style fragments to spread into a text style. `fontFamily` carries the
 * role name, not a real family; the app's `Text` swaps it for the face.
 * Set `fontWeight` after the spread to pick a heavier or lighter face.
 */
export const fontRole = {
  /** Screen titles and other headings that set the screen's voice. */
  display: { fontFamily: 'display', fontWeight: '800' },
  /** Scores, xP, prices, ranks: anything read down a column. */
  numeric: { fontFamily: 'numeric', fontVariant: ['tabular-nums'] },
  /** Running text. The default, so spreading it is rarely needed. */
  body: { fontFamily: 'body' },
} as const satisfies Record<FontRole, TextStyle>;

const DEFAULT_ROLE: FontRole = 'body';
const DEFAULT_WEIGHT: FaceWeight = 400;
const NAMED_WEIGHTS: Record<string, FaceWeight> = { normal: 400, bold: 700 };

export function isFontRole(value: unknown): value is FontRole {
  return value === 'display' || value === 'numeric' || value === 'body';
}

/** `fontWeight` as written in a style → a numeric weight, or undefined
 *  when the style doesn't set one. */
export function parseFontWeight(weight: TextStyle['fontWeight']): number | undefined {
  if (weight == null) return undefined;
  if (typeof weight === 'number') return weight;
  return NAMED_WEIGHTS[weight] ?? Number(weight);
}

/** The loaded face closest to the requested weight. Ties go to the
 *  heavier face, so a 500 Sora request gets 600 rather than nothing. */
export function resolveFontFace(
  role: FontRole = DEFAULT_ROLE,
  weight: number = DEFAULT_WEIGHT,
): string {
  const faces = FONT_FACES[role];
  const available = (Object.keys(faces).map(Number) as FaceWeight[]).sort(
    (a, b) => b - a,
  );
  const nearest = available.reduce((best, candidate) =>
    Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
  );
  // `nearest` came from `faces`' own keys, so the lookup always hits.
  return faces[nearest] as string;
}

/** The role and weight a `Text` resolved to, handed down so nested
 *  `Text` inherits them the way React Native inherits font styles. */
export type ResolvedFont = { role: FontRole; weight: number };

/**
 * Swaps a style's role + weight for the loaded face. A style naming a
 * real family (not a role) is left alone. When the custom fonts failed
 * to load, the role is dropped and the original `fontWeight` kept, so
 * the system font renders at the intended weight.
 *
 * The resolved style drops `fontWeight`: each face already is its
 * weight, and Android falls back to the system font when a custom family
 * is paired with a weight it doesn't declare.
 */
export function applyFontRole(
  style: TextStyle,
  inherited: ResolvedFont | null,
  customFontsLoaded: boolean,
): { style: TextStyle; font: ResolvedFont } {
  const { fontFamily, fontWeight, ...rest } = style;
  const font: ResolvedFont = {
    role: isFontRole(fontFamily) ? fontFamily : (inherited?.role ?? DEFAULT_ROLE),
    weight: parseFontWeight(fontWeight) ?? inherited?.weight ?? DEFAULT_WEIGHT,
  };
  if (fontFamily != null && !isFontRole(fontFamily)) {
    return { style, font };
  }
  if (!customFontsLoaded) {
    return { style: fontWeight == null ? rest : { ...rest, fontWeight }, font };
  }
  return {
    style: { ...rest, fontFamily: resolveFontFace(font.role, font.weight) },
    font,
  };
}
