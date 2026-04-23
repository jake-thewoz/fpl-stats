import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchPlayers, type Player } from '../api/players';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { colors } from '../theme';

const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'];
const SEARCH_DEBOUNCE_MS = 300;

export default function PlayersScreen() {
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetchPlayers);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<string | null>(null);

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

  const filteredPlayers = useMemo(() => {
    const needle = searchQuery.toLowerCase();
    return players.filter((p) => {
      if (teamFilter && p.team !== teamFilter) return false;
      if (positionFilter && p.position !== positionFilter) return false;
      if (needle && !p.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [players, searchQuery, teamFilter, positionFilter]);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView title="Couldn't load players" message={state.message} onRetry={onRetry} />
    );
  }

  return (
    <FlatList
      data={filteredPlayers}
      keyExtractor={(p) => String(p.id)}
      renderItem={({ item }) => <PlayerRow player={item} />}
      ListHeaderComponent={
        <FiltersHeader
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          availableTeams={availableTeams}
          teamFilter={teamFilter}
          onTeamChange={setTeamFilter}
          positionFilter={positionFilter}
          onPositionChange={setPositionFilter}
          totalCount={players.length}
          filteredCount={filteredPlayers.length}
        />
      }
      ListEmptyComponent={<Text style={styles.emptyBody}>No players match these filters.</Text>}
      stickyHeaderIndices={[0]}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

type FiltersHeaderProps = {
  searchInput: string;
  onSearchChange: (v: string) => void;
  availableTeams: string[];
  teamFilter: string | null;
  onTeamChange: (v: string | null) => void;
  positionFilter: string | null;
  onPositionChange: (v: string | null) => void;
  totalCount: number;
  filteredCount: number;
};

function FiltersHeader(props: FiltersHeaderProps) {
  const {
    searchInput, onSearchChange,
    availableTeams, teamFilter, onTeamChange,
    positionFilter, onPositionChange,
    totalCount, filteredCount,
  } = props;
  return (
    <View style={styles.headerBg}>
      <TextInput
        style={styles.search}
        placeholder="Search players"
        value={searchInput}
        onChangeText={onSearchChange}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      <ChipRow
        label="Team"
        options={availableTeams}
        selected={teamFilter}
        onSelect={onTeamChange}
      />
      <ChipRow
        label="Position"
        options={POSITION_ORDER}
        selected={positionFilter}
        onSelect={onPositionChange}
      />
      <Text style={styles.countLine}>
        {filteredCount} of {totalCount}
      </Text>
    </View>
  );
}

type ChipRowProps = {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
};

function ChipRow({ label, options, selected, onSelect }: ChipRowProps) {
  return (
    <View style={styles.chipRow}>
      <Text style={styles.chipLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
      >
        {options.map((opt) => {
          const isSelected = selected === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(isSelected ? null : opt)}
              style={[styles.chip, isSelected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PlayerRow({ player }: { player: Player }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName}>{player.name}</Text>
        <Text style={styles.rowMeta}>
          {player.team} · {player.position}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowPoints}>{player.total_points} pts</Text>
        <Text style={styles.rowPrice}>£{player.price.toFixed(1)}m</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 32, backgroundColor: colors.background },
  headerBg: {
    backgroundColor: colors.surface,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    fontSize: 16,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  chipLabel: {
    width: 72,
    paddingLeft: 16,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  chipScroll: { paddingRight: 16, gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: colors.onAccent, fontWeight: '600' },
  countLine: { marginTop: 6, marginLeft: 16, color: colors.textMuted, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLeft: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  rowMeta: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  rowRight: { alignItems: 'flex-end' },
  rowPoints: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowPrice: { marginTop: 2, color: colors.warm, fontSize: 13, fontWeight: '500' },
  emptyBody: { padding: 32, color: colors.textMuted, textAlign: 'center' },
});
