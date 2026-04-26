import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/**
 * Slim single-section filter dialog used by the Analytics tab to narrow
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
  const hasAny = selected.length > 0;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={onClearAll} hitSlop={8} disabled={!hasAny}>
            {({ pressed }) => (
              <Text
                style={[
                  styles.topAction,
                  !hasAny && styles.topActionDisabled,
                  pressed && styles.pressed,
                ]}
              >
                Clear
              </Text>
            )}
          </Pressable>
          <Text style={styles.title}>Filter</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            {({ pressed }) => (
              <Text style={[styles.topAction, styles.topActionStrong, pressed && styles.pressed]}>
                Done
              </Text>
            )}
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
    </Modal>
  );
}

function CheckRow({
  label, checked, onPress,
}: { label: string; checked: boolean; onPress: () => void }) {
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
  topActionDisabled: { color: colors.textMuted, opacity: 0.5 },
  pressed: { opacity: 0.5 },
  section: { marginTop: 24 },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
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
