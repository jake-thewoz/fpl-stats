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
import { fetchEntry, EntryNotFoundError, type Entry } from '../api/entry';
import { getFriends, type Friend } from '../storage/friends';
import {
  useParallelFetch,
  type ParallelFetchRowState,
} from '../hooks/useParallelFetch';
import { useFocusedTeamId } from '../hooks/useFocusedTeamId';
import { HeaderButton } from '../components/HeaderButton';
import { LoadingView } from '../components/LoadingView';
import { formatInt, formatRank } from '../format/rank';
import type { FriendsScreenProps } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

type Props = FriendsScreenProps;

type Target = {
  id: string;
  alias: string;
  isMe: boolean;
};

type ComparisonRow = {
  target: Target;
  state: ParallelFetchRowState<Entry>;
};

type SortColumn = 'rank' | 'gw' | 'total';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortColumn; label: string; defaultDir: SortDir }[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'gw', label: 'GW', defaultDir: 'desc' },
  { key: 'total', label: 'Total', defaultDir: 'desc' },
];

const fetchEntryEntry = async (
  id: string,
  signal: AbortSignal,
): Promise<Entry> => {
  const resp = await fetchEntry(id, signal);
  return resp.entry;
};

export default function FriendsScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);

  const teamId = useFocusedTeamId();
  // `null` = haven't finished reading friends list yet.
  const [friends, setFriends] = useState<Friend[] | null>(null);
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

  // Re-read the friends list every time the screen gains focus so a
  // friend added on Manage shows up on return.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getFriends().then((fs) => {
        if (alive) setFriends(fs);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const targets = useMemo<Target[] | null>(() => {
    if (teamId === undefined || friends === null) return null;
    const out: Target[] = [];
    if (teamId) out.push({ id: teamId, alias: 'You', isMe: true });
    for (const f of friends) {
      // Dedupe: if the user added their own team as a friend, skip the dup.
      if (teamId && f.id === teamId) continue;
      out.push({ id: f.id, alias: f.alias, isMe: false });
    }
    return out;
  }, [teamId, friends]);

  const targetIds = useMemo(
    () => (targets ?? []).map((t) => t.id),
    [targets],
  );
  const { rows: fetchedRows, refreshing, onRefresh } = useParallelFetch(
    targetIds,
    fetchEntryEntry,
  );

  // Join the per-key fetch state back to the target metadata. If the
  // hook hasn't caught up to a new targets array yet, fall back to a
  // synthesized loading row so the table doesn't briefly render
  // mismatched aliases/ids.
  const rows = useMemo<ComparisonRow[]>(() => {
    const t = targets ?? [];
    const byId = new Map(fetchedRows.map((r) => [r.key, r.state] as const));
    return t.map((target) => ({
      target,
      state: byId.get(target.id) ?? { status: 'loading' },
    }));
  }, [targets, fetchedRows]);

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
        // Settings lives on a sibling tab — go via the parent tab
        // navigator rather than trying to navigate within Friends stack.
        onOpenSettings={() => navigation.getParent()?.navigate('SettingsTab')}
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
  const mul = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    // Errors / nulls always sink to the bottom regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.target.alias.localeCompare(b.target.alias);
    return av < bv ? -1 * mul : 1 * mul;
  });
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
            {displayAlias(row)}
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

function displayAlias(row: ComparisonRow): string {
  // Use the live squad name from FPL once it loads — squad names change
  // during the season, and stale aliases set at import time become hard
  // to recognise. The user-set alias is kept as the fallback for in-flight
  // / failed fetches and stays canonical on the Manage list.
  if (row.state.status === 'ok') return row.state.data.name;
  if (row.target.isMe) return 'Your team';
  return row.target.alias;
}

function RowSubtext({
  state,
  teamId,
}: {
  state: ParallelFetchRowState<Entry>;
  teamId: string;
}) {
  const styles = useThemedStyles(makeStyles);

  if (state.status === 'error') {
    const notFound = state.error instanceof EntryNotFoundError;
    return (
      <Text style={styles.rowError}>
        {notFound ? 'Team not found' : "Couldn't load"}
      </Text>
    );
  }
  // Manager name as the secondary line — stable across the season even
  // when the squad name above changes. Falls back to team ID while the
  // entry fetch is in flight so the row never looks empty.
  if (state.status === 'ok') {
    const { player_first_name, player_last_name } = state.data;
    const managerName = `${player_first_name} ${player_last_name}`.trim();
    if (managerName) {
      return <Text style={styles.rowMeta}>{managerName}</Text>;
    }
  }
  return <Text style={styles.rowMeta}>Team ID {teamId}</Text>;
}

function CellValue({
  state,
  field,
}: {
  state: ParallelFetchRowState<Entry>;
  field: SortColumn;
}) {
  const styles = useThemedStyles(makeStyles);

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

const COL_NUMERIC_WIDTH = 62;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    listContent: { paddingBottom: spacing.xxxl, backgroundColor: colors.background },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxxl,
      gap: spacing.lg,
      backgroundColor: colors.background,
    },
    emptyTitle: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
    emptyBody: {
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
    primaryBtn: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      backgroundColor: colors.accent,
    },
    primaryBtnText: { color: colors.onAccent, fontSize: fontSize.base, fontWeight: '600' },
    secondaryBtn: {
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    pressed: effects.pressed,
    tableHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.base,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    colHeader: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    colHeaderActive: { color: colors.accent },
    colHeaderBtn: { width: COL_NUMERIC_WIDTH, paddingVertical: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xl,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // Subtle tint on the 'You' row so it stands out even when it's pinned at
    // the top and the user is tired of the badge.
    rowMe: { backgroundColor: colors.background },
    colAlias: { flex: 1, paddingRight: spacing.md },
    aliasLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowAlias: {
      flexShrink: 1,
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    rowMeta: {
      marginTop: spacing.hairline,
      color: colors.textMuted,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
    },
    rowError: { marginTop: spacing.hairline, color: colors.danger, fontSize: fontSize.sm },
    colNumeric: {
      width: COL_NUMERIC_WIDTH,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    rowCell: { color: colors.textPrimary, fontSize: fontSize.md },
    youBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.hairline,
      borderRadius: radius.base,
      backgroundColor: colors.accent,
    },
    youBadgeText: {
      color: colors.onAccent,
      fontSize: fontSize.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });
