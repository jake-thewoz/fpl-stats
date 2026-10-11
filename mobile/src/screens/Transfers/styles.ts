import { StyleSheet } from 'react-native';
import {
  effects,
  fontRole,
  fontSize,
  mixHex,
  radius,
  spacing,
  type Colors,
} from '../../theme';

// Headline net-xP size: between the screen title and the hero score.
const NET_XP_FONT_SIZE = 28;
// How far each tint moves from the card surface toward mint or coral.
const TILE_TINT = 0.15;
const CHIP_TINT = 0.2;
const TOP_RANKED_BORDER_MIX = 0.55;
// Fits "+11.1" over "−£1.6m" without squeezing the player tiles.
const MOVE_DELTA_MIN_WIDTH = 52;

/**
 * Shared makeStyles for every component in the Transfers folder.
 *
 * Co-locating styles with the screen pays for itself here — the cross-
 * references between cards, pills, and the compare table are dense and
 * splitting them per-component would force every padding tweak to span
 * multiple files.
 */
export const makeStyles = (colors: Colors) =>
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
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    horizonGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    horizonChip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceRaised,
    },
    horizonChipActive: { backgroundColor: colors.accent },
    horizonChipPressed: effects.pressedSubtle,
    horizonChipText: {
      fontSize: fontSize.sm2,
      color: colors.textMuted,
      fontWeight: '700',
    },
    horizonChipTextActive: { color: colors.onAccent },

    // Wraps a SegmentedControl inside a filter-dialog Section body.
    dialogControlBody: {
      flexDirection: 'row',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
    },

    // List header (above the cards).
    header: {
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    headerLine: {
      fontSize: fontSize.base,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    headerSub: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    headerHint: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.sm,
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
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginVertical: spacing.sm,
      gap: spacing.md,
    },
    cardTopRanked: {
      borderColor: mixHex(colors.surface, colors.good, TOP_RANKED_BORDER_MIX),
    },
    // 0.85 is a softer "card-press" dim than effects.pressed (0.5) — the
    // expanded card stays mostly opaque so a tap reads as "expand", not
    // "depressed button". Single use.
    cardPressed: { opacity: 0.85 },
    goodText: { color: colors.goodText },
    badText: { color: colors.badText },

    // Bundle headline: net xP, its label, then cost chips pushed right.
    bundleSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    netXp: {
      ...fontRole.numeric,
      fontWeight: '800',
      fontSize: NET_XP_FONT_SIZE,
      lineHeight: NET_XP_FONT_SIZE,
    },
    netXpLabel: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    costChips: {
      marginLeft: 'auto',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: spacing.xs,
    },
    costChip: {
      ...fontRole.numeric,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.hairline,
      borderRadius: radius.lg,
      overflow: 'hidden',
      fontSize: fontSize.xs,
      fontWeight: '700',
    },
    costChipGood: {
      backgroundColor: mixHex(colors.surface, colors.good, CHIP_TINT),
      color: colors.goodText,
    },
    costChipBad: {
      backgroundColor: mixHex(colors.surface, colors.bad, CHIP_TINT),
      color: colors.badText,
    },
    costChipNeutral: { backgroundColor: colors.surfaceRaised, color: colors.textMuted },

    // OUT tile | xP gain + bank change | IN tile.
    moveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    playerTile: {
      flex: 1,
      minWidth: 0, // lets the name truncate instead of widening the tile
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.base,
    },
    playerTileOut: { backgroundColor: mixHex(colors.surface, colors.bad, TILE_TINT) },
    playerTileIn: {
      flexDirection: 'row-reverse',
      backgroundColor: mixHex(colors.surface, colors.good, TILE_TINT),
    },
    playerText: { flex: 1, minWidth: 0 },
    playerTextIn: { alignItems: 'flex-end' },
    playerName: {
      fontSize: fontSize.sm2,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    playerSub: {
      fontSize: fontSize.xs,
      color: colors.textMuted,
    },
    moveDelta: { minWidth: MOVE_DELTA_MIN_WIDTH, alignItems: 'center' },
    moveDeltaXp: {
      ...fontRole.numeric,
      fontWeight: '800',
      fontSize: fontSize.md,
    },
    moveDeltaBank: {
      ...fontRole.numeric,
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: colors.textMuted,
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
    // tint background + text on the good/warning/bad scale.
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
    compareColumnHeading: {
      flex: 1,
      marginHorizontal: spacing.hairline,
      textAlign: 'center',
      fontSize: fontSize.sm,
      fontWeight: '600',
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
      ...fontRole.numeric,
    },
    // Three-stop tone scale for fixture-quality cells. Solid colour
    // backgrounds with high-contrast text, on a heat-map model: easy
    // fixtures = mint, mid = amber, hard = coral. All three fills are
    // bright, so each takes its dark `on*` text.
    toneCellGood: { backgroundColor: colors.good },
    toneCellMid: { backgroundColor: colors.warning },
    toneCellBad: { backgroundColor: colors.bad },
    toneTextGood: { color: colors.onGood },
    toneTextMid: { color: colors.onWarning },
    toneTextBad: { color: colors.onBad },
    toneTextNeutral: { color: colors.textPrimary },
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
