import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchPlayers, type Player } from '../api/players';
import { fetchPlayersXp } from '../api/playersXp';
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
import type { PlayersScreenProps } from '../navigation/types';
import { colors } from '../theme';

const SEARCH_DEBOUNCE_MS = 300;
const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const;

type CombinedData = {
  players: JoinedPlayer[];
};

export default function PlayersScreen(_props: PlayersScreenProps) {
  // Combined fetch: /players + /analytics/players/xp joined by id.
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CombinedData> => {
      const [playersResp, xpResp] = await Promise.all([
        fetchPlayers(signal),
        fetchPlayersXp(signal),
      ]);
      const xpById = new Map(xpResp.players.map((p) => [p.player_id, p.xp]));
      const players: JoinedPlayer[] = playersResp.players.map((p) =>
        toJoined(p, xpById.get(p.id) ?? null),
      );
      return { players };
    },
    [],
  );
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetcher);

  // Columns / filters / sort — loaded async from AsyncStorage. Default
  // values render immediately so the user sees something before storage
  // resolves.
  const [columns, setColumns] = useState<FieldKey[]>(DEFAULT_COLUMNS);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  useEffect(() => {
    let alive = true;
    Promise.all([
      loadColumns('players'),
      loadFilters('players'),
      loadSort('players'),
    ]).then(([c, f, s]) => {
      if (!alive) return;
      setColumns(c);
      setFilters(f);
      setSort(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const handle = setTimeout(
      () => setSearchQuery(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [searchInput]);

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const players = state.status === 'ok' ? state.data.players : [];

  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) set.add(p.team);
    return [...set].sort();
  }, [players]);

  const filteredSorted = useMemo(
    () => applyAll(players, searchQuery, filters, sort),
    [players, searchQuery, filters, sort],
  );

  // Persisters: any state change triggers an async save without blocking
  // the UI. The screen-key argument keeps Players' choices separate from
  // My Team's.
  const onChangeColumns = useCallback((next: FieldKey[]) => {
    setColumns(next);
    saveColumns('players', next);
  }, []);
  const onChangeFilters = useCallback((next: FilterState) => {
    setFilters(next);
    saveFilters('players', next);
  }, []);
  const onChangeSort = useCallback((next: SortState) => {
    setSort(next);
    saveSort('players', next);
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
        title="Couldn't load players"
        message={state.message}
        onRetry={onRetry}
      />
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar value={searchInput} onChange={setSearchInput} />
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
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <PlayerRow player={item} columns={columns} />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyBody}>
            No players match your filter. Try widening it.
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

function toJoined(p: Player, xp: number | null): JoinedPlayer {
  // FPL ships `form` as a stringified decimal; coerce to number for sort.
  const formNum = parseFloat(p.form);
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.position,
    price: p.price,
    total_points: p.total_points,
    form: Number.isNaN(formNum) ? 0 : formNum,
    xp,
  };
}

function SearchBar({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.searchRow}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search by name or team"
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize="none"
      />
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
  player, columns,
}: { player: JoinedPlayer; columns: FieldKey[] }) {
  return (
    <View style={styles.row}>
      <View style={styles.nameCell}>
        <Text style={styles.nameText} numberOfLines={1}>
          {player.name}
        </Text>
        <Text style={styles.subText} numberOfLines={1}>
          {player.team} · {player.position}
        </Text>
      </View>
      {columns.map((c) => {
        const def = FIELD_DEFS[c];
        const value = def.accessor(player);
        return (
          <Text key={c} style={styles.dataCell} numberOfLines={1}>
            {def.format(value)}
          </Text>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  searchRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchInput: {
    fontSize: 15,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },

  controlBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
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
  controlBtnText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
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
  nameCell: { flex: 2, paddingRight: 8 },
  nameText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  subText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dataCell: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },

  emptyBody: { padding: 32, color: colors.textMuted, textAlign: 'center' },
});
