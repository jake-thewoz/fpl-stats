import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { formatDeadline } from '../format/datetime';
import type { RootStackParamList } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';
import { useGameweekPhase } from './GameweekStatusProvider';

/**
 * Row under each screen's header, on the page background. While a
 * gameweek is live: a mint "● LIVE" pill and "GW 7 · 4 of 10 matches
 * played". Between gameweeks: a quiet grape "NEXT" pill and the deadline.
 * Hidden once the season is over. Taps through to fixtures.
 */
export function GameweekBanner() {
  const styles = useThemedStyles(makeStyles);
  const phase = useGameweekPhase();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  if (phase.kind === 'none') return null;

  const live = phase.kind === 'live';
  const label = live
    ? `GW ${phase.gameweek.id} · ${matchesPlayedLabel(phase.played, phase.total)}`
    : `GW ${phase.next.id} · Deadline ${formatDeadline(phase.next.deadline_time)}`;
  const pillLabel = live ? 'LIVE' : 'NEXT';

  return (
    <Pressable
      onPress={() => navigation.navigate('Gameweek')}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pillLabel}: ${label}. Show fixtures.`}
    >
      <View style={[styles.pill, live ? styles.pillLive : styles.pillNext]}>
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={[styles.pillText, live ? styles.pillTextLive : styles.pillTextNext]}>
          {pillLabel}
        </Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function matchesPlayedLabel(played: number, total: number): string {
  return played === total
    ? `All ${total} matches played`
    : `${played} of ${total} matches played`;
}

// The dot inside the LIVE pill, sized to its cap height.
const LIVE_DOT_SIZE = 6;
// Pill caps are small and spaced like the hero card's chip.
const PILL_LETTER_SPACING = 0.6;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xs,
      paddingBottom: spacing.md,
      backgroundColor: colors.background,
    },
    pressed: effects.pressed,
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.hairline,
      borderRadius: radius.lg,
    },
    pillLive: { backgroundColor: colors.good },
    pillNext: { backgroundColor: colors.accentSoft },
    liveDot: {
      width: LIVE_DOT_SIZE,
      height: LIVE_DOT_SIZE,
      borderRadius: LIVE_DOT_SIZE / 2,
      backgroundColor: colors.onGood,
    },
    pillText: {
      fontSize: fontSize.xs,
      fontWeight: '800',
      letterSpacing: PILL_LETTER_SPACING,
    },
    pillTextLive: { color: colors.onGood },
    pillTextNext: { color: colors.accentText },
    label: {
      flexShrink: 1,
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textMuted,
    },
    chevron: { marginLeft: 'auto', fontSize: fontSize.lg, color: colors.textMuted },
  });
