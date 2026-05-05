import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../../theme';

type Props = {
  label: string;
  /** Optional secondary line shown beneath the label (e.g. ColumnPicker
   *  shows the short table-header label as a hint). */
  hint?: string;
  checked: boolean;
  onPress: () => void;
};

/**
 * Checkbox row used by every dialog that picks from a list of options
 * (Filter, Columns, Positions). Three previously-identical inline
 * implementations collapse here.
 */
export function CheckRow({ label, hint, checked, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={styles.labelGroup}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
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
    labelGroup: { flex: 1 },
    label: { fontSize: fontSize.lg, color: c.textPrimary },
    hint: { fontSize: fontSize.sm, color: c.textMuted, marginTop: spacing.hairline },
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
