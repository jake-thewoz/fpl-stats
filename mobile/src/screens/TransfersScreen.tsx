import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

// Android needs LayoutAnimation explicitly enabled. Once-per-app call,
// safe to leave at module scope — the runtime guards against re-enable.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {
  EntryNotFoundError,
  PicksNotFoundError,
  fetchTransferSuggestions,
  type TransferBundle,
  type TransferMove,
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
import type { TransfersScreenProps } from '../navigation/types';
import { useTheme, useThemedStyles, type Colors } from '../theme';

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
  response: TransferSuggestionsResponse;
  // player_id -> resolved metadata. The transfer endpoint returns
  // team_id/position_id, but /players is the canonical source of
  // resolved short names; joining keeps us decoupled from a per-season
  // hardcoded team mapping.
  playersById: Map<number, Player>;
};

export default function TransfersScreen({ navigation }: TransfersScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [horizon, setHorizon] = useState<Horizon>(DEFAULT_HORIZON);
  const [positionFilter, setPositionFilter] = useState<readonly number[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  // Re-read on every focus so a team-id change in Settings propagates
  // here without a full app reload (matches the My Team tab).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getFplTeamId().then((id) => {
        if (alive) setTeamId(id);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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

function bundleKey(bundle: TransferBundle): string {
  return bundle.moves
    .map((m) => `${m.out.player_id}-${m.in.player_id}`)
    .join('|');
}

function SuggestionsList({
  response,
  playersById,
  refreshing,
  onRefresh,
}: {
  response: TransferSuggestionsResponse;
  playersById: Map<number, Player>;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const styles = useThemedStyles(makeStyles);
  // One card expanded at a time. Stable per-bundle key (joined out-in
  // pairs) survives data refreshes — if the same bundle is still in
  // the list after a refresh, it stays expanded.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const toggleExpand = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <FlatList
      data={response.bundles}
      keyExtractor={bundleKey}
      renderItem={({ item }) => {
        const key = bundleKey(item);
        return (
          <BundleCard
            bundle={item}
            playersById={playersById}
            isExpanded={expandedKey === key}
            onToggle={() => toggleExpand(key)}
          />
        );
      }}
      ListHeaderComponent={
        <Header
          horizonGwIds={response.horizon_gw_ids}
          currentSquadXp={response.current_squad_xp}
          freeTransfers={response.free_transfers}
          freehitActive={response.freehit_active}
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

function BundleCard({
  bundle,
  playersById,
  isExpanded,
  onToggle,
}: {
  bundle: TransferBundle;
  playersById: Map<number, Player>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isMulti = bundle.num_transfers > 1;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityLabel={
        isExpanded ? 'Collapse bundle details' : 'Expand bundle details'
      }
    >
      {isMulti ? <BundleSummary bundle={bundle} /> : null}
      {bundle.moves.map((move, i) => (
        <View key={`${move.out.player_id}-${move.in.player_id}`}>
          {i > 0 ? <View style={styles.moveDivider} /> : null}
          <View style={styles.cardRow}>
            <PlayerBlock
              align="left"
              fallback={move.out.web_name}
              player={playersById.get(move.out.player_id)}
            />
            <CenterBadge
              deltaXp={move.delta_xp}
              costChange={move.cost_change}
            />
            <PlayerBlock
              align="right"
              fallback={move.in.web_name}
              player={playersById.get(move.in.player_id)}
            />
          </View>
        </View>
      ))}
      <View style={styles.chevronRow}>
        <Text style={styles.chevron}>{isExpanded ? '▴' : '▾'}</Text>
      </View>
      {isExpanded
        ? bundle.moves.map((move, i) => (
            <View key={`compare-${move.out.player_id}-${move.in.player_id}`}>
              {isMulti ? (
                <Text style={styles.compareMoveLabel}>
                  Move {i + 1}: {move.out.web_name} → {move.in.web_name}
                </Text>
              ) : null}
              <CompareTable move={move} />
            </View>
          ))
        : null}
    </Pressable>
  );
}

function BundleSummary({ bundle }: { bundle: TransferBundle }) {
  const styles = useThemedStyles(makeStyles);
  // Net is the headline; gross + hit explain how we got there.
  const netStr = `${bundle.delta_xp_net >= 0 ? '+' : ''}${bundle.delta_xp_net.toFixed(1)} xP net`;
  const detail =
    bundle.hit_cost > 0
      ? `${bundle.num_transfers} transfers · gross ${bundle.delta_xp_gross.toFixed(1)} − ${bundle.hit_cost} hit`
      : `${bundle.num_transfers} transfers · no hit`;
  return (
    <View style={styles.bundleSummary}>
      <Text style={styles.bundleSummaryNet}>{netStr}</Text>
      <Text style={styles.bundleSummaryDetail}>{detail}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Expanded comparison table
// ---------------------------------------------------------------------------

/**
 * Color-codes a fixture-quality value on a three-stop scale:
 * sage (good) / warning (mid) / danger (bad). Used for both
 * `avg_upcoming_difficulty` (1–5, lower = easier) and
 * `avg_upcoming_elo_expected_score` (0–1, higher = better).
 *
 * Returns `null` for null inputs so the caller can render a neutral
 * cell — null doesn't mean "bad", it means "no data".
 */
type ColorTone = 'good' | 'mid' | 'bad' | null;

function difficultyTone(value: number | null): ColorTone {
  if (value == null) return null;
  if (value <= 2.5) return 'good';
  if (value < 3.5) return 'mid';
  return 'bad';
}

function eloTone(value: number | null): ColorTone {
  if (value == null) return null;
  if (value >= 0.55) return 'good';
  if (value >= 0.45) return 'mid';
  return 'bad';
}

function fmt(value: number | null, digits: number): string {
  return value == null ? '—' : value.toFixed(digits);
}

function CompareTable({ move }: { move: TransferMove }) {
  const styles = useThemedStyles(makeStyles);
  const { out, in: inP } = move;

  return (
    <View style={styles.compareTable}>
      <View style={styles.compareDivider} />
      <Row
        label="Form"
        outText={fmt(out.form_score, 1)}
        inText={fmt(inP.form_score, 1)}
      />
      <Row
        label="Avg fixture difficulty"
        outText={fmt(out.avg_upcoming_difficulty, 1)}
        inText={fmt(inP.avg_upcoming_difficulty, 1)}
        outTone={difficultyTone(out.avg_upcoming_difficulty)}
        inTone={difficultyTone(inP.avg_upcoming_difficulty)}
      />
      <Row
        label="Avg ELO win prob"
        outText={fmt(out.avg_upcoming_elo_expected_score, 2)}
        inText={fmt(inP.avg_upcoming_elo_expected_score, 2)}
        outTone={eloTone(out.avg_upcoming_elo_expected_score)}
        inTone={eloTone(inP.avg_upcoming_elo_expected_score)}
      />
      <Row
        label="Horizon xP"
        outText={fmt(out.horizon_xp, 1)}
        inText={fmt(inP.horizon_xp, 1)}
      />
    </View>
  );
}

function Row({
  label,
  outText,
  inText,
  outTone = null,
  inTone = null,
}: {
  label: string;
  outText: string;
  inText: string;
  outTone?: ColorTone;
  inTone?: ColorTone;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <ToneCell text={outText} tone={outTone} />
      <ToneCell text={inText} tone={inTone} />
    </View>
  );
}

function ToneCell({ text, tone }: { text: string; tone: ColorTone }) {
  const styles = useThemedStyles(makeStyles);
  // Tone styles tint background + text. Null tone = neutral cell with
  // primary text color, so "—" and uncolored metrics share the look.
  const cellStyle =
    tone === 'good'
      ? styles.toneCellGood
      : tone === 'mid'
        ? styles.toneCellMid
        : tone === 'bad'
          ? styles.toneCellBad
          : null;
  const textStyle =
    tone === 'good'
      ? styles.toneTextGood
      : tone === 'mid'
        ? styles.toneTextMid
        : tone === 'bad'
          ? styles.toneTextBad
          : styles.toneTextNeutral;
  return (
    <View style={[styles.compareCell, cellStyle]}>
      <Text style={[styles.compareCellText, textStyle]}>{text}</Text>
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
      {/* xP delta gets a filled accent pill — the headline value of the
          card. Plain accent-colored text was washing out in dark mode
          (#96 PR review). */}
      <View style={styles.deltaXpPill}>
        <Text style={styles.deltaXpPillText}>{xpStr}</Text>
      </View>
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
  freeTransfers,
  freehitActive,
}: {
  horizonGwIds: number[];
  currentSquadXp: number | undefined;
  freeTransfers: number;
  freehitActive: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  if (horizonGwIds.length === 0) return null;
  const range =
    horizonGwIds.length === 1
      ? `GW ${horizonGwIds[0]}`
      : `GWs ${horizonGwIds[0]}–${horizonGwIds[horizonGwIds.length - 1]}`;
  const ftLabel =
    freeTransfers === 1 ? '1 free transfer' : `${freeTransfers} free transfers`;
  return (
    <View style={styles.header}>
      <Text style={styles.headerLine}>
        Top transfers across {range}
      </Text>
      <Text style={styles.headerSub}>
        {ftLabel}
        {typeof currentSquadXp === 'number'
          ? ` · current squad projected ${currentSquadXp.toFixed(1)} xP`
          : ''}
      </Text>
      {freehitActive ? (
        <Text style={styles.headerFreehitNote}>
          Free Hit active — suggestions are for your persistent squad (not the
          temporary FH eleven), so they apply once your real team reappears
          at the next deadline.
        </Text>
      ) : null}
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
  const { colors } = useTheme();
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  // FH note: small but visually distinct so the user sees that
  // suggestions are computed against the persistent squad, not the
  // FH eleven. Mirrors the louder banner on the My Team screen but
  // doesn't need the warning treatment because suggestions are still
  // actionable in this state.
  headerFreehitNote: {
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.warning,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    lineHeight: 16,
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
  cardPressed: { opacity: 0.85 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Multi-move bundles stack moves vertically; this divider separates them.
  moveDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  // Bundle-level summary above the move stack: net delta xP + hit detail.
  bundleSummary: {
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bundleSummaryNet: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bundleSummaryDetail: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Per-move heading inside the expanded compare section, only shown
  // for multi-move bundles so the user knows which compare table goes
  // with which move.
  compareMoveLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 2,
  },
  chevronRow: {
    alignItems: 'center',
    marginTop: 4,
  },
  chevron: {
    fontSize: 14,
    color: colors.textMuted,
  },

  // Expanded comparison table (#97). Sits below the main row when the
  // user taps to expand. Three columns: metric label / out value / in
  // value. Values are right-aligned; cells with a fixture-quality tone
  // tint background + text on the sage/warning/danger scale.
  compareTable: {
    marginTop: 4,
  },
  compareDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  compareLabel: {
    flex: 2,
    fontSize: 13,
    color: colors.textMuted,
  },
  compareCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  compareCellText: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // Three-stop tone scale for fixture-quality cells. Solid colour
  // backgrounds with high-contrast text, on a heat-map model: easy
  // fixtures = sage, mid = warning, hard = danger. Conventionally
  // sage/yellow take dark text; the deeper red takes white.
  toneCellGood: { backgroundColor: colors.accentSoft },
  toneCellMid: { backgroundColor: colors.warning },
  toneCellBad: { backgroundColor: colors.danger },
  toneTextGood: { color: colors.onAccentSoft },
  toneTextMid: { color: '#070707' },
  toneTextBad: { color: '#ffffff' },
  toneTextNeutral: { color: colors.textPrimary },
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
  deltaXpPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  deltaXpPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onAccent,
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
