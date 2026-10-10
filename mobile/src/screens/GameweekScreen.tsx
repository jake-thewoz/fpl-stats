import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Fixture, GameweekCurrentResponse } from '../api/gameweekCurrent';
import { formatDeadline, formatKickoff } from '../format/datetime';
import { fixtureStatus } from '../gameweek/status';
import { useQueryState } from '../hooks/useQueryState';
import { gameweekCurrentQuery } from '../query/queries';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { PullToRefresh } from '../components/PullToRefresh';
import type { GameweekScreenProps } from '../navigation/types';
import { fontSize, spacing, useThemedStyles, type Colors } from '../theme';

type Props = GameweekScreenProps;

export default function GameweekScreen(_props: Props) {
  const styles = useThemedStyles(makeStyles);

  const gameweekQuery = useQuery(gameweekCurrentQuery());
  const { state, refreshing, onRefresh, onRetry } = useQueryState(
    [gameweekQuery],
    gameweekQuery.data,
  );

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView
        title="Couldn't load gameweek"
        message={state.message}
        onRetry={onRetry}
      />
    );
  }

  const { gameweek, fixtures } = state.data;

  return (
    <FlatList
      data={fixtures}
      keyExtractor={(f) => String(f.id)}
      renderItem={({ item }) => <FixtureRow fixture={item} />}
      ListHeaderComponent={<GameweekHeader gameweek={gameweek} />}
      ListEmptyComponent={
        gameweek ? (
          <Text style={styles.emptyBody}>No fixtures for this gameweek yet.</Text>
        ) : null
      }
      contentContainerStyle={styles.listContent}
      refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

function GameweekHeader({ gameweek }: { gameweek: GameweekCurrentResponse['gameweek'] }) {
  const styles = useThemedStyles(makeStyles);

  if (!gameweek) {
    return (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>No active gameweek</Text>
        <Text style={styles.headerSubtitle}>
          Pre-season or between seasons — check back soon.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{gameweek.name}</Text>
      <Text style={styles.headerSubtitle}>
        Deadline: {formatDeadline(gameweek.deadline_time)}
      </Text>
    </View>
  );
}

function FixtureRow({ fixture }: { fixture: Fixture }) {
  const styles = useThemedStyles(makeStyles);

  const { home, away, kickoff_time, finished, started } = fixture;
  const isLive = fixtureStatus(fixture, Date.now()) === 'live';
  const scoreline =
    finished || started
      ? `${home.score ?? '-'} – ${away.score ?? '-'}`
      : formatKickoff(kickoff_time);
  return (
    <View style={styles.fixtureRow}>
      <Text style={styles.fixtureTeam}>{home.short_name ?? `#${home.id}`}</Text>
      <Text style={styles.fixtureScore}>
        {isLive ? <Text style={styles.liveMarker}>● </Text> : null}
        {scoreline}
      </Text>
      <Text style={[styles.fixtureTeam, styles.fixtureTeamAway]}>
        {away.short_name ?? `#${away.id}`}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    listContent: { paddingBottom: spacing.xxxl, backgroundColor: colors.background },
    header: {
      padding: spacing.xl2,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // 24px is a hero gameweek title size, above the standard scale; one
    // call site so it stays inline rather than promoted.
    headerTitle: { fontSize: 24, fontWeight: '600', color: colors.textPrimary },
    headerSubtitle: { marginTop: spacing.xs, color: colors.textMuted },
    fixtureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.lg2,
      paddingHorizontal: spacing.xl2,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    fixtureTeam: {
      flex: 1,
      fontSize: fontSize.lg,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    fixtureTeamAway: { textAlign: 'right' },
    fixtureScore: {
      paddingHorizontal: spacing.lg,
      color: colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    liveMarker: { color: colors.live },
    emptyBody: { padding: spacing.xl2, color: colors.textMuted, textAlign: 'center' },
  });
