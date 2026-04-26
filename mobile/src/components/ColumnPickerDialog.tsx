import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FIELDS_IN_PICKER_ORDER } from '../players/fields';
import type { FieldKey } from '../players/types';
import { colors } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  selected: readonly FieldKey[];
  onToggle: (key: FieldKey) => void;
};

export function ColumnPickerDialog({ visible, onClose, selected, onToggle }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <View style={styles.topActionPlaceholder} />
          <Text style={styles.title}>Columns</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            {({ pressed }) => (
              <Text
                style={[
                  styles.topAction,
                  styles.topActionStrong,
                  pressed && styles.pressed,
                ]}
              >
                Done
              </Text>
            )}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  topAction: { fontSize: 16, color: colors.accent },
  topActionStrong: { fontWeight: '600' },
  topActionPlaceholder: { minWidth: 50 },
  pressed: { opacity: 0.5 },
  scrollBody: { paddingBottom: 32 },
  section: { marginTop: 24 },
  sectionHint: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.background },
  rowLabel: { fontSize: 16, color: colors.textPrimary },
  rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxMark: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
});
