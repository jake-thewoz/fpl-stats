import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { formatDeadline } from '../format/datetime';
import type { MainTabParamList } from '../navigation/types';
import { effects, fontSize, spacing, useThemedStyles, type Colors } from '../theme';
import { useGameweekPhase } from './GameweekStatusProvider';

/**
 * Thin bar under each screen's header: "● GW 7 live · 4/10 played" while
 * a gameweek is live, "GW 8 deadline · Fri, Oct 17, 6:30 PM" between
 * gameweeks, hidden once the season is over. Taps through to fixtures.
 */
export function GameweekBanner() {
  const styles = useThemedStyles(makeStyles);
  const phase = useGameweekPhase();
  const navigation = useNavigation<NavigationProp<MainTabParamList>>();

  if (phase.kind === 'none') return null;

  const label =
    phase.kind === 'live'
      ? `GW ${phase.gameweek.id} live · ${phase.played}/${phase.total} played`
      : `GW ${phase.next.id} deadline · ${formatDeadline(phase.next.deadline_time)}`;

  return (
    <Pressable
      onPress={() => navigation.navigate('MyTeamTab', { screen: 'Gameweek' })}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Show fixtures.`}
    >
      <View style={styles.labelRow}>
        {phase.kind === 'live' ? <View style={styles.liveDot} /> : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// 8px dot: a hair larger than the inline ● glyph so it anchors the bar.
const LIVE_DOT_SIZE = 8;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: effects.pressed,
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexShrink: 1,
    },
    liveDot: {
      width: LIVE_DOT_SIZE,
      height: LIVE_DOT_SIZE,
      borderRadius: LIVE_DOT_SIZE / 2,
      backgroundColor: colors.live,
    },
    label: { fontSize: fontSize.sm2, fontWeight: '600', color: colors.textPrimary },
    chevron: { fontSize: fontSize.lg, color: colors.textMuted, marginLeft: spacing.md },
  });
