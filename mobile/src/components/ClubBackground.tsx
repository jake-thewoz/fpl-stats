/**
 * Club-coloured gradient that sits behind a player-row's name cell.
 *
 * Each row's name cell renders one of these absolute-positioned behind
 * the text. The visual is two stacked layers:
 *
 *   1. **Pattern layer**: solid colour, framed band, or vertical stripes
 *      depending on the club's kit. Filled at full opacity.
 *   2. **Fade overlay**: ``transparent`` on the left side fading to the
 *      surface colour on the right side, applied across the same area.
 *      The overlay is what produces the "fades into the background"
 *      look the original brief asked for, regardless of which pattern
 *      sits underneath.
 *
 * Splitting pattern and fade into two layers lets striped clubs
 * (Brentford, Newcastle) and framed clubs (Arsenal, Villa) share the
 * exact same fade behaviour as solid-colour clubs, without trying to
 * encode both axes into one ``LinearGradient`` call.
 *
 * Falls back to ``null`` when the team's short name isn't in the
 * ``CLUB_VISUALS`` map — happens with synthetic test fixtures and is
 * also a safe degradation if FPL ever ships a club we haven't mapped.
 *
 * Render contract: the parent container needs ``position: relative``
 * (the React Native default for any ``View``), and a fixed or measurable
 * height. The component is ``pointerEvents: 'none'`` so it never
 * interferes with row-level press handling above.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { CLUB_VISUALS, type ClubVisual } from './clubVisuals';

type Props = {
  /** Team short_name (e.g. ``'ARS'``). Anything else renders nothing. */
  teamShort: string;
};

const STRIPE_COUNT = 6;

export function ClubBackground({ teamShort }: Props) {
  const { colors } = useTheme();
  const club = CLUB_VISUALS[teamShort];
  if (!club) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <ClubPattern club={club} />
      {/* Fade overlay. ``locations`` keep the leftmost ~30% of the column
          at full pattern opacity (the colour part the brief wants), then
          ramp from transparent to the surface colour over the right ~70%
          so the row blends back into the background before the data
          column starts. */}
      <LinearGradient
        colors={['transparent', colors.surface]}
        locations={[0.25, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
}

function ClubPattern({ club }: { club: ClubVisual }) {
  if (club.pattern === 'solid') {
    return (
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: club.colors[0] },
        ]}
      />
    );
  }
  if (club.pattern === 'framed') {
    // 1 / 3 / 1 flex split — secondary edge | primary centre | secondary edge.
    // Mimics a shirt body with sleeve trim (Arsenal red w/ white sleeves,
    // Villa claret w/ sky-blue sleeves, etc.).
    const [primary, secondary] = club.colors;
    return (
      <View style={[StyleSheet.absoluteFillObject, styles.row]}>
        <View style={[styles.flex1, { backgroundColor: secondary }]} />
        <View style={[styles.flex3, { backgroundColor: primary }]} />
        <View style={[styles.flex1, { backgroundColor: secondary }]} />
      </View>
    );
  }
  if (club.pattern === 'stripes') {
    // Alternating vertical bands. STRIPE_COUNT is tuned to read as
    // stripes within the ~168px name column without becoming pinstripes.
    const [a, b] = club.colors;
    return (
      <View style={[StyleSheet.absoluteFillObject, styles.row]}>
        {Array.from({ length: STRIPE_COUNT }).map((_, i) => (
          <View
            key={i}
            style={[styles.flex1, { backgroundColor: i % 2 === 0 ? a : b }]}
          />
        ))}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  flex3: { flex: 3 },
});
