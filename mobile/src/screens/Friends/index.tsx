import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ClubShirt, CLUB_SHIRT_SIZE } from '../../components/ClubShirt';
import { indexUpcomingFixtures } from '../../fixtures/upcoming';
import { EntryNotFoundError, type Entry } from '../../api/entry';
import { getFriends, type Friend } from '../../storage/friends';
import {
  useParallelQueries,
  type ParallelFetchRowState,
} from '../../hooks/useParallelQueries';
import { entryQuery, fixturesUpcomingQuery } from '../../query/queries';
import { FriendsHero } from './Hero';
import { awardsByTeam, type AwardKind, type LoadedTeam } from './summary';
import { useFocusedTeamId } from '../../hooks/useFocusedTeamId';
import { HeaderButton } from '../../components/HeaderButton';
import { HelpButton } from '../../help/HelpButton';
import { HEADER_EDGE_INSET } from '../../navigation/stacks/headerOptions';
import { LoadingView } from '../../components/LoadingView';
import { PullToRefresh } from '../../components/PullToRefresh';
import { formatInt, formatRank } from '../../format/rank';
import type { FriendsScreenProps } from '../../navigation/types';
import {
  effects,
  fontRole,
  fontSize,
  heatColor,
  HEAT_CEILING,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../../theme';

type Props = FriendsScreenProps;

type Target = {
  id: string;
  alias: string;
  isMe: boolean;
};

type ComparisonRow = {
  target: Target;
  state: ParallelFetchRowState<Entry>;
};

/** The column header rides along as the list's first item so it can
 *  stick under the hero as the table scrolls. */
const TABLE_HEADER = 'tableHeader' as const;
type ListItem = typeof TABLE_HEADER | ComparisonRow;
/** Index 0 is the hero (the list header), so the column header is 1. */
const STICKY_TABLE_HEADER_INDEX = 1;

type SortColumn = 'rank' | 'gw' | 'total';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortColumn; label: string; defaultDir: SortDir }[] = [
  { key: 'rank', label: 'Rank', defaultDir: 'asc' },
  { key: 'gw', label: 'GW', defaultDir: 'desc' },
  { key: 'total', label: 'Total', defaultDir: 'desc' },
];

export default function FriendsScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);

  const teamId = useFocusedTeamId();
  // `null` = haven't finished reading friends list yet.
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <HelpButton topic="friends" />
          <HeaderButton
            label="Manage"
            onPress={() => navigation.navigate('ManageFriends')}
          />
        </View>
      ),
    });
  }, [navigation, styles]);

  // Re-read the friends list every time the screen gains focus so a
  // friend added on Manage shows up on return.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getFriends().then((fs) => {
        if (alive) setFriends(fs);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const targets = useMemo<Target[] | null>(() => {
    if (teamId === undefined || friends === null) return null;
    const out: Target[] = [];
    if (teamId) out.push({ id: teamId, alias: 'You', isMe: true });
    for (const f of friends) {
      // Dedupe: if the user added their own team as a friend, skip the dup.
      if (teamId && f.id === teamId) continue;
      out.push({ id: f.id, alias: f.alias, isMe: false });
    }
    return out;
  }, [teamId, friends]);

  const targetIds = useMemo(() => (targets ?? []).map((t) => t.id), [targets]);
  const {
    rows: fetchedRows,
    refreshing,
    onRefresh,
    onRetry,
  } = useParallelQueries(targetIds, entryQuery);

  // Join the per-key fetch state back to the target metadata. If the
  // hook hasn't caught up to a new targets array yet, fall back to a
  // synthesized loading row so the table doesn't briefly render
  // mismatched aliases/ids.
  const rows = useMemo<ComparisonRow[]>(() => {
    const t = targets ?? [];
    const byId = new Map(fetchedRows.map((r) => [r.key, r.state] as const));
    return t.map((target): ComparisonRow => {
      const state = byId.get(target.id);
      if (state?.status === 'ok') {
        return { target, state: { status: 'ok', data: state.data.entry } };
      }
      return { target, state: state ?? { status: 'loading' } };
    });
  }, [targets, fetchedRows]);

  function onHeaderPress(col: SortColumn) {
    if (col === sortColumn) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(col);
      const column = COLUMNS.find((c) => c.key === col);
      setSortDir(column?.defaultDir ?? 'desc');
    }
  }

  const sortedRows = useMemo(
    () => sortRows(rows, sortColumn, sortDir),
    [rows, sortColumn, sortDir],
  );
  const listItems = useMemo<ListItem[]>(
    () => [TABLE_HEADER, ...sortedRows],
    [sortedRows],
  );

  const loadedTeams = useMemo<LoadedTeam[]>(
    () =>
      rows.flatMap((row) =>
        row.state.status === 'ok'
          ? [{ id: row.target.id, isMe: row.target.isMe, entry: row.state.data }]
          : [],
      ),
    [rows],
  );
  const awards = useMemo(() => awardsByTeam(loadedTeams), [loadedTeams]);
  const gameweek = loadedTeams.find((t) => t.entry.current_event != null)?.entry
    .current_event;

  // Favourite clubs arrive as FPL ids; the fixtures response carries the
  // id → club mapping. Until it loads, rows simply show no shirt.
  const fixturesResp = useQuery(fixturesUpcomingQuery()).data;
  const clubShortNameById = useMemo(
    () => (fixturesResp ? indexUpcomingFixtures(fixturesResp).clubShortNameById : null),
    [fixturesResp],
  );
  const favouriteClub = useCallback(
    (entry: Entry) =>
      entry.favourite_team == null
        ? null
        : (clubShortNameById?.get(entry.favourite_team) ?? null),
    [clubShortNameById],
  );

  if (targets === null) return <LoadingView />;

  if (targets.length === 0) {
    return (
      <EmptyState
        onAddFriend={() => navigation.navigate('AddFriend')}
        // Settings lives on a sibling tab — go via the parent tab
        // navigator rather than trying to navigate within Friends stack.
        onOpenSettings={() => navigation.getParent()?.navigate('SettingsTab')}
      />
    );
  }

  return (
    <FlatList
      data={listItems}
      keyExtractor={(item) => (item === TABLE_HEADER ? TABLE_HEADER : item.target.id)}
      renderItem={({ item }) =>
        item === TABLE_HEADER ? (
          <TableHeader
            sortColumn={sortColumn}
            sortDir={sortDir}
            onHeaderPress={onHeaderPress}
          />
        ) : (
          <Row
            row={item}
            club={item.state.status === 'ok' ? favouriteClub(item.state.data) : null}
            awards={awards.get(item.target.id)}
            onRetry={onRetry}
            onOpenTeam={(teamId, name) =>
              navigation.navigate('FriendTeam', { teamId, name })
            }
          />
        )
      }
      ListHeaderComponent={
        <FriendsHero
          teams={loadedTeams}
          gameweek={gameweek ?? null}
          favouriteClub={favouriteClub}
        />
      }
      ListFooterComponent={
        friends?.length === 0 ? (
          <InviteFriends
            onAddFriend={() => navigation.navigate('AddFriend')}
            onImportLeague={() => navigation.navigate('ImportLeague')}
          />
        ) : null
      }
      contentContainerStyle={styles.listContent}
      stickyHeaderIndices={[STICKY_TABLE_HEADER_INDEX]}
      refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

// ---- sort -------------------------------------------------------------------

function sortRows(
  rows: ComparisonRow[],
  column: SortColumn,
  dir: SortDir,
): ComparisonRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    // Errors / nulls always sink to the bottom regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.target.alias.localeCompare(b.target.alias);
    return av < bv ? -1 * mul : 1 * mul;
  });
}

function sortValue(row: ComparisonRow, column: SortColumn): number | null {
  if (row.state.status !== 'ok') return null;
  const d = row.state.data;
  if (column === 'rank') return d.summary_overall_rank;
  if (column === 'gw') return d.summary_event_points;
  return d.summary_overall_points;
}

// ---- components -------------------------------------------------------------

function EmptyState({
  onAddFriend,
  onOpenSettings,
}: {
  onAddFriend: () => void;
  onOpenSettings: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>Nothing to compare yet</Text>
      <Text style={styles.emptyBody}>
        Add your FPL team ID in Settings, then add some friends to start comparing scores
        and ranks.
      </Text>
      <Pressable
        onPress={onAddFriend}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Add a friend</Text>
      </Pressable>
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryBtnText}>Set your team ID</Text>
      </Pressable>
    </View>
  );
}

/** Shown under the user's own row until they've added anyone, so the
 *  tab explains itself instead of showing a one-row table. */
const BODY_LINE_HEIGHT = 22;
const GHOST_ROW_CLUBS = ['ARS', 'LIV', 'NEW'] as const;
const GHOST_BAR_HEIGHT = 9;
const GHOST_VALUE_WIDTH = 34;
const GHOST_ROWS_OPACITY = 0.55;

function InviteFriends({
  onAddFriend,
  onImportLeague,
}: {
  onAddFriend: () => void;
  onImportLeague: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.inviteWrap}>
      <Text style={styles.inviteTitle}>Compare with everyone you know in FPL</Text>
      <Text style={styles.inviteBody}>
        Add friends from any of your leagues, or import a whole mini-league at once.
        You&apos;ll see who topped the week, whose rank is best, and how you stack up.
      </Text>
      {/* Faded placeholder rows hint at the table this will become. */}
      <View style={styles.ghostRows}>
        {GHOST_ROW_CLUBS.map((club) => (
          <View key={club} style={styles.ghostRow}>
            <ClubShirt teamShort={club} size={CLUB_SHIRT_SIZE.listRow} />
            <View style={styles.ghostName} />
            <View style={styles.ghostValue} />
          </View>
        ))}
      </View>
      <Pressable
        onPress={onImportLeague}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Import a league</Text>
      </Pressable>
      <Pressable
        onPress={onAddFriend}
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryBtnText}>Add one friend</Text>
      </Pressable>
    </View>
  );
}

function TableHeader({
  sortColumn,
  sortDir,
  onHeaderPress,
}: {
  sortColumn: SortColumn;
  sortDir: SortDir;
  onHeaderPress: (col: SortColumn) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.tableHeader}>
      <Text style={[styles.colHeader, styles.colAlias]}>Team</Text>
      {COLUMNS.map((c) => (
        <ColumnHeaderButton
          key={c.key}
          label={c.label}
          active={sortColumn === c.key}
          direction={sortColumn === c.key ? sortDir : null}
          onPress={() => onHeaderPress(c.key)}
        />
      ))}
    </View>
  );
}

function ColumnHeaderButton({
  label,
  active,
  direction,
  onPress,
}: {
  label: string;
  active: boolean;
  direction: SortDir | null;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const arrow = direction === 'asc' ? ' ↑' : direction === 'desc' ? ' ↓' : '';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.colHeaderBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
    >
      <Text
        style={[styles.colHeader, styles.colNumeric, active && styles.colHeaderActive]}
      >
        {label}
        {arrow}
      </Text>
    </Pressable>
  );
}

function Row({
  row,
  club,
  awards,
  onRetry,
  onOpenTeam,
}: {
  row: ComparisonRow;
  /** The manager's favourite club, drawn as a shirt by the name. */
  club: string | null;
  awards: readonly AwardKind[] | undefined;
  onRetry: (teamId: string) => void;
  onOpenTeam: (teamId: string, name: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  const { target, state } = row;
  const action = rowAction(state);
  const onPress =
    action === 'open'
      ? () => onOpenTeam(target.id, displayAlias(row))
      : action === 'retry'
        ? () => onRetry(target.id)
        : undefined;
  const aliasBadge = target.isMe ? (
    <View style={styles.youBadge} accessibilityLabel="You">
      <Text style={styles.youBadgeText}>You</Text>
    </View>
  ) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={action === null}
      style={({ pressed }) => [
        styles.row,
        target.isMe && styles.rowMe,
        pressed && styles.pressed,
      ]}
      accessibilityRole={action ? 'button' : undefined}
      accessibilityHint={action ? ROW_ACTION_HINTS[action] : undefined}
    >
      <View style={styles.colAlias}>
        {/* An empty slot keeps names aligned when a manager has no
            favourite club. */}
        {club ? (
          <ClubShirt teamShort={club} size={CLUB_SHIRT_SIZE.listRow} />
        ) : (
          <View style={styles.shirtSlot} />
        )}
        <View style={styles.aliasText}>
          <View style={styles.aliasLine}>
            <Text style={styles.rowAlias} numberOfLines={1}>
              {displayAlias(row)}
            </Text>
            {aliasBadge}
          </View>
          {awards && awards.length > 0 && state.status === 'ok' ? (
            <AwardTags awards={awards} />
          ) : (
            <RowSubtext state={state} teamId={target.id} />
          )}
        </View>
      </View>
      <CellValue state={state} field="rank" />
      <CellValue state={state} field="gw" />
      <CellValue state={state} field="total" />
    </Pressable>
  );
}

type RowAction = 'open' | 'retry';

const ROW_ACTION_HINTS: Record<RowAction, string> = {
  open: 'Shows this squad',
  retry: 'Retries loading this team',
};

/** Loaded rows open the squad; failed rows retry, except a missing team,
 *  which won't appear on retry. Loading rows do nothing. */
function rowAction(state: ParallelFetchRowState<Entry>): RowAction | null {
  if (state.status === 'ok') return 'open';
  if (state.status === 'error' && !(state.error instanceof EntryNotFoundError)) {
    return 'retry';
  }
  return null;
}

function displayAlias(row: ComparisonRow): string {
  // Use the live squad name from FPL once it loads — squad names change
  // during the season, and stale aliases set at import time become hard
  // to recognise. The user-set alias is kept as the fallback for in-flight
  // / failed fetches and stays canonical on the Manage list.
  if (row.state.status === 'ok') return row.state.data.name;
  if (row.target.isMe) return 'Your team';
  return row.target.alias;
}

function RowSubtext({
  state,
  teamId,
}: {
  state: ParallelFetchRowState<Entry>;
  teamId: string;
}) {
  const styles = useThemedStyles(makeStyles);

  if (state.status === 'error') {
    const notFound = state.error instanceof EntryNotFoundError;
    return (
      <Text style={styles.rowError}>
        {notFound ? 'Team not found' : "Couldn't load · tap to retry"}
      </Text>
    );
  }
  // Manager name as the secondary line — stable across the season even
  // when the squad name above changes. Falls back to team ID while the
  // entry fetch is in flight so the row never looks empty.
  if (state.status === 'ok') {
    const { player_first_name, player_last_name } = state.data;
    const managerName = `${player_first_name} ${player_last_name}`.trim();
    if (managerName) {
      return <Text style={styles.rowMeta}>{managerName}</Text>;
    }
  }
  return <Text style={styles.rowMeta}>Team ID {teamId}</Text>;
}

function CellValue({
  state,
  field,
}: {
  state: ParallelFetchRowState<Entry>;
  field: SortColumn;
}) {
  const styles = useThemedStyles(makeStyles);

  if (state.status !== 'ok') {
    return <Text style={[styles.rowCell, styles.colNumeric]}>—</Text>;
  }
  const d = state.data;
  if (field === 'gw' && d.summary_event_points != null) {
    return <GameweekPoints points={d.summary_event_points} />;
  }
  const value =
    field === 'rank'
      ? formatRank(d.summary_overall_rank)
      : field === 'gw'
        ? formatInt(d.summary_event_points)
        : formatInt(d.summary_overall_points);
  return <Text style={[styles.rowCell, styles.colNumeric]}>{value}</Text>;
}

function GameweekPoints({ points }: { points: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const heat = heatColor(points, HEAT_CEILING.teamPoints, colors);
  return (
    <View style={styles.colNumeric}>
      <Text
        style={[styles.heatPill, { backgroundColor: heat.background, color: heat.text }]}
      >
        {formatInt(points)}
      </Text>
    </View>
  );
}

const AWARD_LABELS: Record<AwardKind, string> = {
  topGameweek: 'Top GW',
  bestRank: 'Best rank',
  biggestSquad: 'Biggest squad',
  mostTransfers: 'Most transfers',
  fewestTransfers: 'Fewest transfers',
};

/** Tags that replace the manager line on a standout's row. They sit on
 *  one line; on a narrow screen the later ones are clipped. */
function AwardTags({ awards }: { awards: readonly AwardKind[] }) {
  const styles = useThemedStyles(makeStyles);
  const toneStyle = (kind: AwardKind) =>
    kind === 'topGameweek'
      ? styles.awardTop
      : kind === 'bestRank'
        ? styles.awardRank
        : styles.awardPlain;
  const textStyle = (kind: AwardKind) =>
    kind === 'topGameweek'
      ? styles.awardTopText
      : kind === 'bestRank'
        ? styles.awardRankText
        : styles.awardPlainText;
  return (
    <View style={styles.awards}>
      {awards.map((kind) => (
        <View key={kind} style={[styles.award, toneStyle(kind)]}>
          <Text style={[styles.awardText, textStyle(kind)]} numberOfLines={1}>
            {AWARD_LABELS[kind]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const COL_NUMERIC_WIDTH = 62;
// Small uppercase tags need a little tracking to stay legible.
const TAG_LETTER_SPACING = 0.5;
// A one-off below the type scale so two tags fit beside each other.
const TAG_FONT_SIZE = 10;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingEnd: HEADER_EDGE_INSET,
    },
    listContent: { paddingBottom: spacing.xxxl, backgroundColor: colors.background },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxxl,
      gap: spacing.lg,
      backgroundColor: colors.background,
    },
    inviteWrap: {
      margin: spacing.lg,
      padding: spacing.xl,
      gap: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    inviteTitle: {
      ...fontRole.display,
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    inviteBody: { color: colors.textMuted, lineHeight: BODY_LINE_HEIGHT },
    ghostRows: { gap: spacing.sm, opacity: GHOST_ROWS_OPACITY },
    ghostRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    ghostName: {
      flex: 1,
      height: GHOST_BAR_HEIGHT,
      borderRadius: GHOST_BAR_HEIGHT / 2,
      backgroundColor: colors.surfaceRaised,
    },
    ghostValue: {
      width: GHOST_VALUE_WIDTH,
      height: GHOST_BAR_HEIGHT,
      borderRadius: GHOST_BAR_HEIGHT / 2,
      backgroundColor: colors.surfaceRaised,
    },
    emptyTitle: {
      ...fontRole.display,
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    emptyBody: {
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: BODY_LINE_HEIGHT,
    },
    primaryBtn: {
      alignItems: 'center',
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      backgroundColor: colors.accent,
    },
    primaryBtnText: {
      color: colors.onAccent,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    secondaryBtn: {
      alignItems: 'center',
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    pressed: effects.pressed,
    tableHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.base,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    colHeader: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    colHeaderActive: { color: colors.accentText },
    colHeaderBtn: { width: COL_NUMERIC_WIDTH, paddingVertical: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xl,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowMe: { backgroundColor: colors.accentSoft },
    colAlias: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingRight: spacing.md,
    },
    shirtSlot: { width: CLUB_SHIRT_SIZE.listRow },
    aliasText: { flex: 1, minWidth: 0 },
    aliasLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowAlias: {
      flexShrink: 1,
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    rowMeta: {
      marginTop: spacing.hairline,
      color: colors.textMuted,
      fontSize: fontSize.sm,
      ...fontRole.numeric,
    },
    rowError: {
      marginTop: spacing.hairline,
      color: colors.badText,
      fontSize: fontSize.sm,
    },
    colNumeric: {
      width: COL_NUMERIC_WIDTH,
      textAlign: 'right',
      ...fontRole.numeric,
    },
    rowCell: { color: colors.textPrimary, fontSize: fontSize.md },
    heatPill: {
      ...fontRole.numeric,
      alignSelf: 'flex-end',
      minWidth: COL_NUMERIC_WIDTH - spacing.lg,
      paddingVertical: spacing.hairline,
      borderRadius: radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    awards: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: spacing.hairline,
      overflow: 'hidden',
    },
    award: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.hairline,
      borderRadius: radius.lg,
    },
    awardText: {
      fontSize: TAG_FONT_SIZE,
      fontWeight: '800',
      letterSpacing: TAG_LETTER_SPACING,
      textTransform: 'uppercase',
    },
    awardTop: { backgroundColor: colors.good },
    awardTopText: { color: colors.onGood },
    awardRank: { backgroundColor: colors.accentSoft },
    awardRankText: { color: colors.accentText },
    awardPlain: { backgroundColor: colors.surfaceRaised },
    awardPlainText: { color: colors.textMuted },
    youBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.hairline,
      borderRadius: radius.base,
      backgroundColor: colors.accent,
    },
    youBadgeText: {
      color: colors.onAccent,
      fontSize: fontSize.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });
