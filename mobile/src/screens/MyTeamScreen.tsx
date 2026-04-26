import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMyTeam, type SquadEntry } from '../api/myTeam';
import { fetchPlayersXp } from '../api/playersXp';
import type { Entry } from '../api/entry';
import { getFplTeamId } from '../storage/user';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { ColumnPickerDialog } from '../components/ColumnPickerDialog';
import { FilterDialog } from '../components/FilterDialog';
import {
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  FIELD_DEFS,
} from '../players/fields';
import {
  loadColumns,
  loadFilters,
  loadSort,
  saveColumns,
  saveFilters,
  saveSort,
} from '../players/storage';
import {
  applyAll,
  activeFilterCount,
} from '../players/apply';
import {
  EMPTY_FILTER,
  type FieldKey,
  type FilterState,
  type JoinedPlayer,
  type SortState,
} from '../players/types';
import type { MyTeamScreenProps } from '../navigation/types';
import { colors } from '../theme';

type Props = MyTeamScreenProps;

const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const;

/** Per-row decoration data that's My-Team-specific (captain/bench/this
 *  GW points). Lives alongside the shared JoinedPlayer fields rather
 *  than baking them into the cross-screen type. */
type MyTeamRow = JoinedPlayer & {
  isStarter: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  /** This GW's contribution to the team total (raw × multiplier).
   *  null when live data hasn't arrived yet. */
  gwPoints: number | null;
};

export default function MyTeamScreen({ navigation }: Props) {
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getFplTeamId().then(setTeamId);
  }, []);

  if (teamId === undefined) return <LoadingView />;
  if (teamId === null) {
    return (
      <NoTeamIdView
        onOpenSettings={() => navigation.getParent()?.navigate('SettingsTab')}
      />
    );
  }
  return <MyTeamContent teamId={teamId} />;
}

function MyTeamContent({ teamId }: { teamId: string }) {
  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const [myTeam, xpResp] = await Promise.all([
        fetchMyTeam(teamId, signal),
        fetchPlayersXp(signal),
      ]);
      const xpById = new Map(xpResp.players.map((p) => [p.player_id, p.xp]));
      const rows: MyTeamRow[] = myTeam.squad
        .filter((s): s is SquadEntry & { player: NonNullable<SquadEntry['player']> } =>
          s.player != null,
        )
        .map((s) => toMyTeamRow(s, xpById.get(s.player!.id) ?? null));
      return { myTeam, rows };
    },
    [teamId],
  );
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetcher);

  // Columns / filters / sort are shared with the Players tab via single
  // global keys. Re-read on focus so changes made over there appear here.
  const [columns, setColumns] = useState<FieldKey[]>(DEFAULT_COLUMNS);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([loadColumns(), loadFilters(), loadSort()]).then(
        ([c, f, s]) => {
          if (!alive) return;
          setColumns(c);
          setFilters(f);
          setSort(s);
        },
      );
      return () => {
        alive = false;
      };
    }, []),
  );

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const rows = state.status === 'ok' ? state.data.rows : [];

  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.team);
    return [...set].sort();
  }, [rows]);

  const filteredSorted = useMemo(
    // Empty search: rely only on filters + sort.
    () => applyAll(rows, '', filters, sort) as MyTeamRow[],
    [rows, filters, sort],
  );

  const onChangeColumns = useCallback((next: FieldKey[]) => {
    setColumns(next);
    saveColumns(next);
  }, []);
  const onChangeFilters = useCallback((next: FilterState) => {
    setFilters(next);
    saveFilters(next);
  }, []);
  const onChangeSort = useCallback((next: SortState) => {
    setSort(next);
    saveSort(next);
  }, []);

  const onTapColumnHeader = useCallback(
    (key: FieldKey) => {
      if (sort.field === key) {
        onChangeSort({ field: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
      } else {
        onChangeSort({ field: key, dir: FIELD_DEFS[key].defaultSortDir });
      }
    },
    [sort, onChangeSort],
  );

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

  const { myTeam } = state.data;

  return (
    <View style={styles.container}>
      <Header entry={myTeam.entry} gameweek={myTeam.gameweek} />
      {myTeam.picksError ? (
        <PicksUnavailableNote message={myTeam.picksError} />
      ) : null}
      <ControlBar
        filterCount={activeFilterCount(filters)}
        onOpenFilter={() => setFiltersOpen(true)}
        onOpenColumns={() => setColumnsOpen(true)}
      />
      <ColumnHeaderRow
        columns={columns}
        sort={sort}
        onTapHeader={onTapColumnHeader}
      />
      <FlatList
        data={filteredSorted}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <PlayerRow row={item} columns={columns} />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyBody}>
            {rows.length === 0
              ? 'No squad data available yet for this gameweek.'
              : 'No players match your filter. Try widening it.'}
          </Text>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />

      <ColumnPickerDialog
        visible={columnsOpen}
        selected={columns}
        onToggle={(key) =>
          onChangeColumns(
            columns.includes(key)
              ? columns.filter((c) => c !== key)
              : [...columns, key],
          )
        }
        onClose={() => setColumnsOpen(false)}
      />
      <FilterDialog
        visible={filtersOpen}
        filter={filters}
        positions={[...POSITION_ORDER]}
        teams={availableTeams}
        onApply={onChangeFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function toMyTeamRow(s: SquadEntry, xp: number | null): MyTeamRow {
  const player = s.player!;
  const formNum = parseFloat(player.form);
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    price: player.price,
    total_points: player.total_points,
    form: Number.isNaN(formNum) ? 0 : formNum,
    xp,
    isStarter: s.isStarter,
    isCaptain: s.pick.is_captain,
    isViceCaptain: s.pick.is_vice_captain,
    gwPoints: s.gwPoints,
  };
}

function Header({
  entry, gameweek,
}: { entry: Entry; gameweek: number | null }) {
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
        {overallRank != null
          ? `  ·  Rank ${overallRank.toLocaleString()}`
          : ''}
      </Text>
    </View>
  );
}

function PicksUnavailableNote({ message }: { message: string }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function ControlBar({
  filterCount, onOpenFilter, onOpenColumns,
}: {
  filterCount: number;
  onOpenFilter: () => void;
  onOpenColumns: () => void;
}) {
  return (
    <View style={styles.controlBar}>
      <ControlButton
        label={filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}
        active={filterCount > 0}
        onPress={onOpenFilter}
      />
      <ControlButton label="Columns" onPress={onOpenColumns} />
    </View>
  );
}

function ControlButton({
  label, active, onPress,
}: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlBtn,
        active && styles.controlBtnActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      <Text
        style={[styles.controlBtnText, active && styles.controlBtnTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ColumnHeaderRow({
  columns, sort, onTapHeader,
}: {
  columns: FieldKey[];
  sort: SortState;
  onTapHeader: (key: FieldKey) => void;
}) {
  return (
    <View style={styles.headerRow}>
      <Text style={[styles.headerNameCell, styles.headerCellText]}>Player</Text>
      {columns.map((c) => {
        const def = FIELD_DEFS[c];
        const active = sort.field === c;
        const arrow = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
        return (
          <Pressable
            key={c}
            onPress={() => onTapHeader(c)}
            style={({ pressed }) => [
              styles.headerCell,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.headerCellText,
                active && styles.headerCellTextActive,
              ]}
              numberOfLines={1}
            >
              {def.shortLabel}
              {arrow}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayerRow({
  row, columns,
}: { row: MyTeamRow; columns: FieldKey[] }) {
  // Bench rows are visually de-emphasised — same data, lower visual
  // priority. Captain/vice get badges. The GW points contribution
  // appears as a sub-line annotation (it's a useful glance value but
  // not a sortable column in the unified field set; future field-set
  // expansion can promote it).
  const subParts = [row.team, row.position];
  if (!row.isStarter) subParts.push('Bench');
  const subline = subParts.join(' · ');

  return (
    <View style={[styles.row, !row.isStarter && styles.rowBench]}>
      <View style={styles.nameCell}>
        <View style={styles.nameLine}>
          <Text style={styles.nameText} numberOfLines={1}>
            {row.name}
          </Text>
          {row.isCaptain ? (
            <Text style={styles.badgeCaptain} accessibilityLabel="captain">
              ⭐
            </Text>
          ) : null}
          {row.isViceCaptain ? (
            <Text style={styles.badgeVice} accessibilityLabel="vice-captain">
              V
            </Text>
          ) : null}
        </View>
        <Text style={styles.subText} numberOfLines={1}>
          {subline}
          {row.gwPoints != null ? `  ·  ${row.gwPoints} GW pts` : ''}
        </Text>
      </View>
      {columns.map((c) => {
        const def = FIELD_DEFS[c];
        const value = def.accessor(row);
        return (
          <Text key={c} style={styles.dataCell} numberOfLines={1}>
            {def.format(value)}
          </Text>
        );
      })}
    </View>
  );
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  notice: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  noticeText: { color: colors.textMuted, fontSize: 13 },

  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  controlBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  controlBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  controlBtnText: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  controlBtnTextActive: { color: colors.onAccent },
  pressed: { opacity: 0.6 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerNameCell: { flex: 2 },
  headerCell: { flex: 1, alignItems: 'flex-end' },
  headerCellText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  headerCellTextActive: { color: colors.accent },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBench: { opacity: 0.6 },
  nameCell: { flex: 2, paddingRight: 8 },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  subText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  badgeCaptain: { fontSize: 14 },
  badgeVice: {
    fontSize: 11,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    fontWeight: '700',
  },
  dataCell: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptyBody: {
    padding: 16,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.accent,
    borderRadius: 6,
  },
  primaryBtnText: { color: colors.onAccent, fontWeight: '600' },
});
