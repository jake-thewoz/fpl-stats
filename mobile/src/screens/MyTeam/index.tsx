import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useMyTeam } from '../../hooks/useMyTeam';
import { useQueryState } from '../../hooks/useQueryState';
import { playersXpQuery } from '../../query/queries';
import { useFocusedTeamId } from '../../hooks/useFocusedTeamId';
import { useFocusedPlayersConfig } from '../../hooks/useFocusedPlayersConfig';
import { LoadingView } from '../../components/LoadingView';
import { ErrorView } from '../../components/ErrorView';
import { ActiveFilterChips } from '../../components/ActiveFilterChips';
import { ColumnPickerDialog } from '../../components/ColumnPickerDialog';
import { ControlButton } from '../../components/ControlButton';
import { FilterDialog } from '../../components/FilterDialog';
import { PlayerListTable } from '../../components/PlayerListTable';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl';
import { FIELD_DEFS, xpHeaderSublabels } from '../../players/fields';
import { applyAll, activeFilterCount } from '../../players/apply';
import { POSITION_CODES } from '../../players/positions';
import type { FieldKey } from '../../players/types';
import type { MyTeamScreenProps } from '../../navigation/types';
import {
  DEFAULT_MY_TEAM_VIEW,
  getMyTeamView,
  setMyTeamView,
  type MyTeamView,
} from '../../storage/user';
import { useThemedStyles } from '../../theme';
import { ChipBanner, Header, PicksUnavailableNote } from './Header';
import { lineupFromPicks, type LineupSlot } from './lineup';
import { LineupControls, type LineupSource } from './LineupControls';
import { MyTeamNameCell } from './NameCell';
import { EMPTY_SQUAD_MESSAGE, gameweekPointsText, squadRows } from './rows';
import { PitchView } from './PitchView';
import { makeStyles } from './styles';
import { DEFAULT_LINEUP_METRIC, suggestLineup, type LineupMetric } from './suggestLineup';
import type { MyTeamRow } from './types';

type Props = MyTeamScreenProps;

const VIEW_OPTIONS: readonly SegmentOption<MyTeamView>[] = [
  { value: 'pitch', label: 'Pitch' },
  { value: 'list', label: 'List' },
];

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

  const myTeamQuery = useMyTeam(teamId);
  const xpQuery = useQuery(playersXpQuery());
  const myTeamData = myTeamQuery.data;
  const xpResp = xpQuery.data;
  const data = useMemo(() => {
    if (myTeamData === undefined || xpResp === undefined) return undefined;
    const xpById = new Map(xpResp.players.map((p) => [p.player_id, p]));
    const rows = squadRows(myTeamData.squad, xpById);
    return { myTeam: myTeamData, rows, xpGameweek: xpResp.gameweek };
  }, [myTeamData, xpResp]);
  const { state, refreshing, onRefresh, onRetry } = useQueryState(
    [...myTeamQuery.queries, xpQuery],
    data,
  );

  // Columns / filters / sort are shared with the Players tab via a
  // single set of AsyncStorage keys; the hook re-reads on focus.
  const { columns, filters, sort, setColumns, setFilters, setSort } =
    useFocusedPlayersConfig();

  const [view, setView] = useState<MyTeamView>(DEFAULT_MY_TEAM_VIEW);
  useEffect(() => {
    let alive = true;
    getMyTeamView().then((stored) => {
      if (alive) setView(stored);
    });
    return () => {
      alive = false;
    };
  }, []);
  const onChangeView = useCallback((next: MyTeamView) => {
    setView(next);
    setMyTeamView(next);
  }, []);

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

  const [lineupSource, setLineupSource] = useState<LineupSource>('yours');
  const [lineupMetric, setLineupMetric] = useState<LineupMetric>(DEFAULT_LINEUP_METRIC);
  const pickedLineup = useMemo(() => lineupFromPicks(rows), [rows]);
  const suggestion = useMemo(
    () => suggestLineup(rows, lineupMetric),
    [rows, lineupMetric],
  );
  const showSuggestion = lineupSource === 'suggested' && suggestion != null;
  const metricText = useCallback(
    (slot: LineupSlot) => {
      const { accessor, format, shortLabel } = FIELD_DEFS[lineupMetric];
      return `${format(accessor(slot.row))} ${shortLabel}`;
    },
    [lineupMetric],
  );

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

  const { myTeam, xpGameweek } = state.data;

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
        view={view}
        onChangeView={onChangeView}
        filterCount={activeFilterCount(filters)}
        onOpenFilter={() => setFiltersOpen(true)}
        onOpenColumns={() => setColumnsOpen(true)}
      />
      {view === 'list' ? (
        <ActiveFilterChips filters={filters} onChange={setFilters} />
      ) : null}
      {view === 'pitch' ? (
        rows.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyBody}>{EMPTY_SQUAD_MESSAGE}</Text>
          </View>
        ) : (
          <>
            <LineupControls
              source={lineupSource}
              onChangeSource={setLineupSource}
              metric={lineupMetric}
              onChangeMetric={setLineupMetric}
              suggestion={suggestion}
              squadGameweek={myTeam.gameweek}
              targetGameweek={xpGameweek}
            />
            <PitchView
              lineup={showSuggestion ? suggestion.lineup : pickedLineup}
              getStatText={showSuggestion ? metricText : gameweekPointsText}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          </>
        )
      ) : (
        <PlayerListTable
          data={filteredSorted}
          columns={columns}
          sort={sort}
          onTapHeader={onTapColumnHeader}
          headerSublabels={xpHeaderSublabels(xpGameweek)}
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
              ? EMPTY_SQUAD_MESSAGE
              : 'No players match your filter. Try widening it.'
          }
        />
      )}

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

function ControlBar({
  view,
  onChangeView,
  filterCount,
  onOpenFilter,
  onOpenColumns,
}: {
  view: MyTeamView;
  onChangeView: (next: MyTeamView) => void;
  filterCount: number;
  onOpenFilter: () => void;
  onOpenColumns: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.controlBar}>
      <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={onChangeView} />
      {/* Filters and columns shape the list only; the pitch always shows
          the full fifteen. */}
      {view === 'list' ? (
        <View style={styles.controlGroup}>
          <ControlButton
            label={filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}
            active={filterCount > 0}
            onPress={onOpenFilter}
          />
          <ControlButton label="Columns" onPress={onOpenColumns} />
        </View>
      ) : null}
    </View>
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
