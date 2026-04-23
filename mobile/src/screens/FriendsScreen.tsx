import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchEntry, EntryNotFoundError, type Entry } from '../api/entry';
import { getFriends, type Friend } from '../storage/friends';
import { getFplTeamId } from '../storage/user';
import { HeaderButton } from '../components/HeaderButton';
import { LoadingView } from '../components/LoadingView';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Friends'>;

type Target = {
  id: string;
  alias: string;
  isMe: boolean;
};

type RowState =
  | { status: 'loading' }
  | { status: 'ok'; data: Entry }
  | { status: 'error'; kind: 'not_found' | 'other' };

type ComparisonRow = {
  target: Target;
  state: RowState;
};

type SortColumn = 'rank' | 'gw' | 'total';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortColumn; label: string; defaultDir: SortDir }[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'gw', label: 'GW', defaultDir: 'desc' },
  { key: 'total', label: 'Total', defaultDir: 'desc' },
];

export default function FriendsScreen({ navigation }: Props) {
  // `null` = haven't finished reading storage yet.
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton
          label="Manage"
          onPress={() => navigation.navigate('ManageFriends')}
        />
      ),
    });
  }, [navigation]);

  async function buildTargets(): Promise<Target[]> {
    const [userId, friends] = await Promise.all([
      getFplTeamId(),
      getFriends(),
    ]);
    const out: Target[] = [];
    if (userId) {
      out.push({ id: userId, alias: 'You', isMe: true });
    }
    for (const f of friends) {
      // Dedupe: if the user added their own team as a friend, skip the dup.
      if (userId && f.id === userId) continue;
      out.push({ id: f.id, alias: f.alias, isMe: false });
    }
    return out;
  }

  const loadAll = useCallback(async () => {
    const nextTargets = await buildTargets();
    setTargets(nextTargets);

    if (nextTargets.length === 0) {
      setRows([]);
      return;
    }

    // Seed every row as loading so the table renders immediately with
    // placeholders, then patch each row in place as its fetch resolves.
    setRows(
      nextTargets.map((t) => ({ target: t, state: { status: 'loading' } })),
    );

    await Promise.all(
      nextTargets.map(async (t, i) => {
        try {
          const resp = await fetchEntry(t.id);
          setRows((prev) => {
            if (prev[i]?.target.id !== t.id) return prev; // stale update
            const next = prev.slice();
            next[i] = { target: t, state: { status: 'ok', data: resp.entry } };
            return next;
          });
        } catch (err) {
          const kind: 'not_found' | 'other' =
            err instanceof EntryNotFoundError ? 'not_found' : 'other';
          setRows((prev) => {
            if (prev[i]?.target.id !== t.id) return prev;
            const next = prev.slice();
            next[i] = { target: t, state: { status: 'error', kind } };
            return next;
          });
        }
      }),
    );
  }, []);

  // Refresh whenever the screen gains focus so adding/removing a friend
  // from Manage is reflected immediately on return.
  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  function onHeaderPress(col: SortColumn) {
    if (col === sortColumn) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(col);
      const column = COLUMNS.find((c) => c.key === col);
      setSortDir(column?.defaultDir ?? 'desc');
    }
  }

  const sortedRows = useMemo(
    () => sortRows(rows, sortColumn, sortDir),
    [rows, sortColumn, sortDir],
  );

  if (targets === null) return <LoadingView />;

  if (targets.length === 0) {
    return (
      <EmptyState
        onAddFriend={() => navigation.navigate('AddFriend')}
        onOpenSettings={() => navigation.navigate('Settings')}
      />
    );
  }

  return (
    <FlatList
      data={sortedRows}
      keyExtractor={(r) => r.target.id}
      renderItem={({ item }) => <Row row={item} />}
      ListHeaderComponent={
        <TableHeader
          sortColumn={sortColumn}
          sortDir={sortDir}
          onHeaderPress={onHeaderPress}
        />
      }
      contentContainerStyle={styles.listContent}
      stickyHeaderIndices={[0]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    />
  );
}

// ---- sort -------------------------------------------------------------------

function sortRows(
  rows: ComparisonRow[],
  column: SortColumn,
  dir: SortDir,
): ComparisonRow[] {
  const me = rows.find((r) => r.target.isMe);
  const others = rows.filter((r) => !r.target.isMe);

  const mul = dir === 'asc' ? 1 : -1;
  const sorted = others.slice().sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    // Errors / nulls always sink to the bottom regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.target.alias.localeCompare(b.target.alias);
    return av < bv ? -1 * mul : 1 * mul;
  });

  // Me is always pinned first so you can see your reference point regardless
  // of where it would sort into the list.
  return me ? [me, ...sorted] : sorted;
}

function sortValue(row: ComparisonRow, column: SortColumn): number | null {
  if (row.state.status !== 'ok') return null;
  const d = row.state.data;
  if (column === 'rank') return d.summary_overall_rank;
  if (column === 'gw') return d.summary_event_points;
  return d.summary_overall_points;
}

// ---- components -------------------------------------------------------------

function EmptyState({
  onAddFriend,
  onOpenSettings,
}: {
  onAddFriend: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>Nothing to compare yet</Text>
      <Text style={styles.emptyBody}>
        Add your FPL team ID in Settings, then add some friends to start
        comparing scores and ranks.
      </Text>
      <Pressable
        onPress={onAddFriend}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Add a friend</Text>
      </Pressable>
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [
          styles.secondaryBtn,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryBtnText}>Set your team ID</Text>
      </Pressable>
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
      <Text style={[styles.colHeader, styles.colAlias]}>Alias</Text>
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
        style={[
          styles.colHeader,
          styles.colNumeric,
          active && styles.colHeaderActive,
        ]}
      >
        {label}
        {arrow}
      </Text>
    </Pressable>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  const { target, state } = row;
  const aliasBadge = target.isMe ? (
    <View style={styles.youBadge} accessibilityLabel="You">
      <Text style={styles.youBadgeText}>You</Text>
    </View>
  ) : null;

  return (
    <View style={[styles.row, target.isMe && styles.rowMe]}>
      <View style={styles.colAlias}>
        <View style={styles.aliasLine}>
          <Text style={styles.rowAlias} numberOfLines={1}>
            {target.alias}
          </Text>
          {aliasBadge}
        </View>
        <RowSubtext state={state} teamId={target.id} />
      </View>
      <CellValue state={state} field="rank" />
      <CellValue state={state} field="gw" />
      <CellValue state={state} field="total" />
    </View>
  );
}

function RowSubtext({ state, teamId }: { state: RowState; teamId: string }) {
  if (state.status === 'error') {
    return (
      <Text style={styles.rowError}>
        {state.kind === 'not_found' ? 'Team not found' : "Couldn't load"}
      </Text>
    );
  }
  return <Text style={styles.rowMeta}>Team ID {teamId}</Text>;
}

function CellValue({
  state,
  field,
}: {
  state: RowState;
  field: SortColumn;
}) {
  if (state.status !== 'ok') {
    return <Text style={[styles.rowCell, styles.colNumeric]}>—</Text>;
  }
  const d = state.data;
  const value =
    field === 'rank'
      ? formatRank(d.summary_overall_rank)
      : field === 'gw'
      ? formatInt(d.summary_event_points)
      : formatInt(d.summary_overall_points);
  return <Text style={[styles.rowCell, styles.colNumeric]}>{value}</Text>;
}

function formatRank(n: number | null): string {
  if (n == null) return '—';
  // Compact thousands for headroom on narrow screens.
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

function formatInt(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

const COL_NUMERIC_WIDTH = 62;

const styles = StyleSheet.create({
  listContent: { paddingBottom: 32, backgroundColor: colors.background },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: colors.background,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
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
  secondaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: { opacity: 0.5 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Subtle tint on the 'You' row so it stands out even when it's pinned at
  // the top and the user is tired of the badge.
  rowMe: { backgroundColor: colors.background },
  colAlias: { flex: 1, paddingRight: 8 },
  aliasLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowAlias: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  rowError: { marginTop: 2, color: colors.danger, fontSize: 12 },
  colNumeric: {
    width: COL_NUMERIC_WIDTH,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rowCell: { color: colors.textPrimary, fontSize: 14 },
  youBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  youBadgeText: {
    color: colors.onAccent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
