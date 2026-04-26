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
import { colors } from '../theme';

type Props = OnboardingScreenProps;

const FPL_POINTS_URL = 'https://fantasy.premierleague.com/my-team';

export default function OnboardingScreen({ navigation }: Props) {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 48,
    backgroundColor: colors.background,
    gap: 16,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textMuted, lineHeight: 22 },
  input: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 17,
  },
  error: { color: colors.danger, fontSize: 13 },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  helperGroup: { marginTop: 16, gap: 4 },
  helperLink: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  helperHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  helperEmphasis: { color: colors.textPrimary, fontWeight: '700' },
  mono: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  pressed: { opacity: 0.5 },
});
