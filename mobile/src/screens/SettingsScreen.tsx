import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  clearFplTeamId,
  getFplTeamId,
  isValidFplTeamId,
  setFplTeamId,
} from '../storage/user';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { SettingsScreenProps } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
  type ThemeMode,
} from '../theme';

type Props = SettingsScreenProps;

export default function SettingsScreen(_props: Props) {
  const { colors, mode, setMode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    getFplTeamId().then(setCurrentId);
  }, []);

  async function onSave() {
    const trimmed = input.trim();
    if (!isValidFplTeamId(trimmed)) {
      setError('Enter a positive number — your FPL team ID.');
      return;
    }
    setError(null);
    await setFplTeamId(trimmed);
    setCurrentId(trimmed);
    setEditing(false);
    setInput('');
  }

  async function onConfirmClear() {
    setClearConfirmOpen(false);
    await clearFplTeamId();
    setCurrentId(null);
  }

  return (
    <>
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>FPL TEAM ID</Text>

      {!editing ? (
        <View style={styles.card}>
          <Text style={styles.currentValue}>{currentId ?? 'Not set'}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setInput(currentId ?? '');
                setError(null);
                setEditing(true);
              }}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>Change</Text>
            </Pressable>
            <Pressable
              onPress={() => setClearConfirmOpen(true)}
              style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              disabled={currentId === null}
            >
              <Text style={styles.dangerBtnText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={(v) => {
              setInput(v);
              if (error) setError(null);
            }}
            placeholder="Team ID"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            autoFocus
            autoCorrect={false}
            accessibilityLabel="FPL team ID"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setEditing(false);
                setError(null);
                setInput('');
              }}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>APPEARANCE</Text>
      <View style={styles.card}>
        <ThemeRow label="Dark"          value="dark"   active={mode} onSelect={setMode} />
        <ThemeRow label="Light"         value="light"  active={mode} onSelect={setMode} />
        <ThemeRow label="Follow system" value="system" active={mode} onSelect={setMode} />
      </View>
    </View>
    <ConfirmDialog
      visible={clearConfirmOpen}
      title="Clear team ID?"
      message="You can add it again any time from this screen."
      confirmLabel="Clear"
      cancelLabel="Cancel"
      destructive
      onConfirm={onConfirmClear}
      onCancel={() => setClearConfirmOpen(false)}
    />
    </>
  );
}

function ThemeRow({
  label, value, active, onSelect,
}: {
  label: string;
  value: ThemeMode;
  active: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const selected = active === value;
  return (
    <Pressable
      onPress={() => onSelect(value)}
      style={({ pressed }) => [
        styles.themeRow,
        pressed && styles.themeRowPressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={styles.themeRowLabel}>{label}</Text>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, padding: spacing.xl, backgroundColor: colors.background },
    sectionTitle: {
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.md,
      color: colors.textMuted,
      fontSize: fontSize.sm2,
      fontWeight: '600',
      letterSpacing: 0.5,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.base,
      padding: spacing.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: spacing.lg,
    },
    // 22px is the team-id current-value display, distinctively bigger
    // than headings; one call site so it stays inline.
    currentValue: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    input: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.textPrimary,
      fontSize: fontSize.lg2,
    },
    error: { color: colors.danger, fontSize: fontSize.sm2 },
    actions: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.xs },
    primaryBtn: {
      flex: 1,
      backgroundColor: colors.accent,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    primaryBtnText: { color: colors.onAccent, fontSize: fontSize.base, fontWeight: '600' },
    secondaryBtn: {
      flex: 1,
      backgroundColor: colors.background,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    secondaryBtnText: { color: colors.textPrimary, fontSize: fontSize.base, fontWeight: '600' },
    dangerBtn: {
      flex: 1,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.background,
    },
    dangerBtnText: { color: colors.danger, fontSize: fontSize.base, fontWeight: '600' },
    pressed: effects.pressed,

    // Appearance section
    sectionTitleSpaced: { marginTop: spacing.xxl },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.lg,
      // Hairline divider between rows; the last row's bottom border is
      // hidden by the card's own rounded edge, so leaving it on every row
      // is fine and keeps the markup uniform.
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    themeRowPressed: effects.pressedSubtle,
    themeRowLabel: { fontSize: fontSize.lg, color: colors.textPrimary },
    radio: {
      width: 22,
      height: 22,
      // 11px radius makes the 22px square a perfect circle — outside
      // the named scale on purpose because it's geometry, not design.
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: { borderColor: colors.accent },
    radioInner: {
      width: 12,
      height: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
    },
  });
