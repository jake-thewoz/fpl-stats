import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Player } from '../api/players';
import { MatchStatusGlyph } from '../gameweek/MatchStatusGlyph';
import { useFocusedTeamId } from '../hooks/useFocusedTeamId';
import { useMyTeam } from '../hooks/useMyTeam';
import { useQueryState, useRefetchStaleOnFocus } from '../hooks/useQueryState';
import { playersQuery, playersXpQuery } from '../query/queries';
import { useFocusedPlayersConfig } from '../hooks/useFocusedPlayersConfig';
import { ClubBackground } from '../components/ClubBackground';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import { ActiveFilterChips } from '../components/ActiveFilterChips';
import { ColumnPickerDialog } from '../components/ColumnPickerDialog';
import { ControlButton } from '../components/ControlButton';
import { FilterDialog } from '../components/FilterDialog';
import { PlayerListTable } from '../components/PlayerListTable';
import { FIELD_DEFS, xpHeaderSublabels } from '../players/fields';
import { applyAll, activeFilterCount } from '../players/apply';
import { POSITION_CODES } from '../players/positions';
import type { FieldKey, JoinedPlayer } from '../players/types';
import type { PlayersScreenProps } from '../navigation/types';
import {
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

const SEARCH_DEBOUNCE_MS = 300;

type CombinedData = {
  players: JoinedPlayer[];
  /** Gameweek the xP column projects (the next deadline). */
  xpGameweek: number | null;
};

export default function PlayersScreen(_props: PlayersScreenProps) {
  const styles = useThemedStyles(makeStyles);

  // /players + /analytics/players/xp joined by id.
  const playersQueryResult = useQuery(playersQuery());
  const xpQuery = useQuery(playersXpQuery());
  const playersResp = playersQueryResult.data;
  const xpResp = xpQuery.data;
  const data = useMemo<CombinedData | undefined>(() => {
    if (playersResp === undefined || xpResp === undefined) return undefined;
    const xpById = new Map(xpResp.players.map((p) => [p.player_id, p]));
    const players: JoinedPlayer[] = playersResp.players.map((p) =>
      toJoined(p, xpById.get(p.id)),
    );
    return { players, xpGameweek: xpResp.gameweek };
  }, [playersResp, xpResp]);
  const { state, refreshing, onRefresh, onRetry } = useQueryState(
    [playersQueryResult, xpQuery],
    data,
  );

  // Columns / filters / sort are shared with the My Team tab via a
  // single set of AsyncStorage keys; the hook re-reads on focus.
  const { columns, filters, sort, setColumns, setFilters, setSort } =
    useFocusedPlayersConfig();

  // Owned-player decoration (#99): players in the user's current squad
  // are dimmed on the Players list, mirroring FPL's own "this isn't a
  // swap target" treatment. Shares My Team's cached queries, so a
  // team-ID change in Settings or a fresh squad after a transfer shows
  // up on focus. Failure modes (no team ID set, fetch error) leave
  // ownedIds null and the list renders normally.
  const teamId = useFocusedTeamId();
  const myTeamQuery = useMyTeam(teamId ?? null);
  useRefetchStaleOnFocus(myTeamQuery.queries);
  const myTeam = myTeamQuery.data;
  const ownedIds = useMemo<Set<number> | null>(() => {
    if (myTeam === undefined) return null;
    const ids = new Set<number>();
    for (const s of myTeam.squad) {
      if (s.player) ids.add(s.player.id);
    }
    return ids;
  }, [myTeam]);

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

  const players = useMemo<JoinedPlayer[]>(
    () => (state.status === 'ok' ? state.data.players : []),
    [state],
  );

  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) set.add(p.team);
    return [...set].sort();
  }, [players]);

  const filteredSorted = useMemo(
    () => applyAll(players, searchQuery, filters, sort),
    [players, searchQuery, filters, sort],
  );

  const onTapColumnHeader = useCallback(
    (key: FieldKey) => {
      if (sort.field === key) {
        setSort({ field: key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
      } else {
        setSort({ field: key, dir: FIELD_DEFS[key].defaultSortDir });
      }
    },
    [sort, setSort],
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
      <ActiveFilterChips filters={filters} onChange={setFilters} />
      <PlayerListTable
        data={filteredSorted}
        columns={columns}
        sort={sort}
        onTapHeader={onTapColumnHeader}
        headerSublabels={xpHeaderSublabels(state.data.xpGameweek)}
        getId={(p) => p.id}
        renderNameCell={(p) => (
          <>
            <ClubBackground teamShort={p.team} />
            <View style={styles.textBackdrop}>
              <Text style={styles.nameText} numberOfLines={1}>
                <MatchStatusGlyph teamShort={p.team} />
                {p.name}
              </Text>
            </View>
            <View style={styles.textBackdrop}>
              <Text style={styles.subText} numberOfLines={1}>
                {p.team} · {p.position}
              </Text>
            </View>
          </>
        )}
        getRowStyle={
          ownedIds == null
            ? undefined
            : // Dim rows for players already in the user's squad (#99).
              // 0.5 matches the pressed-state dim by coincidence, but the
              // semantics are different — keeping it literal so future
              // tuning of one doesn't accidentally move the other.
              (p) => (ownedIds.has(p.id) ? { opacity: 0.5 } : undefined)
        }
        refreshing={refreshing}
        onRefresh={onRefresh}
        emptyMessage="No players match your filter. Try widening it."
      />

      <ColumnPickerDialog
        visible={columnsOpen}
        selected={columns}
        onToggle={(key) =>
          setColumns(
            columns.includes(key) ? columns.filter((c) => c !== key) : [...columns, key],
          )
        }
        onClose={() => setColumnsOpen(false)}
      />
      <FilterDialog
        visible={filtersOpen}
        filter={filters}
        positions={[...POSITION_CODES]}
        teams={availableTeams}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function toJoined(
  p: Player,
  xp: { xp: number; xp_h3: number | null; xp_h5: number | null } | undefined,
): JoinedPlayer {
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
    xp: xp?.xp ?? null,
    xp_h3: xp?.xp_h3 ?? null,
    xp_h5: xp?.xp_h5 ?? null,
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
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
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
  filterCount,
  onOpenFilter,
  onOpenColumns,
}: {
  filterCount: number;
  onOpenFilter: () => void;
  onOpenColumns: () => void;
}) {
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    searchRow: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.base,
      paddingBottom: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    searchInput: {
      fontSize: fontSize.base,
      color: colors.textPrimary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.background,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },

    controlBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },

    // Used by renderNameCell passed to PlayerListTable.
    nameText: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '500' },
    subText: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    // Surface-coloured backdrop sits behind the text so it stays legible
    // against the club gradient. Self-shrinks to the text width via
    // ``alignSelf: 'flex-start'``; the slight horizontal padding gives the
    // rounded chip-style halo the brief asked for. Where the gradient
    // has already faded to surface, the backdrop is invisible (same
    // colour as the row), so it only "appears" where contrast is needed.
    textBackdrop: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.xs,
      // 3px is a tight chip halo; below the named scale on purpose.
      borderRadius: 3,
    },
  });
