import { useState } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isValidFplTeamId, setFplTeamId, setOnboardingSeen } from '../storage/user';
import type { OnboardingScreenProps } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

type Props = OnboardingScreenProps;

const FPL_POINTS_URL = 'https://fantasy.premierleague.com/my-team';

export default function OnboardingScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    const trimmed = input.trim();
    if (!isValidFplTeamId(trimmed)) {
      setError('Enter a positive number — your FPL team ID.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await setFplTeamId(trimmed);
      await setOnboardingSeen();
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } catch (e) {
      setSaving(false);
      setError("Couldn't save. Try again.");
    }
  }

  async function onSkip() {
    try {
      await setOnboardingSeen();
    } finally {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to FPL Stats</Text>
      <Text style={styles.body}>
        Enter your Fantasy Premier League team ID so we can pull your team and
        compare with friends.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Team ID (e.g. 1234567)"
        placeholderTextColor={colors.textMuted}
        value={input}
        onChangeText={(v) => {
          setInput(v);
          if (error) setError(null);
        }}
        keyboardType="number-pad"
        autoFocus
        autoCorrect={false}
        accessibilityLabel="FPL team ID"
      />
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={onSave}
        disabled={saving}
        style={({ pressed }) => [
          styles.primaryBtn,
          (pressed || saving) && styles.pressed,
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Continue'}</Text>
      </Pressable>

      <Pressable
        onPress={onSkip}
        disabled={saving}
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryBtnText}>Skip for now</Text>
      </Pressable>

      <View style={styles.helperGroup}>
        <Pressable
          onPress={() => Linking.openURL(FPL_POINTS_URL)}
          hitSlop={6}
          accessibilityRole="link"
        >
          {({ pressed }) => (
            <Text style={[styles.helperLink, pressed && styles.pressed]}>
              Find my team ID
            </Text>
          )}
        </Pressable>
        <Text style={styles.helperHint}>
          Opens the FPL site. Sign in if prompted, then tap{' '}
          <Text style={styles.helperEmphasis}>Points</Text> in the top nav.
          Your team ID is the number in the URL:{' '}
          <Text style={styles.mono}>.../entry/YOUR_ID/event/...</Text>
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: spacing.xxl,
      paddingTop: spacing.safeTop,
      backgroundColor: c.background,
      gap: spacing.xl,
    },
    // 28px is the welcome-screen hero title; one call site, above the
    // shared type scale.
    title: { fontSize: 28, fontWeight: '700', color: c.textPrimary },
    body: { fontSize: fontSize.base, color: c.textMuted, lineHeight: 22 },
    input: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      color: c.textPrimary,
      fontSize: fontSize.lg2,
    },
    error: { color: c.danger, fontSize: fontSize.sm2 },
    primaryBtn: {
      marginTop: spacing.md,
      backgroundColor: c.accent,
      paddingVertical: spacing.lg2,
      borderRadius: radius.base,
      alignItems: 'center',
    },
    primaryBtnText: { color: c.onAccent, fontSize: fontSize.lg, fontWeight: '600' },
    secondaryBtn: {
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    secondaryBtnText: { color: c.textPrimary, fontSize: fontSize.base, fontWeight: '600' },
    helperGroup: { marginTop: spacing.xl, gap: spacing.xs },
    helperLink: {
      color: c.accent,
      fontSize: fontSize.base,
      fontWeight: '600',
      textAlign: 'center',
    },
    helperHint: {
      color: c.textMuted,
      fontSize: fontSize.sm,
      lineHeight: 18,
      textAlign: 'center',
    },
    helperEmphasis: { color: c.textPrimary, fontWeight: '700' },
    mono: { fontVariant: ['tabular-nums'], fontWeight: '600' },
    pressed: effects.pressed,
  });
