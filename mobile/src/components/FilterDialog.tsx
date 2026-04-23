import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  positions: readonly string[];
  selectedPositions: string[];
  onTogglePosition: (value: string) => void;
  teams: readonly string[];
  selectedTeams: string[];
  onToggleTeam: (value: string) => void;
  onClearAll: () => void;
};

export function FilterDialog(props: Props) {
  const {
    visible, onClose,
    positions, selectedPositions, onTogglePosition,
    teams, selectedTeams, onToggleTeam,
    onClearAll,
  } = props;

  const hasAny = selectedPositions.length > 0 || selectedTeams.length > 0;

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

        <ScrollView contentContainerStyle={styles.scrollBody}>
          <Section title="Position">
            {positions.map((p) => (
              <CheckRow
                key={p}
                label={p}
                checked={selectedPositions.includes(p)}
                onPress={() => onTogglePosition(p)}
              />
            ))}
          </Section>

          <Section title="Team">
            {teams.length === 0 ? (
              <Text style={styles.emptyHint}>Teams load once players are fetched.</Text>
            ) : (
              teams.map((t) => (
                <CheckRow
                  key={t}
                  label={t}
                  checked={selectedTeams.includes(t)}
                  onPress={() => onToggleTeam(t)}
                />
              ))
            )}
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
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
  scrollBody: { paddingBottom: 32 },
  section: { marginTop: 24 },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
  emptyHint: { padding: 16, color: colors.textMuted },
});
