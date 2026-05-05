import { StyleSheet } from 'react-native';
import {
  effects,
  fontSize,
  radius,
  spacing,
  type Colors,
} from '../../theme';

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
