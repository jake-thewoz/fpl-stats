import { View } from 'react-native';
import { HeroCard } from '../../components/HeroCard';
import { Text } from '../../components/Text';
import type { Entry } from '../../api/entry';
import { formatInt, formatRank } from '../../format/rank';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';

// FPL chip identifiers as returned by /entry/.../event/.../picks/ on
// `active_chip`.
const CHIP_LABELS: Record<string, string> = {
  freehit: 'Free Hit',
  wildcard: 'Wildcard',
  '3xc': 'Triple Captain',
  bboost: 'Bench Boost',
};

/**
 * Scoreboard card at the top of a team: team name, any active chip, the
 * gameweek score as the headline, then total, overall rank and GW rank.
 */
export function Header({
  entry,
  gameweek,
  activeChip,
}: {
  entry: Entry;
  gameweek: number | null;
  /** FPL chip id active this gameweek, e.g. `'wildcard'`. */
  activeChip?: string | null;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <HeroCard style={styles.hero}>
      <View style={styles.heroTopLine}>
        <Text style={styles.heroTeamName} numberOfLines={1}>
          {entry.name}
        </Text>
        {activeChip ? (
          <Text style={styles.heroChip}>{CHIP_LABELS[activeChip] ?? activeChip}</Text>
        ) : null}
      </View>
      <View style={styles.heroScoreLine}>
        <View style={styles.heroScore}>
          <Text style={styles.heroScoreValue}>
            {formatInt(entry.summary_event_points)}
          </Text>
          <Text style={styles.heroScoreUnit}>
            {gameweek != null ? `GW ${gameweek} pts` : 'pts'}
          </Text>
        </View>
        <View style={styles.heroStats}>
          <HeroStat label="Total" value={formatInt(entry.summary_overall_points)} />
          <HeroStat label="Rank" value={formatRank(entry.summary_overall_rank)} />
          <HeroStat label="GW rank" value={formatRank(entry.summary_event_rank)} />
        </View>
      </View>
    </HeroCard>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={styles.heroStatValue}>{value}</Text>
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

/** Explains the squad shown while Free Hit is active, since it changes
 *  which players appear. Other chips only show as the hero card's pill. */
export function FreeHitBanner({
  showingPersistentSquad,
}: {
  showingPersistentSquad: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  // Body copy depends on whether the FH-fallback successfully fetched
  // the previous GW's persistent squad (the common case) or whether
  // we're still showing the FH temporary eleven (fallback fetch failed).
  const body = showingPersistentSquad
    ? 'Below is your team from last gameweek. Your post-Free-Hit squad reappears at the next deadline.'
    : 'The squad below is your one-week Free Hit team. Your persistent squad reappears at the next GW deadline.';
  return (
    <View style={styles.freeHitBanner}>
      <Text style={styles.freeHitBannerText}>{body}</Text>
    </View>
  );
}
