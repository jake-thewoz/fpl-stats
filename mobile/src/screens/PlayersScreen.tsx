import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPlayers, type Player } from '../api/players';
import { fetchPlayersXp } from '../api/playersXp';
import { fetchMyTeam } from '../api/myTeam';
import { getFplTeamId } from '../storage/user';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { ColumnPickerDialog } from '../components/ColumnPickerDialog';
import { FilterDialog } from '../components/FilterDialog';
import { PlayerListTable } from '../components/PlayerListTable';
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
import { useTheme, useThemedStyles, type Colors } from '../theme';

const SEARCH_DEBOUNCE_MS = 300;
const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const;

type CombinedData = {
  players: JoinedPlayer[];
};

export default function PlayersScreen(_props: PlayersScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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

  // Columns / filters / sort are shared across screens via a single set
  // of AsyncStorage keys. We re-read on every focus so changes made on
  // the My Team tab are picked up when the user returns here. The
  // re-read is cheap (microseconds) and avoids needing a global state
  // context for what's effectively rarely-changing config.
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

  // Owned-player decoration (#99): players in the user's current squad
  // are dimmed on the Players list, mirroring FPL's own "this isn't a
  // swap target" treatment. Re-resolved on focus so a team-ID change
  // in Settings, or a fresh squad after a transfer, propagates without
  // a manual refresh. Failure modes (no team ID set, fetch error) leave
  // ownedIds null and the list renders normally.
  const [ownedIds, setOwnedIds] = useState<Set<number> | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const teamId = await getFplTeamId();
        if (!alive) return;
        if (!teamId) {
          setOwnedIds(null);
          return;
        }
        try {
          const myTeam = await fetchMyTeam(teamId);
          if (!alive) return;
          const ids = new Set<number>();
          for (const s of myTeam.squad) {
            if (s.player) ids.add(s.player.id);
          }
          setOwnedIds(ids);
        } catch {
          // Silent — Players screen is fully usable without the dim.
          if (alive) setOwnedIds(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

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
      <PlayerListTable
        data={filteredSorted}
        columns={columns}
        sort={sort}
        onTapHeader={onTapColumnHeader}
        getId={(p) => p.id}
        renderNameCell={(p) => (
          <>
            <Text style={styles.nameText} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={styles.subText} numberOfLines={1}>
              {p.team} · {p.position}
            </Text>
          </>
        )}
        getRowStyle={
          ownedIds == null
            ? undefined
            : (p) => (ownedIds.has(p.id) ? { opacity: 0.5 } : undefined)
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        emptyMessage="No players match your filter. Try widening it."
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
    defcon: p.defcon,
    defcon_per_90: p.defcon_per_90,
    selected_by_percent: p.selected_by_percent,
    points_per_game: p.points_per_game,
    minutes: p.minutes,
    goals_scored: p.goals_scored,
    assists: p.assists,
    clean_sheets: p.clean_sheets,
    bonus: p.bonus,
    bps: p.bps,
    ict_index: p.ict_index,
    expected_goals: p.expected_goals,
    expected_assists: p.expected_assists,
    cost_change_event: p.cost_change_event,
  };
}

function SearchBar({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  controlBtnText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  controlBtnTextActive: { color: colors.onAccent },
  pressed: { opacity: 0.6 },

  // Used by renderNameCell passed to PlayerListTable.
  nameText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  subText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
