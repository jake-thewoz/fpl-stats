import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, Text, UIManager, View } from 'react-native';
import {
  fetchTransferSuggestions,
  type TransferSuggestionsResponse,
} from '../../api/transferSuggestions';
import { fetchPlayers, type Player } from '../../api/players';
import { useFetch } from '../../hooks/useFetch';
import { useFocusedTeamId } from '../../hooks/useFocusedTeamId';
import { LoadingView } from '../../components/LoadingView';
import { ErrorView } from '../../components/ErrorView';
import {
  PositionFilterDialog,
  type Position,
} from '../../components/PositionFilterDialog';
import { POSITIONS_WITH_LABELS } from '../../players/positions';
import type { TransfersScreenProps } from '../../navigation/types';
import { useThemedStyles } from '../../theme';
import { MessageState, NoTeamIdState, PicksNotFoundState } from './EmptyStates';
import { SuggestionsList } from './SuggestionsList';
import { makeStyles } from './styles';

// Android needs LayoutAnimation explicitly enabled. Once-per-app call,
// safe to leave at module scope — the runtime guards against re-enable.
// SuggestionsList uses LayoutAnimation.configureNext for card-expand
// animations; this enables that on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const HORIZONS = [1, 3, 5] as const;
type Horizon = (typeof HORIZONS)[number];
const DEFAULT_HORIZON: Horizon = 3;

// PositionFilterDialog wants the legacy `Position` shape (id + label),
// derived from the canonical players/positions module.
const POSITIONS: readonly Position[] = POSITIONS_WITH_LABELS.map(({ id, label }) => ({
  id,
  label,
}));

type CombinedData = {
  response: TransferSuggestionsResponse;
  // player_id -> resolved metadata. The transfer endpoint returns
  // team_id/position_id, but /players is the canonical source of
  // resolved short names; joining keeps us decoupled from a per-season
  // hardcoded team mapping.
  playersById: Map<number, Player>;
};

export default function TransfersScreen({ navigation }: TransfersScreenProps) {
  const teamId = useFocusedTeamId();
  const [horizon, setHorizon] = useState<Horizon>(DEFAULT_HORIZON);
  const [positionFilter, setPositionFilter] = useState<readonly number[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  if (teamId === undefined) return <LoadingView />;
  if (teamId === null) {
    return (
      <NoTeamIdState
        onOpenSettings={() => navigation.getParent()?.navigate('SettingsTab')}
      />
    );
  }
  return (
    <>
      <SuggestionsView
        teamId={teamId}
        horizon={horizon}
        positionFilter={positionFilter}
        onChangeHorizon={setHorizon}
        onOpenFilter={() => setFilterOpen(true)}
        onOpenMyTeam={() => navigation.getParent()?.navigate('MyTeamTab')}
      />
      <PositionFilterDialog
        visible={filterOpen}
        positions={POSITIONS}
        selected={positionFilter}
        onToggle={(id) =>
          setPositionFilter((prev) =>
            prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
          )
        }
        onClearAll={() => setPositionFilter([])}
        onClose={() => setFilterOpen(false)}
      />
    </>
  );
}

function SuggestionsView({
  teamId,
  horizon,
  positionFilter,
  onChangeHorizon,
  onOpenFilter,
  onOpenMyTeam,
}: {
  teamId: string;
  horizon: Horizon;
  positionFilter: readonly number[];
  onChangeHorizon: (h: Horizon) => void;
  onOpenFilter: () => void;
  onOpenMyTeam: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  // teamId + horizon + positionFilter are stable refs across renders here,
  // but the closure changes on any of them so the hook re-runs and refetches.
  // useCallback gives us one new ref per (teamId, horizon, filter) tuple,
  // not one per render. Sorting positionFilter inside the dep makes ordering
  // irrelevant — [2, 3] and [3, 2] should be the same fetch.
  const filterKey = useMemo(() => [...positionFilter].sort().join(','), [positionFilter]);
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CombinedData> => {
      const [response, playersResp] = await Promise.all([
        fetchTransferSuggestions(teamId, horizon, positionFilter, signal),
        fetchPlayers(signal),
      ]);
      const playersById = new Map(playersResp.players.map((p) => [p.id, p]));
      return { response, playersById };
    },
    // filterKey is the canonical dep; positionFilter array reference itself
    // would re-run on every state setter call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, horizon, filterKey],
  );
  const { state, refreshing, onRefresh, onRetry } = useFetch(fetcher);

  return (
    <View style={styles.container}>
      <ControlsRow
        horizon={horizon}
        onChangeHorizon={onChangeHorizon}
        onOpenFilter={onOpenFilter}
        filterCount={positionFilter.length}
      />
      <Body
        state={state}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onRetry={onRetry}
        onOpenMyTeam={onOpenMyTeam}
        filterActive={positionFilter.length > 0}
      />
    </View>
  );
}

function Body({
  state,
  refreshing,
  onRefresh,
  onRetry,
  onOpenMyTeam,
  filterActive,
}: {
  state: ReturnType<typeof useFetch<CombinedData>>['state'];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onRetry: () => void;
  onOpenMyTeam: () => void;
  filterActive: boolean;
}) {
  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    if (state.message.includes('Picks not found')) {
      return <PicksNotFoundState onOpenMyTeam={onOpenMyTeam} />;
    }
    if (state.message.includes('Entry not found')) {
      return (
        <ErrorView
          title="FPL team not found"
          message="Double-check your team ID in Settings."
          onRetry={onRetry}
        />
      );
    }
    return (
      <ErrorView
        title="Couldn't load suggestions"
        message={state.message}
        onRetry={onRetry}
      />
    );
  }

  const { response, playersById } = state.data;

  if (response.season_over) {
    return <MessageState title="Season's over" body="No more transfers to plan." />;
  }
  if (response.preseason) {
    return (
      <MessageState
        title="Season hasn't started"
        body="Suggestions will appear once the season begins."
      />
    );
  }
  if (response.bundles.length === 0) {
    if (filterActive) {
      return (
        <MessageState
          title="No suggestions for this filter"
          body="No valid swaps in the selected positions. Try widening the filter."
        />
      );
    }
    return (
      <MessageState
        title="No suggestions"
        body="Every valid swap has lower projected xP than what you already have. That's a good sign — your squad's well-tuned for the next few gameweeks."
      />
    );
  }

  return (
    <SuggestionsList
      response={response}
      playersById={playersById}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  );
}

function ControlsRow({
  horizon,
  onChangeHorizon,
  onOpenFilter,
  filterCount,
}: {
  horizon: Horizon;
  onChangeHorizon: (h: Horizon) => void;
  onOpenFilter: () => void;
  filterCount: number;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.controlsRow}>
      <View style={styles.horizonGroup}>
        {HORIZONS.map((h) => {
          const active = h === horizon;
          return (
            <Pressable
              key={h}
              onPress={() => onChangeHorizon(h)}
              style={({ pressed }) => [
                styles.horizonChip,
                active && styles.horizonChipActive,
                pressed && !active && styles.horizonChipPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.horizonChipText, active && styles.horizonChipTextActive]}
              >
                {h} GW{h === 1 ? '' : 's'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={onOpenFilter}
        style={({ pressed }) => [
          styles.filterButton,
          filterCount > 0 && styles.filterButtonActive,
          pressed && styles.filterButtonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          filterCount > 0 ? `Filter (${filterCount} positions selected)` : 'Filter'
        }
      >
        <Text
          style={[
            styles.filterButtonText,
            filterCount > 0 && styles.filterButtonTextActive,
          ]}
        >
          Filter{filterCount > 0 ? ` (${filterCount})` : ''}
        </Text>
      </Pressable>
    </View>
  );
}
