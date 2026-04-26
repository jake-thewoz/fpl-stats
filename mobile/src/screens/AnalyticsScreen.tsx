import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  EntryNotFoundError,
  PicksNotFoundError,
  fetchTransferSuggestions,
  type TransferSuggestion,
  type TransferSuggestionsResponse,
} from '../api/transferSuggestions';
import { fetchPlayers, type Player } from '../api/players';
import { getFplTeamId } from '../storage/user';
import { useFetch } from '../hooks/useFetch';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import {
  PositionFilterDialog,
  type Position,
} from '../components/PositionFilterDialog';
import type { AnalyticsScreenProps } from '../navigation/types';
import { colors } from '../theme';

const HORIZONS = [1, 3, 5] as const;
type Horizon = (typeof HORIZONS)[number];
const DEFAULT_HORIZON: Horizon = 3;

// FPL element_type ids in display order. Stable across seasons.
const POSITIONS: readonly Position[] = [
  { id: 1, label: 'Goalkeepers' },
  { id: 2, label: 'Defenders' },
  { id: 3, label: 'Midfielders' },
  { id: 4, label: 'Forwards' },
] as const;

type CombinedData = {
  suggestions: TransferSuggestionsResponse;
  // player_id -> resolved metadata. The transfer endpoint returns
  // team_id/position_id, but /players is the canonical source of
  // resolved short names; joining keeps us decoupled from a per-season
  // hardcoded team mapping.
  playersById: Map<number, Player>;
};

export default function AnalyticsScreen({ navigation }: AnalyticsScreenProps) {
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [horizon, setHorizon] = useState<Horizon>(DEFAULT_HORIZON);
  const [positionFilter, setPositionFilter] = useState<readonly number[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    getFplTeamId().then(setTeamId);
  }, []);

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
  // teamId + horizon + positionFilter are stable refs across renders here,
  // but the closure changes on any of them so the hook re-runs and refetches.
  // useCallback gives us one new ref per (teamId, horizon, filter) tuple,
  // not one per render. Sorting positionFilter inside the dep makes ordering
  // irrelevant — [2, 3] and [3, 2] should be the same fetch.
  const filterKey = useMemo(
    () => [...positionFilter].sort().join(','),
    [positionFilter],
  );
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CombinedData> => {
      const [suggestions, playersResp] = await Promise.all([
        fetchTransferSuggestions(teamId, horizon, positionFilter, signal),
        fetchPlayers(signal),
      ]);
      const playersById = new Map(playersResp.players.map((p) => [p.id, p]));
      return { suggestions, playersById };
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

  const { suggestions, playersById } = state.data;

  if (suggestions.season_over) {
    return <MessageState title="Season's over" body="No more transfers to plan." />;
  }
  if (suggestions.preseason) {
    return (
      <MessageState
        title="Season hasn't started"
        body="Suggestions will appear once the season begins."
      />
    );
  }
  if (suggestions.suggestions.length === 0) {
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
    <FlatList
      data={suggestions.suggestions}
      keyExtractor={(s) => `${s.out.player_id}-${s.in.player_id}`}
      renderItem={({ item }) => (
        <SuggestionCard suggestion={item} playersById={playersById} />
      )}
      ListHeaderComponent={
        <Header
          horizonGwIds={suggestions.horizon_gw_ids}
          currentSquadXp={suggestions.current_squad_xp}
        />
      }
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function SuggestionCard({
  suggestion,
  playersById,
}: {
  suggestion: TransferSuggestion;
  playersById: Map<number, Player>;
}) {
  const out = playersById.get(suggestion.out.player_id);
  const inP = playersById.get(suggestion.in.player_id);

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <PlayerBlock
          align="left"
          fallback={suggestion.out.web_name}
          player={out}
        />
        <CenterBadge
          deltaXp={suggestion.delta_xp}
          costChange={suggestion.cost_change}
        />
        <PlayerBlock
          align="right"
          fallback={suggestion.in.web_name}
          player={inP}
        />
      </View>
    </View>
  );
}

function PlayerBlock({
  align,
  fallback,
  player,
}: {
  align: 'left' | 'right';
  fallback: string;
  player: Player | undefined;
}) {
  const name = player?.name ?? fallback;
  const team = player?.team ?? '';
  const position = player?.position ?? '';
  const price = player?.price;
  const sub = [team, position, price ? `£${price.toFixed(1)}m` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[
        styles.playerBlock,
        align === 'right' ? styles.playerBlockRight : styles.playerBlockLeft,
      ]}
    >
      <Text style={styles.playerName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.playerSub} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function CenterBadge({
  deltaXp,
  costChange,
}: {
  deltaXp: number;
  costChange: number;
}) {
  const xpStr = `${deltaXp >= 0 ? '+' : ''}${deltaXp.toFixed(1)} xP`;
  // cost_change in 0.1m units; positive = costs you money. Show £x.x with
  // signs flipped so it reads as "your bank delta" — negative cost_change
  // (cheaper in player) shows as a positive bank delta.
  const bankDelta = -costChange / 10;
  const costStr = bankDelta === 0
    ? '£0.0'
    : `${bankDelta > 0 ? '+' : ''}£${bankDelta.toFixed(1)}m`;

  return (
    <View style={styles.center}>
      <View style={styles.arrowRow}>
        <Text style={styles.arrowText}>→</Text>
      </View>
      <Text style={styles.deltaXp}>{xpStr}</Text>
      <Text style={styles.deltaCost}>{costStr}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header / horizon selector / empty states
// ---------------------------------------------------------------------------

function Header({
  horizonGwIds,
  currentSquadXp,
}: {
  horizonGwIds: number[];
  currentSquadXp: number | undefined;
}) {
  if (horizonGwIds.length === 0) return null;
  const range =
    horizonGwIds.length === 1
      ? `GW ${horizonGwIds[0]}`
      : `GWs ${horizonGwIds[0]}–${horizonGwIds[horizonGwIds.length - 1]}`;
  return (
    <View style={styles.header}>
      <Text style={styles.headerLine}>
        Top transfers across {range}
      </Text>
      {typeof currentSquadXp === 'number' && (
        <Text style={styles.headerSub}>
          Current squad projected: {currentSquadXp.toFixed(1)} xP
        </Text>
      )}
    </View>
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
                style={[
                  styles.horizonChipText,
                  active && styles.horizonChipTextActive,
                ]}
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
          filterCount > 0
            ? `Filter (${filterCount} positions selected)`
            : 'Filter'
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

function NoTeamIdState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No team ID set</Text>
      <Text style={styles.emptyBody}>
        Add your Fantasy Premier League team ID in Settings to see transfer
        suggestions.
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

function PicksNotFoundState({ onOpenMyTeam }: { onOpenMyTeam: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>Squad not loaded</Text>
      <Text style={styles.emptyBody}>
        Open the My Team tab first to load your squad — suggestions need to
        know which players you currently have.
      </Text>
      <Pressable
        onPress={onOpenMyTeam}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Open My Team</Text>
      </Pressable>
    </View>
  );
}

function MessageState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 12,
    paddingTop: 4,
    paddingBottom: 24,
  },

  // Horizon chips on the left, filter button on the right.
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  horizonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filterButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterButtonPressed: {
    opacity: 0.6,
  },
  filterButtonText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: colors.onAccent,
  },
  horizonChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  horizonChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  horizonChipPressed: {
    opacity: 0.6,
  },
  horizonChipText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  horizonChipTextActive: {
    color: colors.onAccent,
  },

  // List header (above the cards).
  header: {
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerLine: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Card.
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginVertical: 6,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerBlock: {
    flex: 1,
    minWidth: 0, // lets numberOfLines + flex work together correctly
  },
  playerBlockLeft: {
    alignItems: 'flex-start',
    paddingRight: 8,
  },
  playerBlockRight: {
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  playerSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Center column: arrow + delta xp + bank delta.
  center: {
    minWidth: 80,
    alignItems: 'center',
  },
  arrowRow: {
    marginBottom: 2,
  },
  arrowText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  deltaXp: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  deltaCost: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Empty / message states.
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  primaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.accent,
    borderRadius: 6,
  },
  primaryBtnText: {
    color: colors.onAccent,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
