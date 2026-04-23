import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchPlayers, type Player } from '../api/players';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { FilterDialog } from '../components/FilterDialog';
import { HeaderButton } from '../components/HeaderButton';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Players'>;

const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const;
const SEARCH_DEBOUNCE_MS = 300;

type SortColumn = 'form' | 'price' | 'total_points';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'form', label: 'Form' },
  { key: 'price', label: 'Price' },
  { key: 'total_points', label: 'Points' },
];

export default function PlayersScreen({ navigation }: Props) {
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetchPlayers);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilters, setTeamFilters] = useState<string[]>([]);
  const [positionFilters, setPositionFilters] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn>('total_points');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterOpen, setFilterOpen] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <HeaderButton label="Settings" onPress={() => navigation.navigate('Settings')} />
      ),
      headerRight: () => (
        <HeaderButton label="Gameweek" onPress={() => navigation.navigate('Gameweek')} />
      ),
    });
  }, [navigation]);

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const players = state.status === 'ok' ? state.data.players : [];

  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) set.add(p.team);
    return Array.from(set).sort();
  }, [players]);

  const visiblePlayers = useMemo(() => {
    const needle = searchQuery.toLowerCase();
    const teamSet = new Set(teamFilters);
    const posSet = new Set(positionFilters);

    const filtered = players.filter((p) => {
      if (teamSet.size > 0 && !teamSet.has(p.team)) return false;
      if (posSet.size > 0 && !posSet.has(p.position)) return false;
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    const mul = sortDir === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      const av = sortValue(a, sortColumn);
      const bv = sortValue(b, sortColumn);
      if (av === bv) return a.name.localeCompare(b.name);
      return av < bv ? -1 * mul : 1 * mul;
    });
  }, [players, searchQuery, teamFilters, positionFilters, sortColumn, sortDir]);

  function onHeaderPress(col: SortColumn) {
    if (col === sortColumn) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(col);
      setSortDir('desc');
    }
  }

  function toggleTeam(value: string) {
    setTeamFilters((xs) => (xs.includes(value) ? xs.filter((x) => x !== value) : [...xs, value]));
  }
  function togglePosition(value: string) {
    setPositionFilters((xs) =>
      xs.includes(value) ? xs.filter((x) => x !== value) : [...xs, value],
    );
  }
  function clearAllFilters() {
    setTeamFilters([]);
    setPositionFilters([]);
  }

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView title="Couldn't load players" message={state.message} onRetry={onRetry} />
    );
  }

  const activeFilterCount = teamFilters.length + positionFilters.length;

  return (
    <>
      <FlatList
        data={visiblePlayers}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => <PlayerRow player={item} />}
        ListHeaderComponent={
          <ListHeader
            searchInput={searchInput}
            onSearchChange={setSearchInput}
            onOpenFilter={() => setFilterOpen(true)}
            activeFilterCount={activeFilterCount}
            teamFilters={teamFilters}
            positionFilters={positionFilters}
            onRemoveTeam={toggleTeam}
            onRemovePosition={togglePosition}
            sortColumn={sortColumn}
            sortDir={sortDir}
            onHeaderPress={onHeaderPress}
            totalCount={players.length}
            filteredCount={visiblePlayers.length}
          />
        }
        ListEmptyComponent={<Text style={styles.emptyBody}>No players match these filters.</Text>}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <FilterDialog
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        positions={POSITION_ORDER}
        selectedPositions={positionFilters}
        onTogglePosition={togglePosition}
        teams={availableTeams}
        selectedTeams={teamFilters}
        onToggleTeam={toggleTeam}
        onClearAll={clearAllFilters}
      />
    </>
  );
}

function sortValue(p: Player, col: SortColumn): number {
  if (col === 'form') {
    const n = parseFloat(p.form);
    return Number.isNaN(n) ? 0 : n;
  }
  if (col === 'price') return p.price;
  return p.total_points;
}

type ListHeaderProps = {
  searchInput: string;
  onSearchChange: (v: string) => void;
  onOpenFilter: () => void;
  activeFilterCount: number;
  teamFilters: string[];
  positionFilters: string[];
  onRemoveTeam: (v: string) => void;
  onRemovePosition: (v: string) => void;
  sortColumn: SortColumn;
  sortDir: SortDir;
  onHeaderPress: (col: SortColumn) => void;
  totalCount: number;
  filteredCount: number;
};

function ListHeader(props: ListHeaderProps) {
  const {
    searchInput, onSearchChange,
    onOpenFilter, activeFilterCount,
    teamFilters, positionFilters, onRemoveTeam, onRemovePosition,
    sortColumn, sortDir, onHeaderPress,
    totalCount, filteredCount,
  } = props;

  const hasChips = teamFilters.length + positionFilters.length > 0;

  return (
    <View style={styles.headerBg}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search players"
          placeholderTextColor={colors.textMuted}
          value={searchInput}
          onChangeText={onSearchChange}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        <Pressable
          onPress={onOpenFilter}
          style={({ pressed }) => [styles.filterBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open filter"
        >
          <Text style={styles.filterBtnText}>
            Filter{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>
      </View>

      {hasChips && (
        <View style={styles.chipsRow}>
          {positionFilters.map((p) => (
            <FilterChip key={`pos-${p}`} label={p} onRemove={() => onRemovePosition(p)} />
          ))}
          {teamFilters.map((t) => (
            <FilterChip key={`team-${t}`} label={t} onRemove={() => onRemoveTeam(t)} />
          ))}
        </View>
      )}

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

      <Text style={styles.countLine}>
        {filteredCount} of {totalCount}
      </Text>
    </View>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Remove filter ${label}`}
    >
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipX}>×</Text>
    </Pressable>
  );
}

function ColumnHeaderButton({
  label, active, direction, onPress,
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
        {label}{arrow}
      </Text>
    </Pressable>
  );
}

function PlayerRow({ player }: { player: Player }) {
  return (
    <View style={styles.row}>
      <View style={styles.colName}>
        <Text style={styles.rowName} numberOfLines={1}>{player.name}</Text>
        <Text style={styles.rowMeta}>
          {player.team} · {player.position}
        </Text>
      </View>
      <Text style={[styles.rowCell, styles.colNumeric]}>{formatForm(player.form)}</Text>
      <Text style={[styles.rowCell, styles.colNumeric]}>£{player.price.toFixed(1)}</Text>
      <Text style={[styles.rowCell, styles.colNumeric, styles.rowPoints]}>
        {player.total_points}
      </Text>
    </View>
  );
}

function formatForm(raw: string): string {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? raw : n.toFixed(1);
}

const COL_NUMERIC_WIDTH = 64;

const styles = StyleSheet.create({
  listContent: { paddingBottom: 32, backgroundColor: colors.background },
  headerBg: {
    backgroundColor: colors.surface,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  search: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 16,
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  filterBtnText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.accent,
    gap: 4,
  },
  chipLabel: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  chipX: { color: colors.onAccent, fontSize: 16, fontWeight: '700', lineHeight: 18 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
  countLine: { marginTop: 2, marginLeft: 16, marginBottom: 4, color: colors.textMuted, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  colName: { flex: 1, paddingRight: 8 },
  colNumeric: {
    width: COL_NUMERIC_WIDTH,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rowName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  rowMeta: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  rowCell: { color: colors.textPrimary, fontSize: 14 },
  rowPoints: { fontWeight: '700' },
  emptyBody: { padding: 32, color: colors.textMuted, textAlign: 'center' },
  pressed: { opacity: 0.5 },
});
