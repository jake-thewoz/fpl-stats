import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, UIManager, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { TransferSuggestionsResponse } from '../../api/transferSuggestions';
import type { Player } from '../../api/players';
import { useQueryState, type FetchState } from '../../hooks/useQueryState';
import { playersQuery, transferSuggestionsQuery } from '../../query/queries';
import { useFocusedTeamId } from '../../hooks/useFocusedTeamId';
import { LoadingView } from '../../components/LoadingView';
import { ErrorView } from '../../components/ErrorView';
import { POSITIONS_WITH_LABELS } from '../../players/positions';
import {
  DEFAULT_TRANSFER_SETTINGS,
  countActiveFilters,
  freeTransfersOverrideFor,
  type TransferSettings,
} from '../../transfers/settings';
import type { TransfersScreenProps } from '../../navigation/types';
import { useThemedStyles } from '../../theme';
import { MessageState, NoTeamIdState, PicksNotFoundState } from './EmptyStates';
import { SuggestionsList } from './SuggestionsList';
import { TransferFilterDialog, type Position } from './TransferFilterDialog';
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

// TransferFilterDialog wants the legacy `Position` shape (id + label),
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
  const [settings, setSettings] = useState<TransferSettings>(DEFAULT_TRANSFER_SETTINGS);
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
    <SuggestionsView
      teamId={teamId}
      horizon={horizon}
      positionFilter={positionFilter}
      settings={settings}
      onChangeHorizon={setHorizon}
      onChangePositionFilter={setPositionFilter}
      onChangeSettings={setSettings}
      filterOpen={filterOpen}
      onOpenFilter={() => setFilterOpen(true)}
      onCloseFilter={() => setFilterOpen(false)}
      onOpenMyTeam={() => navigation.getParent()?.navigate('MyTeamTab')}
    />
  );
}

function SuggestionsView({
  teamId,
  horizon,
  positionFilter,
  settings,
  onChangeHorizon,
  onChangePositionFilter,
  onChangeSettings,
  filterOpen,
  onOpenFilter,
  onCloseFilter,
  onOpenMyTeam,
}: {
  teamId: string;
  horizon: Horizon;
  positionFilter: readonly number[];
  settings: TransferSettings;
  onChangeHorizon: (h: Horizon) => void;
  onChangePositionFilter: (positions: readonly number[]) => void;
  onChangeSettings: (settings: TransferSettings) => void;
  filterOpen: boolean;
  onOpenFilter: () => void;
  onCloseFilter: () => void;
  onOpenMyTeam: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const suggestionsQuery = useQuery(
    transferSuggestionsQuery(teamId, {
      horizon,
      positions: positionFilter,
      maxTransfers: settings.maxTransfers,
      freeTransfers: settings.freeTransfersOverride,
    }),
  );
  const playersQueryResult = useQuery(playersQuery());
  const response = suggestionsQuery.data;
  const playersResp = playersQueryResult.data;
  const data = useMemo<CombinedData | undefined>(() => {
    if (response === undefined || playersResp === undefined) return undefined;
    const playersById = new Map(playersResp.players.map((p) => [p.id, p]));
    return { response, playersById };
  }, [response, playersResp]);
  const { state, refreshing, onRefresh, onRetry } = useQueryState(
    [suggestionsQuery, playersQueryResult],
    data,
  );

  // Held across refetches: changing a setting starts a new query with no
  // data yet, and the dialog's FT picker shouldn't vanish while it loads.
  const [derivedFreeTransfers, setDerivedFreeTransfers] = useState<number>();
  useEffect(() => {
    if (response !== undefined) setDerivedFreeTransfers(response.derived_free_transfers);
  }, [response]);

  const activeFilterCount = countActiveFilters(positionFilter, settings);

  return (
    <View style={styles.container}>
      <ControlsRow
        horizon={horizon}
        onChangeHorizon={onChangeHorizon}
        onOpenFilter={onOpenFilter}
        filterCount={activeFilterCount}
      />
      <Body
        state={state}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onRetry={onRetry}
        onOpenMyTeam={onOpenMyTeam}
        filterActive={positionFilter.length > 0}
      />
      <TransferFilterDialog
        visible={filterOpen}
        onClose={onCloseFilter}
        maxTransfers={settings.maxTransfers}
        onChangeMaxTransfers={(maxTransfers) =>
          onChangeSettings({ ...settings, maxTransfers })
        }
        freeTransfers={settings.freeTransfersOverride ?? derivedFreeTransfers}
        derivedFreeTransfers={derivedFreeTransfers}
        onChangeFreeTransfers={(picked) =>
          onChangeSettings({
            ...settings,
            freeTransfersOverride: freeTransfersOverrideFor(picked, derivedFreeTransfers),
          })
        }
        positions={POSITIONS}
        selectedPositions={positionFilter}
        onTogglePosition={(id) =>
          onChangePositionFilter(
            positionFilter.includes(id)
              ? positionFilter.filter((p) => p !== id)
              : [...positionFilter, id],
          )
        }
        hasActiveFilters={activeFilterCount > 0}
        onClearAll={() => {
          onChangePositionFilter([]);
          onChangeSettings(DEFAULT_TRANSFER_SETTINGS);
        }}
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
  state: FetchState<CombinedData>;
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
        accessibilityLabel={filterCount > 0 ? `Filter (${filterCount} active)` : 'Filter'}
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
