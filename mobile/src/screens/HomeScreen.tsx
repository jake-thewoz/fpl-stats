import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import {
  fetchGameweekCurrent,
  type Fixture,
  type GameweekCurrentResponse,
} from '../api/gameweekCurrent';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: GameweekCurrentResponse }
  | { status: 'error'; message: string };

export default function HomeScreen({ navigation }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Button title="Players" onPress={() => navigation.navigate('Players')} />
      ),
    });
  }, [navigation]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchGameweekCurrent(signal);
      setState({ status: 'ok', data });
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onRetry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn't load gameweek</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Button title="Retry" onPress={onRetry} />
      </View>
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
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  listContent: { paddingBottom: 32 },
  header: { padding: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  headerTitle: { fontSize: 24, fontWeight: '600' },
  headerSubtitle: { marginTop: 4, color: '#555' },
  fixtureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  fixtureTeam: { flex: 1, fontSize: 16, fontWeight: '500' },
  fixtureTeamAway: { textAlign: 'right' },
  fixtureScore: { paddingHorizontal: 12, color: '#333', fontVariant: ['tabular-nums'] },
  emptyBody: { padding: 20, color: '#555', textAlign: 'center' },
  errorTitle: { fontSize: 18, fontWeight: '600' },
  errorBody: { color: '#b00020', textAlign: 'center' },
});
