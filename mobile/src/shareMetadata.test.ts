/**
 * Link-preview tags in public/index.html have to be static (scrapers don't
 * run JavaScript), so they repeat copy whose source of truth is app.json.
 * These checks catch the two drifting apart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import appJson from '../app.json';

const MOBILE_ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(MOBILE_ROOT, 'public');
const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');

// PNG layout: 8-byte signature, then the IHDR chunk whose data starts with
// big-endian width and height.
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

function metaContent(attribute: 'name' | 'property', key: string): string {
  const match = html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`));
  if (!match) throw new Error(`index.html has no <meta ${attribute}="${key}">`);
  return match[1];
}

const og = (key: string) => metaContent('property', `og:${key}`);

describe('share metadata', () => {
  it('names the app as app.json does', () => {
    expect(og('site_name')).toBe(appJson.expo.name);
    expect(og('title')).toBe(appJson.expo.name);
    expect(metaContent('name', 'apple-mobile-web-app-title')).toBe(appJson.expo.name);
  });

  it('describes the app as app.json does', () => {
    expect(og('description')).toBe(appJson.expo.web.description);
  });

  it('points every absolute URL at the same origin', () => {
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
    const origin = new URL(og('url')).origin;
    expect(canonical).toBe(og('url'));
    expect(new URL(og('image')).origin).toBe(origin);
  });

  it('declares the real dimensions of an image that ships in public/', () => {
    const imagePath = new URL(og('image')).pathname;
    const png = readFileSync(join(PUBLIC_DIR, imagePath));
    expect(png.readUInt32BE(PNG_WIDTH_OFFSET)).toBe(Number(og('image:width')));
    expect(png.readUInt32BE(PNG_HEIGHT_OFFSET)).toBe(Number(og('image:height')));
  });
});
