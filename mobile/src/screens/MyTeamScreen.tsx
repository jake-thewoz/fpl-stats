import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchMyTeam } from '../api/myTeam';
import type { Entry } from '../api/entry';
import type { EntryGameweek, Pick } from '../api/entryGameweek';
import type { Player } from '../api/players';
import { getFplTeamId } from '../storage/user';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTeam'>;

export default function MyTeamScreen({ navigation }: Props) {
  // undefined = we haven't finished reading AsyncStorage yet.
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getFplTeamId().then(setTeamId);
  }, []);

  if (teamId === undefined) return <LoadingView />;
  if (teamId === null) {
    return (
      <NoTeamIdView onOpenSettings={() => navigation.navigate('Settings')} />
    );
  }
  return <MyTeamContent teamId={teamId} />;
}

function NoTeamIdView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No team ID set</Text>
      <Text style={styles.emptyBody}>
        Add your Fantasy Premier League team ID in Settings to see your squad
        here.
      </Text>
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Go to Settings</Text>
      </Pressable>
    </View>
  );
}

function MyTeamContent({ teamId }: { teamId: string }) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchMyTeam(teamId, signal),
    [teamId],
  );
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetcher);

  const starters = useMemo(
    () => (state.status === 'ok' ? sortedSquad(state.data.picks, 1, 11) : []),
    [state],
  );
  const bench = useMemo(
    () => (state.status === 'ok' ? sortedSquad(state.data.picks, 12, 15) : []),
    [state],
  );
  const formation = useMemo(() => {
    if (state.status !== 'ok') return null;
    return deriveFormation(starters, state.data.playersById);
  }, [state, starters]);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView
        title="Couldn't load your team"
        message={state.message}
        onRetry={onRetry}
      />
    );
  }

  const { entry, gameweek, picks, playersById, picksError } = state.data;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <SummaryCard
        entry={entry}
        gameweek={gameweek}
        picks={picks}
        formation={formation}
      />

      {picks ? (
        <>
          <SectionHeader
            title="Starting XI"
            subtitle={formation ? `Formation: ${formation}` : null}
          />
          {starters.map((p) => (
            <PlayerRow
              key={p.element}
              pick={p}
              player={playersById[p.element]}
            />
          ))}

          <SectionHeader title="Bench" subtitle={null} />
          {bench.map((p) => (
            <PlayerRow
              key={p.element}
              pick={p}
              player={playersById[p.element]}
            />
          ))}
        </>
      ) : gameweek == null ? (
        <MessageCard
          title="No active gameweek"
          body="Come back when the season starts to see your squad."
        />
      ) : (
        <MessageCard
          title={`Picks for Gameweek ${gameweek} aren't available yet`}
          body={picksError ?? 'Check back after the deadline.'}
        />
      )}
    </ScrollView>
  );
}

function sortedSquad(
  picks: EntryGameweek | null,
  minPos: number,
  maxPos: number,
): Pick[] {
  if (!picks) return [];
  return picks.squad
    .filter((p) => p.position >= minPos && p.position <= maxPos)
    .slice()
    .sort((a, b) => a.position - b.position);
}

function deriveFormation(
  starters: Pick[],
  playersById: Record<number, Player>,
): string | null {
  if (starters.length !== 11) return null;
  const count = (short: string) =>
    starters.filter((s) => playersById[s.element]?.position === short).length;
  return `${count('DEF')}-${count('MID')}-${count('FWD')}`;
}

// ---- subcomponents ----------------------------------------------------------

function SummaryCard({
  entry,
  gameweek,
  picks,
  formation,
}: {
  entry: Entry;
  gameweek: number | null;
  picks: EntryGameweek | null;
  formation: string | null;
}) {
  const manager = `${entry.player_first_name} ${entry.player_last_name}`.trim();
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {entry.name}
      </Text>
      <Text style={styles.cardSubtitle}>{manager}</Text>

      <View style={styles.statRow}>
        <Stat label="Overall rank" value={formatRank(entry.summary_overall_rank)} />
        <Stat label="Total" value={formatPoints(entry.summary_overall_points)} />
      </View>

      {gameweek != null && (
        <View style={styles.statRow}>
          <Stat
            label={`GW ${gameweek}`}
            value={formatPoints(picks?.points ?? entry.summary_event_points)}
          />
          <Stat label="GW rank" value={formatRank(entry.summary_event_rank)} />
        </View>
      )}

      {formation && (
        <Text style={styles.formationLine}>Formation: {formation}</Text>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string | null;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function PlayerRow({
  pick,
  player,
}: {
  pick: Pick;
  player: Player | undefined;
}) {
  const isCaptain = pick.is_captain;
  const isVice = pick.is_vice_captain;
  const badge = isCaptain ? 'C' : isVice ? 'V' : null;

  return (
    <View style={styles.playerRow}>
      <View style={styles.playerLeft}>
        <Text style={styles.playerName} numberOfLines={1}>
          {player?.name ?? `#${pick.element}`}
        </Text>
        <Text style={styles.playerMeta}>
          {player ? `${player.team} · ${player.position}` : 'Unknown player'}
        </Text>
      </View>
      {badge && (
        <View
          style={[
            styles.badge,
            isCaptain ? styles.badgeCaptain : styles.badgeVice,
          ]}
          accessibilityLabel={isCaptain ? 'Captain' : 'Vice-captain'}
        >
          <Text
            style={[
              styles.badgeText,
              isCaptain ? styles.badgeTextCaptain : styles.badgeTextVice,
            ]}
          >
            {badge}
          </Text>
        </View>
      )}
    </View>
  );
}

function MessageCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageBody}>{body}</Text>
    </View>
  );
}

function formatRank(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function formatPoints(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString()} pts`;
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 32,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: colors.background,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyBody: {
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  primaryBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.5 },
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 8,
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  cardSubtitle: { fontSize: 14, color: colors.textMuted },
  statRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  stat: { flex: 1 },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    marginTop: 2,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  formationLine: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 13,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  playerLeft: { flex: 1, paddingRight: 12 },
  playerName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  playerMeta: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  badge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCaptain: { backgroundColor: colors.accent },
  badgeVice: { backgroundColor: colors.accentSoft },
  badgeText: { fontSize: 13, fontWeight: '700' },
  badgeTextCaptain: { color: colors.onAccent },
  badgeTextVice: { color: colors.onAccentSoft },
  message: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  messageTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  messageBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
