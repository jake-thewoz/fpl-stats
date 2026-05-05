import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';
import { WebShell } from './WebShell';

/**
 * Slim single-section filter dialog used by the Transfers tab to narrow
 * transfer suggestions to a chosen position set. Mirrors the visual
 * vocabulary of the Players-screen FilterDialog (modal + checkbox rows
 * + Clear/Done top bar) without the team section that's specific to
 * Players.
 *
 * Why not reuse FilterDialog: that component renders a Team section
 * unconditionally, which doesn't apply here. Refactoring it to be
 * generic-section-driven was a bigger change than this slim dedicated
 * dialog. If a third consumer ever needs filtering, promoting both to
 * a shared sectioned dialog is the right move.
 */

export type Position = {
  /** FPL element_type id (1=GKP, 2=DEF, 3=MID, 4=FWD). */
  id: number;
  /** Display label (e.g. "Defenders"). */
  label: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  positions: readonly Position[];
  selected: readonly number[];
  onToggle: (id: number) => void;
  onClearAll: () => void;
};

export function PositionFilterDialog({
  visible, onClose, positions, selected, onToggle, onClearAll,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const hasAny = selected.length > 0;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <WebShell>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable
            onPress={onClearAll}
            hitSlop={8}
            disabled={!hasAny}
            style={({ pressed }) => [
              styles.topActionBtn,
              styles.topActionBtnSecondary,
              !hasAny && styles.topActionBtnDisabled,
              pressed && hasAny && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.topActionTextSecondary,
                !hasAny && styles.topActionTextDisabled,
              ]}
            >
              Clear
            </Text>
          </Pressable>
          <Text style={styles.title}>Filter</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              styles.topActionBtn,
              styles.topActionBtnPrimary,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.topActionTextPrimary}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Position</Text>
          <Text style={styles.sectionHint}>
            Leave all unchecked to see suggestions across every position.
          </Text>
          <View style={styles.sectionBody}>
            {positions.map((p) => (
              <CheckRow
                key={p.id}
                label={p.label}
                checked={selected.includes(p.id)}
                onPress={() => onToggle(p.id)}
              />
            ))}
          </View>
        </View>
      </View>
      </WebShell>
    </Modal>
  );
}

function CheckRow({
  label, checked, onPress,
}: { label: string; checked: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.safeTop,
      paddingBottom: spacing.lg,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    title: { fontSize: fontSize.lg2, fontWeight: '600', color: c.textPrimary },
    // Filled-button actions in the top bar — text-only labels were
    // too easy to miss in dark mode (#96 PR review).
    topActionBtn: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      minWidth: 64,
      alignItems: 'center',
    },
    topActionBtnPrimary: { backgroundColor: c.accent },
    topActionBtnSecondary: {
      backgroundColor: c.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    topActionBtnDisabled: effects.dimDisabled,
    topActionTextPrimary: {
      color: c.onAccent,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    topActionTextSecondary: {
      color: c.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '500',
    },
    topActionTextDisabled: { color: c.textMuted },
    pressed: effects.pressed,
    section: { marginTop: spacing.xxl },
    sectionTitle: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xs,
      color: c.textMuted,
      fontSize: fontSize.sm2,
      fontWeight: '600',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    sectionHint: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      color: c.textMuted,
      fontSize: fontSize.sm,
      lineHeight: 16,
    },
    sectionBody: {
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowPressed: { backgroundColor: c.background },
    rowLabel: { fontSize: fontSize.lg, color: c.textPrimary },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    checkboxMark: { color: c.onAccent, fontSize: fontSize.md, fontWeight: '700' },
  });
