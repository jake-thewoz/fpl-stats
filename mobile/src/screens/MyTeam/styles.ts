import { StyleSheet } from 'react-native';
import { effects, fontSize, radius, spacing, type Colors } from '../../theme';

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
    controlBtn: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    controlBtnActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    controlBtnText: {
      fontSize: fontSize.sm2,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    controlBtnTextActive: { color: colors.onAccent },
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
