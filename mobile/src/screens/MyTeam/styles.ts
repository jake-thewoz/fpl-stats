import { StyleSheet } from 'react-native';
import { effects, fontRole, fontSize, radius, spacing, type Colors } from '../../theme';

// Tiles share a row's width up to a cap, so a five-man midfield still
// fits a 360px phone while a two-man front line doesn't sprawl.
const TILE_MAX_WIDTH = 88;
const SHIRT_SLOT_SIZE = 40;
// Labels and the score's unit sit a step back from the white numbers.
const HERO_SECONDARY_OPACITY = 0.8;
// Small uppercase labels need a little tracking to stay legible.
const CAPS_LETTER_SPACING = 0.6;
// Captain / vice disc on the pitch shirt; a one-off size below the type scale.
const ARMBAND_SIZE = 16;
const ARMBAND_RING_WIDTH = 1.5;
const ARMBAND_FONT_SIZE = 9;
// Penalty-box outline at the top of the pitch, partly hidden above the edge.
const PENALTY_BOX_WIDTH = 120;
const PENALTY_BOX_HEIGHT = 76;
const PENALTY_BOX_HIDDEN_HEIGHT = 38;
const PITCH_LINE_WIDTH = 1.5;
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

    hero: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.lg,
      borderRadius: radius.lg,
      gap: spacing.sm,
    },
    heroTopLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    heroTeamName: {
      flexShrink: 1,
      fontSize: fontSize.base,
      fontWeight: '700',
      color: colors.onHero,
    },
    heroChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.hairline,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.good,
      color: colors.onGood,
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: CAPS_LETTER_SPACING,
      textTransform: 'uppercase',
    },
    heroScoreLine: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: spacing.lg,
    },
    heroScore: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
    heroScoreValue: {
      ...fontRole.numeric,
      fontWeight: '800',
      fontSize: fontSize.heroScore,
      lineHeight: fontSize.heroScore,
      color: colors.onHero,
    },
    heroScoreUnit: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.onHero,
      opacity: HERO_SECONDARY_OPACITY,
      paddingBottom: spacing.xs,
    },
    heroStats: { flexDirection: 'row', gap: spacing.lg },
    heroStatLabel: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      letterSpacing: CAPS_LETTER_SPACING,
      textTransform: 'uppercase',
      color: colors.onHero,
      opacity: HERO_SECONDARY_OPACITY,
    },
    heroStatValue: {
      ...fontRole.numeric,
      fontWeight: '800',
      fontSize: fontSize.lg,
      color: colors.onHero,
    },

    notice: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    noticeText: { color: colors.textMuted, fontSize: fontSize.sm2 },

    freeHitBanner: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.base,
      backgroundColor: colors.warning,
    },
    freeHitBannerText: {
      fontSize: fontSize.sm,
      color: colors.onWarning,
      lineHeight: 16,
    },

    controlBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    pressed: effects.pressedSubtle,

    // Used by MyTeamNameCell — the pinned-name column rendered by
    // PlayerListTable.
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
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    // The top of the goalkeeper's penalty box, peeking in from the edge.
    penaltyBox: {
      position: 'absolute',
      top: -PENALTY_BOX_HIDDEN_HEIGHT,
      alignSelf: 'center',
      width: PENALTY_BOX_WIDTH,
      height: PENALTY_BOX_HEIGHT,
      zIndex: 1,
      borderWidth: PITCH_LINE_WIDTH,
      borderColor: colors.pitchLine,
      borderBottomLeftRadius: radius.md,
      borderBottomRightRadius: radius.md,
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
      borderRadius: radius.lg,
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
    // Wider than the shirt so the armband and change marker sit on its
    // shoulders rather than covering the crest area.
    shirt: {
      width: SHIRT_SLOT_SIZE,
      height: SHIRT_SLOT_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Captain / vice: a small grape disc on the shirt's shoulder, ringed
    // in whatever it sits on so it reads as a separate badge.
    armband: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: ARMBAND_SIZE,
      height: ARMBAND_SIZE,
      borderRadius: ARMBAND_SIZE / 2,
      borderWidth: ARMBAND_RING_WIDTH,
      overflow: 'hidden',
      backgroundColor: colors.accent,
      color: colors.onAccent,
      fontSize: ARMBAND_FONT_SIZE,
      lineHeight: ARMBAND_SIZE - ARMBAND_RING_WIDTH * 2,
      fontWeight: '800',
      textAlign: 'center',
    },
    armbandOnPitch: { borderColor: colors.pitchStripe },
    armbandOnBench: { borderColor: colors.surface },
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
    changeMarkerIn: { backgroundColor: colors.good, color: colors.onGood },
    changeMarkerOut: { backgroundColor: colors.bad, color: colors.onBad },

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
      marginTop: spacing.hairline,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.hairline,
      borderTopLeftRadius: radius.sm,
      borderTopRightRadius: radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    tileNameOnPitch: { backgroundColor: colors.pitchTile, color: colors.onHero },
    tileNameOnBench: { backgroundColor: colors.surfaceRaised, color: colors.textPrimary },
    // Background and text come from the heat scale when the stat has one.
    tileStat: {
      ...fontRole.numeric,
      alignSelf: 'stretch',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.hairline,
      backgroundColor: colors.surfaceRaised,
      borderBottomLeftRadius: radius.sm,
      borderBottomRightRadius: radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.textPrimary,
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
