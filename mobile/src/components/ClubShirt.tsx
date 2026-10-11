/**
 * A small shirt in a club's home-kit pattern, drawn as SVG.
 *
 * Every pattern is painted as full-height rectangles clipped to the shirt
 * silhouette, so stripes and sleeves follow the shirt's outline without
 * per-pattern path work. An outline is stroked last, on top of the
 * pattern, so pale kits stay visible on light surfaces.
 *
 * Clubs missing from `CLUB_VISUALS` (synthetic test fixtures, or a club
 * FPL adds before we map it) render a neutral shirt rather than nothing,
 * so rows keep their alignment.
 */
import { useId } from 'react';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import { CLUB_VISUALS, type ClubVisual } from './clubVisuals';

/** Rendered sizes, in px: list rows and Transfers cards, and pitch tiles. */
export const CLUB_SHIRT_SIZE = { listRow: 24, pitch: 30 } as const;

// Geometry is in a 24-unit view box; the shirt scales to `size`.
const VIEW_BOX_SIZE = 24;
const SHIRT_PATH =
  'M8 2.2 3.6 4.3.8 8.6l3.3 2.6 1.9-1.5V22h12V9.7l1.9 1.5 3.3-2.6-2.8-4.3L16 2.2c-.7 1.7-2.2 2.8-4 2.8s-3.3-1.1-4-2.8Z';
const NECKLINE_PATH = 'M16 2.2c-.7 1.7-2.2 2.8-4 2.8s-3.3-1.1-4-2.8';
/** Where the body meets each sleeve, on the x axis. */
const BODY_LEFT = 6;
const BODY_RIGHT = 18;
const STRIPE_COUNT = 5;
/** Half of a centred stroke falls outside the clip, so the visible
 *  collar band is half this wide. */
const COLLAR_STROKE_WIDTH = 2.4;
const OUTLINE_STROKE_WIDTH = 1;

// `useId` returns values like ":r3:", which aren't valid in `url(#…)`.
const ID_UNSAFE_CHARACTERS = /[^a-zA-Z0-9_-]/g;

type Props = {
  /** Team short_name, e.g. `'ARS'`. */
  teamShort: string;
  /** One of `CLUB_SHIRT_SIZE`. */
  size: number;
};

export function ClubShirt({ teamShort, size }: Props) {
  const { colors } = useTheme();
  // SVG ids are document-wide on web, so each shirt needs its own clip id.
  const clipId = `shirt${useId().replace(ID_UNSAFE_CHARACTERS, '')}`;
  const club = CLUB_VISUALS[teamShort];
  const outline = club?.pattern === 'trimmed' ? club.colors[1] : colors.kitOutline;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
      accessibilityLabel={`${teamShort} shirt`}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Path d={SHIRT_PATH} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        {club ? (
          <KitPattern club={club} />
        ) : (
          <Rect
            width={VIEW_BOX_SIZE}
            height={VIEW_BOX_SIZE}
            fill={colors.surfaceRaised}
          />
        )}
      </G>
      <Path
        d={SHIRT_PATH}
        fill="none"
        stroke={outline}
        strokeWidth={OUTLINE_STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function KitPattern({ club }: { club: ClubVisual }) {
  const [primary, secondary] = club.colors;

  switch (club.pattern) {
    case 'solid':
      return <Rect width={VIEW_BOX_SIZE} height={VIEW_BOX_SIZE} fill={primary} />;
    case 'framed':
      return (
        <>
          <Rect width={VIEW_BOX_SIZE} height={VIEW_BOX_SIZE} fill={secondary} />
          <Rect
            x={BODY_LEFT}
            width={BODY_RIGHT - BODY_LEFT}
            height={VIEW_BOX_SIZE}
            fill={primary}
          />
        </>
      );
    case 'stripes': {
      const stripeWidth = VIEW_BOX_SIZE / STRIPE_COUNT;
      return (
        <>
          {Array.from({ length: STRIPE_COUNT }, (_, index) => (
            <Rect
              key={index}
              x={index * stripeWidth}
              width={stripeWidth}
              height={VIEW_BOX_SIZE}
              fill={index % 2 === 0 ? primary : secondary}
            />
          ))}
        </>
      );
    }
    case 'trimmed':
      return (
        <>
          <Rect width={VIEW_BOX_SIZE} height={VIEW_BOX_SIZE} fill={primary} />
          <Path
            d={NECKLINE_PATH}
            fill="none"
            stroke={secondary}
            strokeWidth={COLLAR_STROKE_WIDTH}
          />
        </>
      );
  }
}
