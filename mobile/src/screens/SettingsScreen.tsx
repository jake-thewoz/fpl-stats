import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/Text';
import {
  clearFplTeamId,
  getFplTeamId,
  isValidFplTeamId,
  setFplTeamId,
} from '../storage/user';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { HelpDialog } from '../help/HelpDialog';
import { ALL_HELP_TOPICS } from '../help/topics';
import type { SettingsScreenProps } from '../navigation/types';
import {
  effects,
  fontRole,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
  type ThemeMode,
} from '../theme';

type Props = SettingsScreenProps;

const THEME_OPTIONS: readonly SegmentOption<ThemeMode>[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

export default function SettingsScreen(_props: Props) {
  const { colors, mode, setMode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

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
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>Change</Text>
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
          <SegmentedControl options={THEME_OPTIONS} value={mode} onChange={setMode} />
        </View>

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>HELP</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => setGuideOpen(true)}
            style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
            accessibilityRole="button"
          >
            <View style={styles.linkRowText}>
              <Text style={styles.linkRowLabel}>How the app works</Text>
              <Text style={styles.linkRowHint}>
                What xP means, the symbols, and every tab explained. Each tab also has a ?
                button at the top.
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
      </View>
      <HelpDialog
        visible={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="How the app works"
        topics={ALL_HELP_TOPICS}
      />
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
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: spacing.lg,
    },
    // 26px is the team-id current-value display, distinctively bigger
    // than headings; one call site so it stays inline.
    currentValue: {
      fontSize: 26,
      fontWeight: '800',
      color: colors.textPrimary,
      ...fontRole.numeric,
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
    error: { color: colors.badText, fontSize: fontSize.sm2 },
    actions: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.xs },
    primaryBtn: {
      flex: 1,
      backgroundColor: colors.accent,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    primaryBtnText: {
      color: colors.onAccent,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    secondaryBtn: {
      flex: 1,
      backgroundColor: colors.background,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    dangerBtn: {
      flex: 1,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      alignItems: 'center',
      // Thicker than a hairline so the outline reads as a button.
      borderWidth: 1.5,
      borderColor: colors.bad,
    },
    dangerBtnText: { color: colors.badText, fontSize: fontSize.base, fontWeight: '600' },
    pressed: effects.pressed,

    sectionTitleSpaced: { marginTop: spacing.xxl },
    linkRowPressed: effects.pressedSubtle,
    linkRowLabel: { fontSize: fontSize.lg, color: colors.textPrimary },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    linkRowText: { flex: 1, gap: spacing.xs },
    linkRowHint: { fontSize: fontSize.sm, color: colors.textMuted },
    chevron: { fontSize: fontSize.xl, color: colors.textMuted },
  });
