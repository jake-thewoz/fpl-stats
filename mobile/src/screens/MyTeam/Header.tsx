import { Text, View } from 'react-native';
import type { Entry } from '../../api/entry';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';

/** Top-of-screen line: team name + GW + points + total + rank. */
export function Header({ entry, gameweek }: { entry: Entry; gameweek: number | null }) {
  const styles = useThemedStyles(makeStyles);

  const eventPts = entry.summary_event_points;
  const totalPts = entry.summary_overall_points;
  const overallRank = entry.summary_overall_rank;
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{entry.name}</Text>
      <Text style={styles.headerSub}>
        {gameweek != null ? `GW ${gameweek}` : 'Pre-season'}
        {eventPts != null ? `  ·  ${eventPts} pts` : ''}
        {totalPts != null ? `  ·  Total ${totalPts}` : ''}
        {overallRank != null ? `  ·  Rank ${overallRank.toLocaleString()}` : ''}
      </Text>
    </View>
  );
}

/** Shown between Header and the table when entry loads but picks for
 *  the current GW aren't available yet. */
export function PicksUnavailableNote({ message }: { message: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

// FPL chip identifiers as returned by /entry/.../event/.../picks/ on
// `active_chip`. Free Hit is the only one that breaks squad-display
// continuity (the picks endpoint returns a temporary 11+4 squad for
// that GW only) — the rest are scoring/structural chips that don't
// change which players appear in the list, so we surface them as a
// quieter passive indicator.
const CHIP_FREE_HIT = 'freehit';
const CHIP_LABELS: Record<string, string> = {
  freehit: 'Free Hit',
  wildcard: 'Wildcard',
  '3xc': 'Triple Captain',
  bboost: 'Bench Boost',
};

/** Banner shown above the table when an FPL chip is active this GW.
 *  Free Hit gets a louder treatment because it changes what the squad
 *  list shows; other chips get a passive single-line badge. */
export function ChipBanner({
  chip,
  showingPersistentSquad,
}: {
  chip: string;
  showingPersistentSquad: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const label = CHIP_LABELS[chip] ?? chip;
  const isFreeHit = chip === CHIP_FREE_HIT;
  // Body copy depends on whether the FH-fallback successfully fetched
  // the previous GW's persistent squad (the common case) or whether
  // we're still showing the FH temporary eleven (fallback fetch failed).
  if (isFreeHit) {
    const body = showingPersistentSquad
      ? 'Free Hit is active this GW. Below is your team from last gameweek — your post-Free-Hit squad will reappear at the next deadline.'
      : 'The squad below is your one-week Free Hit team. Your persistent squad reappears at the next GW deadline.';
    return (
      <View style={styles.chipBannerFreeHit}>
        <Text style={styles.chipBannerTitle}>{label} active</Text>
        <Text style={styles.chipBannerBody}>{body}</Text>
      </View>
    );
  }
  return (
    <View style={styles.chipBadge}>
      <Text style={styles.chipBadgeText}>{label} active this GW</Text>
    </View>
  );
}
