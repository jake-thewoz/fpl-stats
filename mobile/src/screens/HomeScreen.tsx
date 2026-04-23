import { useLayoutEffect } from 'react';
import { Button, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import {
  fetchGameweekCurrent,
  type Fixture,
  type GameweekCurrentResponse,
} from '../api/gameweekCurrent';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetchGameweekCurrent);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Button title="Players" onPress={() => navigation.navigate('Players')} />
      ),
    });
  }, [navigation]);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView title="Couldn't load gameweek" message={state.message} onRetry={onRetry} />
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

function GameweekHeader({ gameweek }: { gameweek: GameweekCurrentResponse['gameweek'] }) {
  if (!gameweek) {
    return (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>No active gameweek</Text>
        <Text style={styles.headerSubtitle}>Pre-season or between seasons — check back soon.</Text>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{gameweek.name}</Text>
      <Text style={styles.headerSubtitle}>Deadline: {formatDeadline(gameweek.deadline_time)}</Text>
    </View>
  );
}

function FixtureRow({ fixture }: { fixture: Fixture }) {
  const { home, away, kickoff_time, finished, started } = fixture;
  const scoreline =
    finished || started
      ? `${home.score ?? '-'} – ${away.score ?? '-'}`
      : formatKickoff(kickoff_time);
  return (
    <View style={styles.fixtureRow}>
      <Text style={styles.fixtureTeam}>{home.short_name ?? `#${home.id}`}</Text>
      <Text style={styles.fixtureScore}>{scoreline}</Text>
      <Text style={[styles.fixtureTeam, styles.fixtureTeamAway]}>
        {away.short_name ?? `#${away.id}`}
      </Text>
    </View>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatKickoff(iso: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 32, backgroundColor: colors.background },
  header: {
    padding: 20,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 24, fontWeight: '600', color: colors.textPrimary },
  headerSubtitle: { marginTop: 4, color: colors.textMuted },
  fixtureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fixtureTeam: { flex: 1, fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  fixtureTeamAway: { textAlign: 'right' },
  fixtureScore: {
    paddingHorizontal: 12,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  emptyBody: { padding: 20, color: colors.textMuted, textAlign: 'center' },
});
