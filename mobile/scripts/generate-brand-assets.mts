/**
 * Renders every app icon, splash and web-install asset from one vector
 * definition of the brand mark, so a tweak to the mark is one edit plus
 * `npm run brand`. Outputs are committed; nothing here runs at build time.
 *
 * Runs on Node's built-in TypeScript type stripping (Node >= 22.18), which
 * is why imports carry explicit `.ts` extensions.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { darkColors, brandPalette } from '../src/theme/colors.ts';

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(MOBILE_ROOT, '..');
const ASSETS_DIR = join(MOBILE_ROOT, 'assets');
const PUBLIC_DIR = join(MOBILE_ROOT, 'public');
const WEB_ICONS_PATH = 'icons';

const FONTS_DIR = join(MOBILE_ROOT, 'node_modules', '@expo-google-fonts');
// The app's own pair: Sora for the wordmark, Rubik for the tagline.
const WORDMARK_FONT_FILE = join(
  FONTS_DIR,
  'sora',
  '800ExtraBold',
  'Sora_800ExtraBold.ttf',
);
const TAGLINE_FONT_FILE = join(FONTS_DIR, 'rubik', '500Medium', 'Rubik_500Medium.ttf');
const WORDMARK_FONT_FAMILY = 'Sora';
const TAGLINE_FONT_FAMILY = 'Rubik';
const TAGLINE_FONT_WEIGHT = 500;

const BACKGROUND_COLOR = brandPalette.grape;
const BADGE_COLOR = brandPalette.mint;
const LETTER_COLOR = brandPalette.grape;

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

// Wordmark cards: the mark, the app name and a tagline stacked and centred
// on the brand colour. All measurements are in the card's own pixels.
type CardLayout = {
  path: string;
  width: number;
  height: number;
  // Device-pixel multiplier for the rendered PNG.
  pixelRatio: number;
  // 0 for a full-bleed rectangle.
  cornerRadius: number;
  badgeRadius: number;
  badgeCenterY: number;
  wordmarkSize: number;
  wordmarkBaseline: number;
  ruleY: number;
  taglineSize: number;
  taglineBaseline: number;
};

const CARD_TAGLINE = 'Your Fantasy Premier League companion';
const CARD_WORDMARK_WEIGHT = 800;
const CARD_RULE_HALF_WIDTH = 32;
const CARD_RULE_STROKE = 2;
const CARD_WORDMARK_COLOR = darkColors.textPrimary;
const CARD_ACCENT_COLOR = brandPalette.mint;
// Darkens the corners towards black so the centred mark and wordmark
// sit in a soft pool of the brand colour rather than on a flat fill.
const CARD_VIGNETTE_OPACITY = 0.35;

const cards: CardLayout[] = [
  // Link-preview card (Open Graph / Twitter). 1200x630 is the size every
  // major platform renders as a large card without cropping the sides.
  {
    path: join(PUBLIC_DIR, 'share.png'),
    width: 1200,
    height: 630,
    pixelRatio: 1,
    cornerRadius: 0,
    badgeRadius: 72,
    badgeCenterY: 200,
    wordmarkSize: 104,
    wordmarkBaseline: 375,
    ruleY: 420,
    taglineSize: 38,
    taglineBaseline: 485,
  },
  // Header of the repository README. Rounded with transparent corners so it
  // sits cleanly on GitHub's light and dark backgrounds; rendered at 2x for
  // high-density screens.
  {
    path: join(REPO_ROOT, 'docs', 'images', 'readme-banner.png'),
    width: 1280,
    height: 400,
    pixelRatio: 2,
    cornerRadius: 24,
    badgeRadius: 50,
    badgeCenterY: 104,
    wordmarkSize: 88,
    wordmarkBaseline: 238,
    ruleY: 272,
    taglineSize: 30,
    taglineBaseline: 322,
  },
];

// Typographic apostrophe: the straight one from app.json looks like a
// typewriter tick at display size.
const typographic = (text: string) => text.replace(/'/g, '\u2019');

function cardSvg(name: string, layout: CardLayout): string {
  const { width, height, cornerRadius } = layout;
  const centerX = width / 2;
  const markScale = layout.badgeRadius / BADGE_RADIUS;
  const markOffsetX = centerX - CENTER * markScale;
  const markOffsetY = layout.badgeCenterY - CENTER * markScale;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    '<defs><radialGradient id="vignette">',
    `<stop offset="0" stop-color="${brandPalette.black}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${brandPalette.black}" stop-opacity="${CARD_VIGNETTE_OPACITY}"/>`,
    '</radialGradient></defs>',
    `<rect width="${width}" height="${height}" rx="${cornerRadius}" fill="${BACKGROUND_COLOR}"/>`,
    `<rect width="${width}" height="${height}" rx="${cornerRadius}" fill="url(#vignette)"/>`,
    `<g transform="translate(${markOffsetX} ${markOffsetY}) scale(${markScale})">`,
    markShapes(BADGE_RADIUS),
    '</g>',
    `<text x="${centerX}" y="${layout.wordmarkBaseline}" text-anchor="middle"`,
    ` font-family="${WORDMARK_FONT_FAMILY}" font-weight="${CARD_WORDMARK_WEIGHT}" font-size="${layout.wordmarkSize}"`,
    ` fill="${CARD_WORDMARK_COLOR}">${typographic(name)}</text>`,
    `<line x1="${centerX - CARD_RULE_HALF_WIDTH}" x2="${centerX + CARD_RULE_HALF_WIDTH}"`,
    ` y1="${layout.ruleY}" y2="${layout.ruleY}" stroke="${CARD_ACCENT_COLOR}"`,
    ` stroke-width="${CARD_RULE_STROKE}" stroke-linecap="round"/>`,
    `<text x="${centerX}" y="${layout.taglineBaseline}" text-anchor="middle"`,
    ` font-family="${TAGLINE_FONT_FAMILY}" font-weight="${TAGLINE_FONT_WEIGHT}" font-size="${layout.taglineSize}"`,
    ` fill="${CARD_ACCENT_COLOR}">${CARD_TAGLINE}</text>`,
    '</svg>',
  ].join('');
}

function renderCard(name: string, layout: CardLayout): void {
  const png = new Resvg(cardSvg(name, layout), {
    fitTo: { mode: 'width', value: layout.width * layout.pixelRatio },
    // Bundled fonts only, so the image renders identically on any machine.
    font: {
      fontFiles: [WORDMARK_FONT_FILE, TAGLINE_FONT_FILE],
      loadSystemFonts: false,
      defaultFontFamily: TAGLINE_FONT_FAMILY,
    },
  })
    .render()
    .asPng();
  mkdirSync(dirname(layout.path), { recursive: true });
  writeFileSync(layout.path, png);
  process.stdout.write(
    `wrote ${relative(REPO_ROOT, layout.path)} (${layout.width}x${layout.height} @${layout.pixelRatio}x)\n`,
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
cards.forEach((layout) => renderCard(appJson.expo.name, layout));
writeManifest(appJson);
