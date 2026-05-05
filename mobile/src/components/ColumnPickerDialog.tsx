import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FIELDS_IN_PICKER_ORDER } from '../players/fields';
import type { FieldKey } from '../players/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';
import { WebShell } from './WebShell';

type Props = {
  visible: boolean;
  onClose: () => void;
  selected: readonly FieldKey[];
  onToggle: (key: FieldKey) => void;
};

export function ColumnPickerDialog({ visible, onClose, selected, onToggle }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <WebShell>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <View style={styles.topActionPlaceholder} />
          <Text style={styles.title}>Columns</Text>
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

        <ScrollView contentContainerStyle={styles.scrollBody}>
          <View style={styles.section}>
            <Text style={styles.sectionHint}>
              Pick which numeric columns appear in the list. Name, team and
              position are always shown.
            </Text>
            <View style={styles.sectionBody}>
              {FIELDS_IN_PICKER_ORDER.map((f) => (
                <CheckRow
                  key={f.key}
                  label={f.label}
                  hint={f.shortLabel}
                  checked={selected.includes(f.key)}
                  onPress={() => onToggle(f.key)}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
      </WebShell>
    </Modal>
  );
}

function CheckRow({
  label,
  hint,
  checked,
  onPress,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onPress: () => void;
}) {
  // Each CheckRow re-derives the same StyleSheet from the same factory —
  // useThemedStyles memoizes per palette so this is effectively free,
  // and it lets the row stay a self-contained component without
  // threading `styles` through props.
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>shown as “{hint}”</Text>
      </View>
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
    topActionTextPrimary: {
      color: c.onAccent,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    // Reserves space symmetrically opposite the Done button so the
    // "Columns" title stays centered in the top bar.
    topActionPlaceholder: {
      minWidth: 64,
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.md,
    },
    pressed: effects.pressed,
    scrollBody: { paddingBottom: spacing.xxxl },
    section: { marginTop: spacing.xxl },
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
    rowHint: { fontSize: fontSize.sm, color: c.textMuted, marginTop: spacing.hairline },
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
