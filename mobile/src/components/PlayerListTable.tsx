/**
 * Two-axis scrollable table used by both Players and My Team.
 *
 * Layout shape:
 *
 *     ┌───────────────┬───────────────────────────────────────┐
 *     │ Player        │ xP ↓  Defcon  Form  Price  ...        │  ← column header
 *     ├───────────────┼───────────────────────────────────────┤
 *     │ Saka          │  6.4    62     5.2   £9.5  ...        │
 *     │ Haaland       │  7.1    18     7.5  £15.2  ...        │
 *     │  ...          │  ...                                  │
 *     └───────────────┴───────────────────────────────────────┘
 *      (frozen)         (horizontally scrollable)
 *
 * - The leftmost "Player" column is **frozen** to the left edge — it never
 *   moves horizontally so the user always knows whose row they're reading.
 * - The data column header and the data cells share a single horizontal
 *   ScrollView, so they always agree on horizontal offset.
 * - Two vertical FlatLists (left: name cells, right: data cells) are kept
 *   in vertical sync via onScroll → scrollToOffset on the other. A
 *   sync-direction ref guards against the feedback loop that would
 *   otherwise occur when `scrollToOffset` itself fires `onScroll` on the
 *   target list.
 *
 * RefreshControl lives on the **left** FlatList. The right list intentionally
 *   doesn't carry one — the spinner would render twice otherwise. Users
 *   will most often pull from the name column anyway.
 */
import { useCallback, useRef } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FIELD_DEFS } from '../players/fields';
import type { FieldKey, JoinedPlayer, SortState } from '../players/types';
import { colors } from '../theme';

/** Per-data-cell width. Wide enough for the longest short label
 *  (`Defcon/90 ↓`) plus comfortable padding on both sides. */
const CELL_WIDTH = 72;
/** Pinned name column width. Fits the longest realistic web_name
 *  (e.g. `Bruno Fernandes`) plus the team · pos sub-line on a second
 *  line, plus C/V badge inline. */
const NAME_WIDTH = 168;
/** Fixed row height — enables `getItemLayout` for predictable
 *  scroll-to-offset and lets the two FlatLists stay in lockstep
 *  even on first render before measurement. */
const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 40;

type Props<T extends JoinedPlayer> = {
  data: readonly T[];
  columns: FieldKey[];
  sort: SortState;
  onTapHeader: (key: FieldKey) => void;
  /** Stable id for FlatList keying. */
  getId: (item: T) => string | number;
  /** Renders the contents of the pinned name column for a single row.
   *  Each screen owns its own decorations: Players just shows name +
   *  team · pos; My Team adds captain/vice badges, bench dim, GW pts. */
  renderNameCell: (item: T) => React.ReactNode;
  /** Optional per-row style override applied to BOTH the left and right
   *  row containers (used by My Team for bench dimming). */
  getRowStyle?: (item: T) => { opacity?: number } | undefined;
  refreshing?: boolean;
  onRefresh?: () => void;
  emptyMessage: string;
};

export function PlayerListTable<T extends JoinedPlayer>({
  data,
  columns,
  sort,
  onTapHeader,
  getId,
  renderNameCell,
  getRowStyle,
  refreshing,
  onRefresh,
  emptyMessage,
}: Props<T>) {
  const leftRef = useRef<FlatList<T>>(null);
  const rightRef = useRef<FlatList<T>>(null);
  // Tracks which list is currently being driven by the other, so the
  // driven list's onScroll doesn't bounce back and create a feedback
  // loop. Cleared on the next driven onScroll event.
  const syncing = useRef<'left' | 'right' | null>(null);

  const onLeftScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (syncing.current === 'left') {
        syncing.current = null;
        return;
      }
      syncing.current = 'right';
      rightRef.current?.scrollToOffset({
        offset: e.nativeEvent.contentOffset.y,
        animated: false,
      });
    },
    [],
  );
  const onRightScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (syncing.current === 'right') {
        syncing.current = null;
        return;
      }
      syncing.current = 'left';
      leftRef.current?.scrollToOffset({
        offset: e.nativeEvent.contentOffset.y,
        animated: false,
      });
    },
    [],
  );

  const dataWidth = columns.length * CELL_WIDTH;

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const renderRightRow = useCallback(
    ({ item }: { item: T }) => {
      const rowStyle = getRowStyle?.(item);
      return (
        <View style={[styles.rightRow, { width: dataWidth }, rowStyle]}>
          {columns.map((c) => {
            const def = FIELD_DEFS[c];
            const value = def.accessor(item);
            return (
              <Text
                key={c}
                style={styles.dataCell}
                numberOfLines={1}
              >
                {def.format(value)}
              </Text>
            );
          })}
        </View>
      );
    },
    [columns, dataWidth, getRowStyle],
  );

  const renderLeftRow = useCallback(
    ({ item }: { item: T }) => {
      const rowStyle = getRowStyle?.(item);
      return (
        <View style={[styles.leftRow, rowStyle]}>{renderNameCell(item)}</View>
      );
    },
    [renderNameCell, getRowStyle],
  );

  return (
    <View style={styles.container}>
      {/* LEFT: pinned name column (header + vertical FlatList). */}
      <View style={styles.leftColumn}>
        <View style={styles.leftHeaderCell}>
          <Text style={styles.headerCellText}>Player</Text>
        </View>
        <FlatList
          ref={leftRef}
          data={data as T[]}
          keyExtractor={(item) => String(getId(item))}
          renderItem={renderLeftRow}
          getItemLayout={getItemLayout}
          onScroll={onLeftScroll}
          scrollEventThrottle={16}
          refreshControl={
            onRefresh != null ? (
              <RefreshControl
                refreshing={refreshing ?? false}
                onRefresh={onRefresh}
              />
            ) : undefined
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>{emptyMessage}</Text>
          }
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* RIGHT: horizontal ScrollView wraps the data column header AND
          the right vertical FlatList — both live inside the same scroll
          viewport, so horizontal offset is shared automatically.
          `flexGrow: 1` on contentContainerStyle is what gives the inner
          View a bounded height so the nested FlatList can virtualize. */}
      <ScrollView
        horizontal
        style={styles.rightScroll}
        contentContainerStyle={styles.rightScrollContent}
        showsHorizontalScrollIndicator={true}
      >
        <View style={{ width: dataWidth, flex: 1 }}>
          <View style={[styles.rightHeaderRow, { width: dataWidth }]}>
            {columns.map((c) => {
              const def = FIELD_DEFS[c];
              const active = sort.field === c;
              const arrow = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
              return (
                <Pressable
                  key={c}
                  onPress={() => onTapHeader(c)}
                  style={({ pressed }) => [
                    styles.headerCell,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.headerCellText,
                      active && styles.headerCellTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {def.shortLabel}
                    {arrow}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <FlatList
            ref={rightRef}
            data={data as T[]}
            keyExtractor={(item) => String(getId(item))}
            renderItem={renderRightRow}
            getItemLayout={getItemLayout}
            onScroll={onRightScroll}
            scrollEventThrottle={16}
            // No RefreshControl here — see file header comment.
            showsVerticalScrollIndicator={true}
            style={{ width: dataWidth, flex: 1 }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },

  // LEFT side
  leftColumn: {
    width: NAME_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    backgroundColor: colors.background,
  },
  leftHeaderCell: {
    height: HEADER_HEIGHT,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  leftRow: {
    height: ROW_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  // RIGHT side
  rightScroll: { flex: 1 },
  rightScrollContent: { flexGrow: 1 },
  rightHeaderRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rightRow: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCell: {
    width: CELL_WIDTH,
    paddingHorizontal: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerCellText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  headerCellTextActive: { color: colors.accent },
  dataCell: {
    width: CELL_WIDTH,
    paddingHorizontal: 8,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  pressed: { opacity: 0.6 },

  emptyText: {
    padding: 24,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
