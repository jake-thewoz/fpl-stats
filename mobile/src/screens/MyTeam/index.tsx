import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../components/Text';
import { useQuery } from '@tanstack/react-query';
import { FREE_HIT_CHIP } from '../../api/myTeam';
import { useMyTeam } from '../../hooks/useMyTeam';
import { useQueryState, useRefetchStaleOnFocus } from '../../hooks/useQueryState';
import { indexUpcomingFixtures } from '../../fixtures/upcoming';
import {
  fixturesUpcomingQuery,
  playerStatsQuery,
  playersQuery,
  playersXpQuery,
} from '../../query/queries';
import { indexPlayerStats } from '../../api/playerStats';
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
import {
  FIELD_DEFS,
  gameweeksPlayedBefore,
  heatCeiling,
  columnHeaderSublabels,
} from '../../players/fields';
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
import { FreeHitBanner, Header, PicksUnavailableNote } from './Header';
import { lineupFromPicks, type LineupSlot, type PitchStat } from './lineup';
import { LineupControls, type LineupSource } from './LineupControls';
import { MyTeamNameCell } from './NameCell';
import { EMPTY_SQUAD_MESSAGE, gameweekPointsStat, poolRows, squadRows } from './rows';
import { PitchView } from './PitchView';
import { makeStyles } from './styles';
import { DEFAULT_LINEUP_METRIC, suggestLineup, type LineupMetric } from './suggestLineup';
import type { MyTeamRow } from './types';
import { buildWildcard, DEFAULT_WILDCARD_METRIC, type WildcardMetric } from './wildcard';

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
  // Fixtures and the extra stats decorate the list but don't gate it: the
  // screen renders without them and fills them in when they arrive.
  const fixturesQuery = useQuery(fixturesUpcomingQuery());
  const statsQuery = useQuery(playerStatsQuery());
  // Same cache useMyTeam already fills; the wildcard view picks from it.
  const playersPoolQuery = useQuery(playersQuery());
  useRefetchStaleOnFocus([fixturesQuery, statsQuery]);
  const myTeamData = myTeamQuery.data;
  const xpResp = xpQuery.data;
  const fixturesResp = fixturesQuery.data;
  const statsResp = statsQuery.data;
  const data = useMemo(() => {
    if (myTeamData === undefined || xpResp === undefined) return undefined;
    const xpById = new Map(xpResp.players.map((p) => [p.player_id, p]));
    const upcoming = fixturesResp && indexUpcomingFixtures(fixturesResp);
    const statsById = statsResp && indexPlayerStats(statsResp);
    const rows = squadRows(myTeamData.squad, xpById, upcoming, statsById);
    return {
      myTeam: myTeamData,
      rows,
      xpById,
      upcoming,
      statsById,
      xpGameweek: xpResp.gameweek,
      fixtureGameweeks: upcoming?.gameweeks,
    };
  }, [myTeamData, xpResp, fixturesResp, statsResp]);
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
  const [wildcardMetric, setWildcardMetric] = useState<WildcardMetric>(
    DEFAULT_WILDCARD_METRIC,
  );
  // null until the user nudges it: follows the squad's value + bank.
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const bank = data?.myTeam.entry.last_deadline_bank ?? null;
  const defaultBudget = useMemo(
    () =>
      Math.round(rows.reduce((sum, row) => sum + row.price * 10, 0) + (bank ?? 0)) / 10,
    [rows, bank],
  );
  const budget = budgetOverride ?? defaultBudget;
  const playersPool = playersPoolQuery.data?.players;
  const wildcard = useMemo(() => {
    if (lineupSource !== 'wildcard' || !data || !playersPool) return null;
    const { xpById, upcoming, statsById } = data;
    const pool = poolRows(playersPool, xpById, upcoming, statsById);
    return buildWildcard(pool, wildcardMetric, budget, rows);
  }, [lineupSource, data, playersPool, wildcardMetric, budget, rows]);
  const pickedLineup = useMemo(() => lineupFromPicks(rows), [rows]);
  const suggestion = useMemo(
    () => suggestLineup(rows, lineupMetric),
    [rows, lineupMetric],
  );
  const showSuggestion = lineupSource === 'suggested' && suggestion != null;
  const showWildcard = lineupSource === 'wildcard' && wildcard != null;
  const gameweeksPlayed = gameweeksPlayedBefore(xpResp?.gameweek ?? null);
  const statFor = useCallback(
    (metric: LineupMetric | WildcardMetric) =>
      (slot: LineupSlot): PitchStat => {
        const { accessor, format, shortLabel } = FIELD_DEFS[metric];
        const value = accessor(slot.row);
        return {
          text: `${format(value)} ${shortLabel}`,
          value,
          heatCeiling: heatCeiling(metric, gameweeksPlayed),
        };
      },
    [gameweeksPlayed],
  );
  const metricStat = useMemo(() => statFor(lineupMetric), [statFor, lineupMetric]);
  const wildcardStat = useMemo(() => statFor(wildcardMetric), [statFor, wildcardMetric]);

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

  const { myTeam, xpGameweek, fixtureGameweeks } = state.data;

  return (
    <View style={styles.container}>
      <Header
        entry={myTeam.entry}
        gameweek={myTeam.gameweek}
        activeChip={myTeam.picks?.active_chip}
      />
      {myTeam.picksError ? <PicksUnavailableNote message={myTeam.picksError} /> : null}
      {myTeam.picks?.active_chip === FREE_HIT_CHIP ? (
        <FreeHitBanner showingPersistentSquad={myTeam.showingPersistentSquad} />
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
              wildcard={{
                metric: wildcardMetric,
                onChangeMetric: setWildcardMetric,
                budget,
                onChangeBudget: setBudgetOverride,
                suggestion: wildcard,
              }}
            />
            <PitchView
              lineup={
                showWildcard
                  ? wildcard.lineup
                  : showSuggestion
                    ? suggestion.lineup
                    : pickedLineup
              }
              getStat={
                showWildcard
                  ? wildcardStat
                  : showSuggestion
                    ? metricStat
                    : gameweekPointsStat
              }
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
          headerSublabels={columnHeaderSublabels(xpGameweek, fixtureGameweeks)}
          gameweeksPlayed={gameweeksPlayed}
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
