/**
 * Heat scale: colours a number by its size, blending from `surfaceRaised`
 * (nothing) toward `good` mint (a big number). Shared by xP cells on
 * Players, points badges on the pitch, and GW points on Friends so a
 * "hot" number looks the same everywhere.
 */
import type { Colors } from './colors';

/** Values at or above a ceiling render fully mint. */
export const HEAT_CEILING = {
  /** A single player's GW points. Double figures is a haul. */
  playerPoints: 12,
  /** A single player's expected points for one GW. */
  expectedPoints: 7.5,
  /** A whole team's GW score. */
  teamPoints: 80,
} as const;

/** Past this share of the ceiling the cell is mint enough that dark
 *  `onGood` text out-reads `textPrimary`. */
const TEXT_FLIP_FRACTION = 0.5;

const HEX_RADIX = 16;
const HEX_CHANNEL_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export type HeatColor = { background: string; text: string };

export function heatColor(value: number, ceiling: number, colors: Colors): HeatColor {
  const fraction = Math.min(Math.max(value, 0) / ceiling, 1);
  return {
    background: mixHex(colors.surfaceRaised, colors.good, fraction),
    text: fraction > TEXT_FLIP_FRACTION ? colors.onGood : colors.textPrimary,
  };
}

/** Linear sRGB blend of two `#rrggbb` colours; `fraction` 0 is `from`. */
export function mixHex(from: string, to: string, fraction: number): string {
  const start = parseHex(from);
  const end = parseHex(to);
  const blended = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * fraction),
  );
  return `#${blended.map((channel) => channel.toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

function parseHex(color: string): number[] {
  const match = HEX_CHANNEL_PATTERN.exec(color);
  if (!match) {
    throw new Error(`heat scale needs #rrggbb colours, got "${color}"`);
  }
  return match.slice(1).map((channel) => parseInt(channel, HEX_RADIX));
}
