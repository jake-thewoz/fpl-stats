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
import { fetchMyTeam, type SquadEntry } from '../api/myTeam';
import type { Entry } from '../api/entry';
import type { EntryGameweek } from '../api/entryGameweek';
import { getFplTeamId } from '../storage/user';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MyTeam'>;

type SortColumn = 'gwPoints' | 'form' | 'total';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'gwPoints', label: 'GW pts' },
  { key: 'form', label: 'Form' },
  { key: 'total', label: 'Total' },
];

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

  const [sortColumn, setSortColumn] = useState<SortColumn>('gwPoints');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function onHeaderPress(col: SortColumn) {
    if (col === sortColumn) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(col);
      setSortDir('desc');
    }
  }

  const sortedSquad = useMemo(() => {
    if (state.status !== 'ok') return [];
    return sortSquad(state.data.squad, sortColumn, sortDir);
  }, [state, sortColumn, sortDir]);

  const formation = useMemo(() => {
    if (state.status !== 'ok') return null;
    return deriveFormation(state.data.squad);
  }, [state]);

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

  const { entry, gameweek, picks, squad, picksError } = state.data;
  const hasSquad = squad.length > 0;

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

      {hasSquad ? (
        <>
          <TableHeader
            sortColumn={sortColumn}
            sortDir={sortDir}
            onHeaderPress={onHeaderPress}
          />
          {sortedSquad.map((entry) => (
            <PlayerRow key={entry.pick.element} entry={entry} />
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

function sortSquad(
  squad: SquadEntry[],
  column: SortColumn,
  dir: SortDir,
): SquadEntry[] {
  const mul = dir === 'asc' ? 1 : -1;
  return squad.slice().sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    if (av === bv) {
      // Stable secondary: starters before bench, then lineup position.
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
      return a.pick.position - b.pick.position;
    }
    return av < bv ? -1 * mul : 1 * mul;
  });
}

function sortValue(entry: SquadEntry, column: SortColumn): number {
  if (column === 'gwPoints') {
    return entry.gwPoints ?? -Infinity;
  }
  if (column === 'form') {
    const n = parseFloat(entry.player?.form ?? '');
    return Number.isNaN(n) ? -Infinity : n;
  }
  return entry.player?.total_points ?? -Infinity;
}

function deriveFormation(squad: SquadEntry[]): string | null {
  const starters = squad.filter((s) => s.isStarter);
  if (starters.length !== 11) return null;
  const count = (short: string) =>
    starters.filter((s) => s.player?.position === short).length;
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

function TableHeader({
  sortColumn,
  sortDir,
  onHeaderPress,
}: {
  sortColumn: SortColumn;
  sortDir: SortDir;
  onHeaderPress: (col: SortColumn) => void;
}) {
  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.colHeader, styles.colName]}>Player</Text>
      {COLUMNS.map((c) => (
        <ColumnHeaderButton
          key={c.key}
          label={c.label}
          active={sortColumn === c.key}
          direction={sortColumn === c.key ? sortDir : null}
          onPress={() => onHeaderPress(c.key)}
        />
      ))}
    </View>
  );
}

function ColumnHeaderButton({
  label,
  active,
  direction,
  onPress,
}: {
  label: string;
  active: boolean;
  direction: SortDir | null;
  onPress: () => void;
}) {
  const arrow = direction === 'asc' ? ' ↑' : direction === 'desc' ? ' ↓' : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.colHeaderBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
    >
      <Text
        style={[styles.colHeader, styles.colNumeric, active && styles.colHeaderActive]}
      >
        {label}{arrow}
      </Text>
    </Pressable>
  );
}

function PlayerRow({ entry }: { entry: SquadEntry }) {
  const { pick, player, gwPoints, isStarter } = entry;
  const badge = pick.is_captain ? 'C' : pick.is_vice_captain ? 'V' : null;
  const roleLabel = isStarter ? 'XI' : 'Bench';

  const teamPos = player
    ? `${player.team} · ${player.position}`
    : 'Unknown player';

  return (
    <View style={[styles.row, !isStarter && styles.rowBench]}>
      <View style={styles.colName}>
        <View style={styles.nameLine}>
          {badge && (
            <View
              style={[
                styles.badge,
                pick.is_captain ? styles.badgeCaptain : styles.badgeVice,
              ]}
              accessibilityLabel={pick.is_captain ? 'Captain' : 'Vice-captain'}
            >
              <Text
                style={[
                  styles.badgeText,
                  pick.is_captain ? styles.badgeTextCaptain : styles.badgeTextVice,
                ]}
              >
                {badge}
              </Text>
            </View>
          )}
          <Text style={styles.rowName} numberOfLines={1}>
            {player?.name ?? `#${pick.element}`}
          </Text>
        </View>
        <Text style={styles.rowMeta}>
          {teamPos} · {roleLabel}
        </Text>
      </View>
      <Text style={[styles.rowCell, styles.colNumeric, styles.rowPointsValue]}>
        {formatCell(gwPoints)}
      </Text>
      <Text style={[styles.rowCell, styles.colNumeric]}>
        {formatForm(player?.form)}
      </Text>
      <Text style={[styles.rowCell, styles.colNumeric]}>
        {formatCell(player?.total_points)}
      </Text>
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

function formatCell(n: number | null | undefined): string {
  if (n == null) return '—';
  return String(n);
}

function formatForm(raw: string | null | undefined): string {
  if (raw == null) return '—';
  const n = parseFloat(raw);
  return Number.isNaN(n) ? raw : n.toFixed(1);
}

const COL_NUMERIC_WIDTH = 64;

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
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  emptyBody: { color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
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
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  colHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colHeaderActive: { color: colors.accent },
  colHeaderBtn: { width: COL_NUMERIC_WIDTH, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Subtle tint on bench rows so the XI/bench split is still obvious at
  // a glance even in a flat sortable list.
  rowBench: { backgroundColor: colors.background },
  colName: { flex: 1, paddingRight: 8 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  rowMeta: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  colNumeric: {
    width: COL_NUMERIC_WIDTH,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rowCell: { color: colors.textPrimary, fontSize: 14 },
  rowPointsValue: { fontWeight: '700' },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCaptain: { backgroundColor: colors.accent },
  badgeVice: { backgroundColor: colors.accentSoft },
  badgeText: { fontSize: 12, fontWeight: '700' },
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
