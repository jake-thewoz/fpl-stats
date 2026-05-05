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
import { useFetch } from '../hooks/useFetch';
import { useFocusedTeamId } from '../hooks/useFocusedTeamId';
import { ClubBackground } from '../components/ClubBackground';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import {
  PositionFilterDialog,
  type Position,
} from '../components/PositionFilterDialog';
import { POSITIONS_WITH_LABELS } from '../players/positions';
import {
  difficultyTone,
  eloTone,
  type ColorTone,
} from '../transfers/scoring';
import type { TransfersScreenProps } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

const HORIZONS = [1, 3, 5] as const;
type Horizon = (typeof HORIZONS)[number];
const DEFAULT_HORIZON: Horizon = 3;

// PositionFilterDialog wants the legacy `Position` shape (id + label),
// derived from the canonical players/positions module.
const POSITIONS: readonly Position[] = POSITIONS_WITH_LABELS.map(
  ({ id, label }) => ({ id, label }),
);

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
  const positive = bundle.delta_xp_net >= 0;
  const netStr = `${positive ? '+' : ''}${bundle.delta_xp_net.toFixed(1)} xP`;
  return (
    <View style={styles.bundleSummary}>
      {/* Net xP gets the same sign-coloured-pill treatment as the
          per-move CenterBadge so the bundle headline is visually
          consistent with the moves it describes. Slightly larger
          font / padding to keep it the dominant element on the card. */}
      <View
        style={[
          styles.bundleSummaryNetPill,
          positive
            ? styles.bundleSummaryNetPillPositive
            : styles.bundleSummaryNetPillNegative,
        ]}
      >
        <Text
          style={[
            styles.bundleSummaryNetPillText,
            positive
              ? styles.bundleSummaryNetPillTextPositive
              : styles.bundleSummaryNetPillTextNegative,
          ]}
        >
          {netStr}
        </Text>
      </View>
      {/* Detail row: bank pill + (conditional) hit pill. The bundle's
          transfer count is implicit from the move stack rendered
          below, so the previous "N transfers" text has been dropped. */}
      <View style={styles.bundleSummaryDetailRow}>
        <BankDeltaPill costChange={bundle.total_cost_change} />
        {bundle.hit_cost > 0 ? <HitPill hitCost={bundle.hit_cost} /> : null}
      </View>
    </View>
  );
}

/**
 * Small pill showing the bank delta for a swap or bundle. ``costChange``
 * is what FPL's API uses (positive = the swap costs you money). We
 * negate it for display so the pill reads as the user's bank delta:
 * positive = "you gained money", negative = "you lost money".
 *
 * - Gain → sage / accentSoft (matches the positive delta-xP pill).
 * - Loss → red / danger.
 * - £0.0 → muted text without a tinted background, since neither
 *   "good" nor "bad" applies to a wash trade.
 */
function BankDeltaPill({ costChange }: { costChange: number }) {
  const styles = useThemedStyles(makeStyles);
  const bankDelta = -costChange / 10;
  const text =
    bankDelta === 0
      ? '£0.0'
      : `${bankDelta > 0 ? '+' : '−'}£${Math.abs(bankDelta).toFixed(1)}m`;
  if (bankDelta === 0) {
    return <Text style={styles.bankDeltaNeutral}>{text}</Text>;
  }
  const positive = bankDelta > 0;
  return (
    <View
      style={[
        styles.bankDeltaPill,
        positive ? styles.bankDeltaPillPositive : styles.bankDeltaPillNegative,
      ]}
    >
      <Text
        style={[
          styles.bankDeltaPillText,
          positive
            ? styles.bankDeltaPillTextPositive
            : styles.bankDeltaPillTextNegative,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

/** Small red pill showing the −N point hit cost on a multi-transfer
 *  bundle. Only rendered when ``hit_cost > 0``; the absence of the
 *  pill is the "no hit" signal. */
function HitPill({ hitCost }: { hitCost: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.bankDeltaPill, styles.bankDeltaPillNegative]}>
      <Text style={[styles.bankDeltaPillText, styles.bankDeltaPillTextNegative]}>
        −{hitCost} pts
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Expanded comparison table
// ---------------------------------------------------------------------------

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
      {team ? (
        <ClubBackground teamShort={team} mirror={align === 'right'} />
      ) : null}
      <View style={styles.playerTextBackdrop}>
        <Text style={styles.playerName} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={styles.playerTextBackdrop}>
        <Text style={styles.playerSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
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
  const styles = useThemedStyles(makeStyles);

  const xpStr = `${deltaXp >= 0 ? '+' : ''}${deltaXp.toFixed(1)} xP`;
  const positive = deltaXp >= 0;  // 0.0 ties to positive (matches "+0.0" sign)

  return (
    <View style={styles.center}>
      <View style={styles.arrowRow}>
        <Text style={styles.arrowText}>→</Text>
      </View>
      {/* xP delta pill is sign-coloured: sage for positive moves, red
          for negative. Mostly the bundle-net positives, but per-move
          deltas inside a multi-move bundle can go negative — the pill
          colour gives that move's contribution at a glance. */}
      <View
        style={[
          styles.deltaXpPill,
          positive ? styles.deltaXpPillPositive : styles.deltaXpPillNegative,
        ]}
      >
        <Text
          style={[
            styles.deltaXpPillText,
            positive
              ? styles.deltaXpPillTextPositive
              : styles.deltaXpPillTextNegative,
          ]}
        >
          {xpStr}
        </Text>
      </View>
      <BankDeltaPill costChange={costChange} />
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
      padding: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xxl,
    },

    // Horizon chips on the left, filter button on the right.
    controlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    horizonGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    filterButton: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    filterButtonActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    filterButtonPressed: effects.pressedSubtle,
    filterButtonText: {
      fontSize: fontSize.sm2,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    filterButtonTextActive: {
      color: colors.onAccent,
    },
    horizonChip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    horizonChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    horizonChipPressed: effects.pressedSubtle,
    horizonChipText: {
      fontSize: fontSize.sm2,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    horizonChipTextActive: {
      color: colors.onAccent,
    },

    // List header (above the cards).
    header: {
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    headerLine: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    headerSub: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    // FH note: small but visually distinct so the user sees that
    // suggestions are computed against the persistent squad, not the
    // FH eleven. Mirrors the louder banner on the My Team screen but
    // doesn't need the warning treatment because suggestions are still
    // actionable in this state. ``onWarning`` (matches My Team's
    // ChipBanner) keeps the text dark against the light-yellow
    // warning bg in both light and dark mode — without this dark-mode
    // text was white-on-yellow and unreadable.
    headerFreehitNote: {
      fontSize: fontSize.sm,
      color: colors.onWarning,
      backgroundColor: colors.warning,
      marginTop: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      lineHeight: 16,
    },

    // Card.
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginVertical: spacing.sm,
    },
    // 0.85 is a softer "card-press" dim than effects.pressed (0.5) — the
    // expanded card stays mostly opaque so a tap reads as "expand", not
    // "depressed button". Single use.
    cardPressed: { opacity: 0.85 },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // Multi-move bundles stack moves vertically; this divider separates them.
    moveDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.md,
    },
    // Bundle-level summary above the move stack: net delta xP + hit detail.
    bundleSummary: {
      paddingBottom: spacing.md,
      marginBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // Bundle-level net xP pill. Same sign-coloured visual language as
    // the per-move CenterBadge, sized up so the bundle headline reads
    // as the dominant element on the card.
    bundleSummaryNetPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.base,
      // 3px sits between spacing.hairline (2) and spacing.xs (4); the
      // pill needs that hairline of extra height to balance the 16px
      // text without becoming a full button.
      paddingVertical: 3,
      borderRadius: 12,
    },
    bundleSummaryNetPillPositive: { backgroundColor: colors.accentSoft },
    bundleSummaryNetPillNegative: { backgroundColor: colors.danger },
    bundleSummaryNetPillText: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    bundleSummaryNetPillTextPositive: { color: colors.onAccentSoft },
    bundleSummaryNetPillTextNegative: { color: colors.onDanger },
    // Detail row holds the bank + (optional) hit pills inline below
    // the net-xP pill. Centered alignment keeps the small pills
    // baseline-matched.
    bundleSummaryDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
      flexWrap: 'wrap',
    },
    // Per-move heading inside the expanded compare section, only shown
    // for multi-move bundles so the user knows which compare table goes
    // with which move.
    compareMoveLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textMuted,
      marginTop: spacing.md,
      marginBottom: spacing.hairline,
    },
    chevronRow: {
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    chevron: {
      fontSize: fontSize.md,
      color: colors.textMuted,
    },

    // Expanded comparison table (#97). Sits below the main row when the
    // user taps to expand. Three columns: metric label / out value / in
    // value. Values are right-aligned; cells with a fixture-quality tone
    // tint background + text on the sage/warning/danger scale.
    compareTable: {
      marginTop: spacing.xs,
    },
    compareDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginBottom: spacing.md,
    },
    compareRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    compareLabel: {
      flex: 2,
      fontSize: fontSize.sm2,
      color: colors.textMuted,
    },
    compareCell: {
      flex: 1,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      alignItems: 'center',
      marginHorizontal: spacing.hairline,
    },
    compareCellText: {
      fontSize: fontSize.md,
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
    toneTextMid: { color: colors.onWarning },
    toneTextBad: { color: colors.onDanger },
    toneTextNeutral: { color: colors.textPrimary },
    playerBlock: {
      flex: 1,
      minWidth: 0, // lets numberOfLines + flex work together correctly
    },
    playerBlockLeft: {
      alignItems: 'flex-start',
      paddingRight: spacing.md,
    },
    playerBlockRight: {
      alignItems: 'flex-end',
      paddingLeft: spacing.md,
    },
    playerName: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    playerSub: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    // Surface-coloured halo behind the name + subtitle text on each
    // PlayerBlock. ``alignSelf: auto`` lets each backdrop inherit the
    // parent block's ``alignItems`` (flex-start for the left block,
    // flex-end for the right one) so the backdrop hugs the text on
    // whichever side the text aligns to. Invisible where the gradient
    // has faded to surface.
    playerTextBackdrop: {
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.xs,
      // 3px is a tight chip halo; below the named scale on purpose.
      borderRadius: 3,
    },

    // Center column: arrow + delta xp + bank delta.
    center: {
      minWidth: 80,
      alignItems: 'center',
    },
    arrowRow: {
      marginBottom: spacing.hairline,
    },
    arrowText: {
      fontSize: fontSize.lg,
      color: colors.textMuted,
    },
    deltaXpPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.hairline,
      borderRadius: radius.base,
    },
    deltaXpPillPositive: { backgroundColor: colors.accentSoft },
    deltaXpPillNegative: { backgroundColor: colors.danger },
    deltaXpPillText: {
      fontSize: fontSize.sm2,
      fontWeight: '700',
    },
    deltaXpPillTextPositive: { color: colors.onAccentSoft },
    deltaXpPillTextNegative: { color: colors.onDanger },
    // Bank-delta pill (used by both CenterBadge and BundleSummary) and
    // the matching hit pill. Smaller than the xP delta so the headline
    // pill stays the dominant visual element.
    bankDeltaPill: {
      paddingHorizontal: spacing.sm,
      // 1px is a tight one-off bank-pill height — below the named
      // spacing scale.
      paddingVertical: 1,
      borderRadius: radius.md,
      marginTop: spacing.hairline,
    },
    bankDeltaPillPositive: { backgroundColor: colors.accentSoft },
    bankDeltaPillNegative: { backgroundColor: colors.danger },
    bankDeltaPillText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    bankDeltaPillTextPositive: { color: colors.onAccentSoft },
    bankDeltaPillTextNegative: { color: colors.onDanger },
    // Wash trade — neutral muted text instead of a pill. Avoids slapping
    // a green/red verdict on a no-bank-impact swap.
    bankDeltaNeutral: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
      marginTop: spacing.hairline,
      fontVariant: ['tabular-nums'],
    },

    // Empty / message states.
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xxxl,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.md,
    },
    emptyBody: {
      fontSize: fontSize.md,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.xl,
    },
    primaryBtn: {
      paddingHorizontal: spacing.xl2,
      paddingVertical: spacing.base,
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
    },
    primaryBtnText: {
      color: colors.onAccent,
      fontWeight: '600',
    },
    // 0.7 is a softer pressed-state for empty-state primary actions —
    // they're rarely tapped so a gentler dim feels right. One use.
    pressed: {
      opacity: 0.7,
    },
  });
