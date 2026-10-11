/**
 * Renders every app icon, splash and web-install asset from one vector
 * definition of the brand mark, so a tweak to the mark is one edit plus
 * `npm run brand`. Outputs are committed; nothing here runs at build time.
 *
 * Runs on Node's built-in TypeScript type stripping (Node >= 22.18), which
 * is why imports carry explicit `.ts` extensions.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { darkColors, lightPalette } from '../src/theme/colors.ts';

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(MOBILE_ROOT, 'assets');
const PUBLIC_DIR = join(MOBILE_ROOT, 'public');
const WEB_ICONS_PATH = 'icons';

const FONTS_DIR = join(
  MOBILE_ROOT,
  'node_modules',
  '@expo-google-fonts',
  'playfair-display',
);
const WORDMARK_FONT_FILE = join(
  FONTS_DIR,
  '600SemiBold',
  'PlayfairDisplay_600SemiBold.ttf',
);
const TAGLINE_FONT_FILE = join(
  FONTS_DIR,
  '400Regular_Italic',
  'PlayfairDisplay_400Regular_Italic.ttf',
);
const SHARE_FONT_FAMILY = 'Playfair Display';

const BACKGROUND_COLOR = lightPalette.eggplant;
const BADGE_COLOR = lightPalette.mint;
const LETTER_COLOR = lightPalette.eggplant;

// Android adaptive-icon grid: a 108-unit canvas whose centre 66-unit circle
// survives every launcher mask. All geometry below is in these units.
const CANVAS = 108;
const CENTER = CANVAS / 2;
const BADGE_RADIUS = 27;
const LETTER_RADIUS = 12;
const LETTER_STROKE = 10;
// Half-angle of the gap on the right-hand side of the "C".
const LETTER_OPENING_DEGREES = 50;

// Scale that makes the badge nearly fill the canvas, for sizes too small
// for the launcher-safe margin to be worth its cost in legibility.
const FILLED_BADGE_RADIUS = 48;
// Corner rounding for icons that platforms show unmasked (desktop installs,
// browser tabs). Roughly matches the iOS/Android squircle.
const ROUNDED_CORNER_RADIUS = 24;

type Backdrop = 'full-bleed' | 'rounded' | 'transparent';

function letterPath(scale: number): string {
  const radius = LETTER_RADIUS * scale;
  const opening = (LETTER_OPENING_DEGREES * Math.PI) / 180;
  const x = CENTER + radius * Math.cos(opening);
  const yOffset = radius * Math.sin(opening);
  // Large-arc, counter-clockwise from the top tip round the left side.
  return `M${x} ${CENTER - yOffset} A${radius} ${radius} 0 1 0 ${x} ${CENTER + yOffset}`;
}

function markShapes(badgeRadius: number): string {
  const scale = badgeRadius / BADGE_RADIUS;
  return [
    `<circle cx="${CENTER}" cy="${CENTER}" r="${badgeRadius}" fill="${BADGE_COLOR}"/>`,
    `<path d="${letterPath(scale)}" fill="none" stroke="${LETTER_COLOR}"`,
    ` stroke-width="${LETTER_STROKE * scale}" stroke-linecap="round"/>`,
  ].join('');
}

function markSvg(backdrop: Backdrop, badgeRadius: number): string {
  const background = {
    'full-bleed': `<rect width="${CANVAS}" height="${CANVAS}" fill="${BACKGROUND_COLOR}"/>`,
    rounded: `<rect width="${CANVAS}" height="${CANVAS}" rx="${ROUNDED_CORNER_RADIUS}" fill="${BACKGROUND_COLOR}"/>`,
    transparent: '',
  }[backdrop];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    background,
    markShapes(badgeRadius),
    '</svg>',
  ].join('');
}

type Output = { path: string; size: number; backdrop: Backdrop; badgeRadius: number };

const NATIVE_ICON_SIZE = 1024;
const FAVICON_SIZE = 48;
const APPLE_TOUCH_ICON_SIZE = 180;
const WEB_ICON_SIZES = [192, 512] as const;
const WEB_MASKABLE_SIZE = 512;

const webIcon = (size: number) => `${WEB_ICONS_PATH}/icon-${size}.png`;
const WEB_MASKABLE_ICON = `${WEB_ICONS_PATH}/icon-maskable-${WEB_MASKABLE_SIZE}.png`;
const APPLE_TOUCH_ICON = `${WEB_ICONS_PATH}/apple-touch-icon.png`;

const outputs: Output[] = [
  // iOS rounds the corners itself, so the native icon is full-bleed.
  {
    path: join(ASSETS_DIR, 'icon.png'),
    size: NATIVE_ICON_SIZE,
    backdrop: 'full-bleed',
    badgeRadius: BADGE_RADIUS,
  },
  // Android draws the background from app.json's adaptiveIcon.backgroundColor.
  {
    path: join(ASSETS_DIR, 'adaptive-icon.png'),
    size: NATIVE_ICON_SIZE,
    backdrop: 'transparent',
    badgeRadius: BADGE_RADIUS,
  },
  {
    path: join(ASSETS_DIR, 'splash-icon.png'),
    size: NATIVE_ICON_SIZE,
    backdrop: 'transparent',
    badgeRadius: BADGE_RADIUS,
  },
  {
    path: join(ASSETS_DIR, 'favicon.png'),
    size: FAVICON_SIZE,
    backdrop: 'rounded',
    badgeRadius: FILLED_BADGE_RADIUS,
  },
  ...WEB_ICON_SIZES.map((size) => ({
    path: join(PUBLIC_DIR, webIcon(size)),
    size,
    backdrop: 'rounded' as const,
    badgeRadius: BADGE_RADIUS,
  })),
  {
    path: join(PUBLIC_DIR, WEB_MASKABLE_ICON),
    size: WEB_MASKABLE_SIZE,
    backdrop: 'full-bleed',
    badgeRadius: BADGE_RADIUS,
  },
  {
    path: join(PUBLIC_DIR, APPLE_TOUCH_ICON),
    size: APPLE_TOUCH_ICON_SIZE,
    backdrop: 'full-bleed',
    badgeRadius: BADGE_RADIUS,
  },
];

// Link-preview card (Open Graph / Twitter). 1200x630 is the size every major
// platform renders as a large card without cropping the sides.
const SHARE_IMAGE_PATH = join(PUBLIC_DIR, 'share.png');
const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;
const SHARE_CENTER_X = SHARE_WIDTH / 2;
const SHARE_TAGLINE = 'Your Fantasy Premier League companion';
const SHARE_BADGE_RADIUS = 72;
const SHARE_BADGE_CENTER_Y = 200;
const SHARE_WORDMARK_SIZE = 104;
const SHARE_WORDMARK_WEIGHT = 600;
const SHARE_WORDMARK_BASELINE = 375;
const SHARE_RULE_Y = 420;
const SHARE_RULE_HALF_WIDTH = 32;
const SHARE_RULE_STROKE = 2;
const SHARE_TAGLINE_SIZE = 38;
const SHARE_TAGLINE_BASELINE = 485;
const SHARE_WORDMARK_COLOR = darkColors.textPrimary;
const SHARE_ACCENT_COLOR = lightPalette.mint;
// Darkens the corners towards black so the centred mark and wordmark
// sit in a soft pool of the brand colour rather than on a flat fill.
const SHARE_VIGNETTE_OPACITY = 0.35;

// Typographic apostrophe: the straight one from app.json looks like a
// typewriter tick in a display serif.
const typographic = (text: string) => text.replace(/'/g, '\u2019');

function shareSvg(name: string): string {
  const markScale = SHARE_BADGE_RADIUS / BADGE_RADIUS;
  const markOffsetX = SHARE_CENTER_X - CENTER * markScale;
  const markOffsetY = SHARE_BADGE_CENTER_Y - CENTER * markScale;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">`,
    '<defs><radialGradient id="vignette">',
    `<stop offset="0" stop-color="${lightPalette.black}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${lightPalette.black}" stop-opacity="${SHARE_VIGNETTE_OPACITY}"/>`,
    '</radialGradient></defs>',
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="${BACKGROUND_COLOR}"/>`,
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#vignette)"/>`,
    `<g transform="translate(${markOffsetX} ${markOffsetY}) scale(${markScale})">`,
    markShapes(BADGE_RADIUS),
    '</g>',
    `<text x="${SHARE_CENTER_X}" y="${SHARE_WORDMARK_BASELINE}" text-anchor="middle"`,
    ` font-family="${SHARE_FONT_FAMILY}" font-weight="${SHARE_WORDMARK_WEIGHT}" font-size="${SHARE_WORDMARK_SIZE}"`,
    ` fill="${SHARE_WORDMARK_COLOR}">${typographic(name)}</text>`,
    `<line x1="${SHARE_CENTER_X - SHARE_RULE_HALF_WIDTH}" x2="${SHARE_CENTER_X + SHARE_RULE_HALF_WIDTH}"`,
    ` y1="${SHARE_RULE_Y}" y2="${SHARE_RULE_Y}" stroke="${SHARE_ACCENT_COLOR}"`,
    ` stroke-width="${SHARE_RULE_STROKE}" stroke-linecap="round"/>`,
    `<text x="${SHARE_CENTER_X}" y="${SHARE_TAGLINE_BASELINE}" text-anchor="middle"`,
    ` font-family="${SHARE_FONT_FAMILY}" font-style="italic" font-size="${SHARE_TAGLINE_SIZE}"`,
    ` fill="${SHARE_ACCENT_COLOR}">${SHARE_TAGLINE}</text>`,
    '</svg>',
  ].join('');
}

function renderShareImage(name: string): void {
  const png = new Resvg(shareSvg(name), {
    fitTo: { mode: 'width', value: SHARE_WIDTH },
    // Bundled fonts only, so the image renders identically on any machine.
    font: {
      fontFiles: [WORDMARK_FONT_FILE, TAGLINE_FONT_FILE],
      loadSystemFonts: false,
      defaultFontFamily: SHARE_FONT_FAMILY,
    },
  })
    .render()
    .asPng();
  writeFileSync(SHARE_IMAGE_PATH, png);
  process.stdout.write(
    `wrote ${SHARE_IMAGE_PATH.slice(MOBILE_ROOT.length + 1)} (${SHARE_WIDTH}x${SHARE_HEIGHT})\n`,
  );
}

function render({ path, size, backdrop, badgeRadius }: Output): void {
  const png = new Resvg(markSvg(backdrop, badgeRadius), {
    fitTo: { mode: 'width', value: size },
  })
    .render()
    .asPng();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  process.stdout.write(`wrote ${path.slice(MOBILE_ROOT.length + 1)} (${size}px)\n`);
}

type AppJson = { expo: { name: string; web: { description: string; lang: string } } };

function readAppJson(): AppJson {
  return JSON.parse(readFileSync(join(MOBILE_ROOT, 'app.json'), 'utf8'));
}

function writeManifest({ expo: { name, web } }: AppJson): void {
  const pngIcon = (src: string, size: number, purpose: string) => ({
    src: `/${src}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });
  const manifest = {
    id: '/',
    name,
    short_name: name,
    description: web.description,
    lang: web.lang,
    categories: ['sports'],
    start_url: '/',
    display: 'standalone',
    background_color: BACKGROUND_COLOR,
    theme_color: BACKGROUND_COLOR,
    icons: [
      ...WEB_ICON_SIZES.map((size) => pngIcon(webIcon(size), size, 'any')),
      pngIcon(WEB_MASKABLE_ICON, WEB_MASKABLE_SIZE, 'maskable'),
    ],
  };
  const path = join(PUBLIC_DIR, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`wrote ${path.slice(MOBILE_ROOT.length + 1)}\n`);
}

const appJson = readAppJson();
outputs.forEach(render);
renderShareImage(appJson.expo.name);
writeManifest(appJson);
