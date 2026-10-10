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
import { lightPalette } from '../src/theme/colors.ts';

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(MOBILE_ROOT, 'assets');
const PUBLIC_DIR = join(MOBILE_ROOT, 'public');
const WEB_ICONS_PATH = 'icons';

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

function markSvg(backdrop: Backdrop, badgeRadius: number): string {
  const scale = badgeRadius / BADGE_RADIUS;
  const background = {
    'full-bleed': `<rect width="${CANVAS}" height="${CANVAS}" fill="${BACKGROUND_COLOR}"/>`,
    rounded: `<rect width="${CANVAS}" height="${CANVAS}" rx="${ROUNDED_CORNER_RADIUS}" fill="${BACKGROUND_COLOR}"/>`,
    transparent: '',
  }[backdrop];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    background,
    `<circle cx="${CENTER}" cy="${CENTER}" r="${badgeRadius}" fill="${BADGE_COLOR}"/>`,
    `<path d="${letterPath(scale)}" fill="none" stroke="${LETTER_COLOR}"`,
    ` stroke-width="${LETTER_STROKE * scale}" stroke-linecap="round"/>`,
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

function writeManifest(): void {
  const appJson = JSON.parse(readFileSync(join(MOBILE_ROOT, 'app.json'), 'utf8'));
  const name: string = appJson.expo.name;
  const pngIcon = (src: string, size: number, purpose: string) => ({
    src: `/${src}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });
  const manifest = {
    name,
    short_name: name,
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

outputs.forEach(render);
writeManifest();
