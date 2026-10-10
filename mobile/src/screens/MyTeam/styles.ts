import { StyleSheet } from 'react-native';
import { effects, fontSize, radius, spacing, type Colors } from '../../theme';

// Tiles share a row's width up to a cap, so a five-man midfield still
// fits a 360px phone while a two-man front line doesn't sprawl.
const TILE_MAX_WIDTH = 88;
const SHIRT_SIZE = 40;
// Keeps the pitch from stretching into a letterbox on wide web layouts.
const PITCH_MAX_WIDTH = 520;

/**
 * Shared makeStyles for every component in the MyTeam folder.
 * Co-located rather than split per-component because cross-references
 * between header, control bar, and the pinned-name column are dense.
 */
export const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    header: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: fontSize.lg2, fontWeight: '600', color: colors.textPrimary },
    headerSub: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },

    notice: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    noticeText: { color: colors.textMuted, fontSize: fontSize.sm2 },

    chipBannerFreeHit: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      backgroundColor: colors.warning,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    chipBannerTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.onWarning,
      marginBottom: spacing.hairline,
    },
    chipBannerBody: {
      fontSize: fontSize.sm,
      color: colors.onWarning,
      lineHeight: 16,
    },
    chipBadge: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      backgroundColor: colors.accentSoft,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    chipBadgeText: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.onAccentSoft,
    },

    controlBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: effects.pressedSubtle,

    // Used by MyTeamNameCell — the pinned-name column rendered by
    // PlayerListTable.
    nameLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    nameText: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '500' },
    subText: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    // Surface-coloured halo behind name + subtitle so they remain legible
    // against the club gradient. Invisible where the gradient has faded
    // to surface (same colour); only appears in the coloured-band area
    // where contrast is needed. ``alignSelf: 'flex-start'`` keeps the
    // backdrop hugging the text width rather than spanning the row.
    textBackdrop: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.xs,
      // 3px is a tight chip halo; below the named scale on purpose.
      borderRadius: 3,
    },
    // Same accent-coloured pill for both captain (C) and vice (V) — only
    // the letter differentiates. Matches FPL's own visual treatment.
    playerBadge: {
      fontSize: fontSize.xs,
      color: colors.onAccent,
      backgroundColor: colors.accent,
      // 5px / 1px are tight pill insets to keep the C/V badge compact;
      // below the named scale.
      paddingHorizontal: 5,
      paddingVertical: 1,
      // 4px is a tight badge corner; below the named radius scale.
      borderRadius: 4,
      overflow: 'hidden',
      fontWeight: '700',
    },

    controlGroup: { flexDirection: 'row', gap: spacing.md },

    pitchScrollBody: {
      padding: spacing.lg,
      gap: spacing.lg,
      width: '100%',
      maxWidth: PITCH_MAX_WIDTH,
      alignSelf: 'center',
    },
    pitch: {
      borderRadius: radius.base,
      borderWidth: 2,
      borderColor: colors.pitchLine,
      overflow: 'hidden',
    },
    formationLabel: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.md,
      zIndex: 1,
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.pitchLine,
    },
    pitchBand: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.lg,
    },
    bench: {
      backgroundColor: colors.surface,
      borderRadius: radius.base,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: spacing.md,
    },
    benchLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginLeft: spacing.md,
      marginBottom: spacing.xs,
    },
    benchRow: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    tile: { flex: 1, maxWidth: TILE_MAX_WIDTH, alignItems: 'center' },
    shirt: {
      width: SHIRT_SIZE,
      height: SHIRT_SIZE,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    shirtBadge: { position: 'absolute', top: spacing.hairline, right: spacing.hairline },
    // Mirrors playerBadge's compact pill, pinned to the opposite corner
    // from the armband.
    changeMarker: {
      position: 'absolute',
      top: spacing.hairline,
      left: spacing.hairline,
      fontSize: fontSize.xs,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    changeMarkerIn: { backgroundColor: colors.highlight, color: colors.onHighlight },
    changeMarkerOut: { backgroundColor: colors.danger, color: colors.onDanger },

    lineupControls: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    lineupControlsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: spacing.md,
    },
    lineupSummary: {
      fontSize: fontSize.sm2,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    lineupSummaryNote: { fontSize: fontSize.sm, color: colors.textMuted },

    tileName: {
      alignSelf: 'stretch',
      marginTop: spacing.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.hairline,
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.sm,
      borderTopRightRadius: radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    tileStat: {
      alignSelf: 'stretch',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.hairline,
      backgroundColor: colors.accent,
      borderBottomLeftRadius: radius.sm,
      borderBottomRightRadius: radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: colors.onAccent,
    },

    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxxl,
      backgroundColor: colors.background,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.md,
    },
    emptyBody: {
      padding: spacing.xl,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    primaryBtn: {
      marginTop: spacing.xl,
      paddingHorizontal: spacing.xl2,
      paddingVertical: spacing.base,
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
    },
    primaryBtnText: { color: colors.onAccent, fontWeight: '600' },
  });
