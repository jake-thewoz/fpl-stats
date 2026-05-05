import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fetchMyTeam, type SquadEntry } from '../../api/myTeam';
import { fetchPlayersXp } from '../../api/playersXp';
import { useFetch } from '../../hooks/useFetch';
import { useFocusedTeamId } from '../../hooks/useFocusedTeamId';
import { useFocusedPlayersConfig } from '../../hooks/useFocusedPlayersConfig';
import { LoadingView } from '../../components/LoadingView';
import { ErrorView } from '../../components/ErrorView';
import { ColumnPickerDialog } from '../../components/ColumnPickerDialog';
import { FilterDialog } from '../../components/FilterDialog';
import { PlayerListTable } from '../../components/PlayerListTable';
import { FIELD_DEFS } from '../../players/fields';
import { applyAll, activeFilterCount } from '../../players/apply';
import { POSITION_CODES } from '../../players/positions';
import type { FieldKey } from '../../players/types';
import type { MyTeamScreenProps } from '../../navigation/types';
import { useThemedStyles } from '../../theme';
import { ChipBanner, Header, PicksUnavailableNote } from './Header';
import { MyTeamNameCell } from './NameCell';
import { makeStyles } from './styles';
import type { MyTeamRow } from './types';

type Props = MyTeamScreenProps;

export default function MyTeamScreen({ navigation }: Props) {
  const teamId = useFocusedTeamId();
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
  const styles = useThemedStyles(makeStyles);

  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const [myTeam, xpResp] = await Promise.all([
        fetchMyTeam(teamId, signal),
        fetchPlayersXp(signal),
      ]);
      const xpById = new Map(xpResp.players.map((p) => [p.player_id, p]));
      const rows: MyTeamRow[] = myTeam.squad
        .filter(
          (s): s is SquadEntry & { player: NonNullable<SquadEntry['player']> } =>
            s.player != null,
        )
        .map((s) => toMyTeamRow(s, xpById.get(s.player.id)));
      return { myTeam, rows };
    },
    [teamId],
  );
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetcher);

  // Columns / filters / sort are shared with the Players tab via a
  // single set of AsyncStorage keys; the hook re-reads on focus.
  const { columns, filters, sort, setColumns, setFilters, setSort } =
    useFocusedPlayersConfig();

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const rows = useMemo<MyTeamRow[]>(
    () => (state.status === 'ok' ? state.data.rows : []),
    [state],
  );

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
      {myTeam.picksError ? <PicksUnavailableNote message={myTeam.picksError} /> : null}
      {myTeam.picks?.active_chip ? (
        <ChipBanner
          chip={myTeam.picks.active_chip}
          showingPersistentSquad={myTeam.showingPersistentSquad}
        />
      ) : null}
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
        getId={(r) => r.id}
        renderNameCell={(row) => <MyTeamNameCell row={row} />}
        // Bench rows dimmed to de-emphasise non-starters; matches the
        // pressedSubtle dim by coincidence but the semantics are
        // different — leaving inline so a tweak to one doesn't move the
        // other.
        getRowStyle={(r) => (r.isStarter ? undefined : { opacity: 0.6 })}
        refreshing={refreshing}
        onRefresh={onRefresh}
        emptyMessage={
          rows.length === 0
            ? 'No squad data available yet for this gameweek.'
            : 'No players match your filter. Try widening it.'
        }
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

function toMyTeamRow(
  s: SquadEntry & { player: NonNullable<SquadEntry['player']> },
  xp: { xp: number; xp_h3: number | null; xp_h5: number | null } | undefined,
): MyTeamRow {
  const { player } = s;
  const formNum = parseFloat(player.form);
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    price: player.price,
    total_points: player.total_points,
    form: Number.isNaN(formNum) ? 0 : formNum,
    xp: xp?.xp ?? null,
    xp_h3: xp?.xp_h3 ?? null,
    xp_h5: xp?.xp_h5 ?? null,
    defcon: player.defcon,
    defcon_per_90: player.defcon_per_90,
    selected_by_percent: player.selected_by_percent,
    points_per_game: player.points_per_game,
    minutes: player.minutes,
    goals_scored: player.goals_scored,
    assists: player.assists,
    clean_sheets: player.clean_sheets,
    bonus: player.bonus,
    bps: player.bps,
    ict_index: player.ict_index,
    expected_goals: player.expected_goals,
    expected_assists: player.expected_assists,
    cost_change_event: player.cost_change_event,
    isStarter: s.isStarter,
    isCaptain: s.pick.is_captain,
    isViceCaptain: s.pick.is_vice_captain,
    gwPoints: s.gwPoints,
  };
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

function ControlButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
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
      <Text style={[styles.controlBtnText, active && styles.controlBtnTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function NoTeamIdView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No team ID set</Text>
      <Text style={styles.emptyBody}>
        Add your Fantasy Premier League team ID in Settings to see your squad here.
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
