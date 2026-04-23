import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { fetchEntry, EntryNotFoundError, type Entry } from '../api/entry';
import { addFriend } from '../storage/friends';
import { isValidFplTeamId } from '../storage/user';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AddFriend'>;

type Step =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'validated'; entry: Entry }
  | { status: 'error'; message: string };

export default function AddFriendScreen({ navigation }: Props) {
  const [teamIdInput, setTeamIdInput] = useState('');
  const [step, setStep] = useState<Step>({ status: 'idle' });
  const [alias, setAlias] = useState('');
  const [saving, setSaving] = useState(false);

  async function onValidate() {
    const trimmed = teamIdInput.trim();
    if (!isValidFplTeamId(trimmed)) {
      setStep({
        status: 'error',
        message: 'Enter a positive number — the FPL team ID.',
      });
      return;
    }
    setStep({ status: 'validating' });
    try {
      const resp = await fetchEntry(trimmed);
      setStep({ status: 'validated', entry: resp.entry });
      // Pre-fill the alias with the team name; user can rename before saving.
      setAlias(resp.entry.name);
    } catch (err) {
      if (err instanceof EntryNotFoundError) {
        setStep({
          status: 'error',
          message: `No FPL team found with ID ${trimmed}. Double-check the number on their Points page.`,
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setStep({
          status: 'error',
          message: `Couldn't validate — ${message}. Try again.`,
        });
      }
    }
  }

  async function onSave() {
    if (step.status !== 'validated') return;
    const trimmedAlias = alias.trim();
    if (trimmedAlias.length === 0) {
      setStep({
        status: 'error',
        message: 'Alias cannot be empty — you can keep the team name as-is.',
      });
      return;
    }
    setSaving(true);
    try {
      await addFriend({ id: String(step.entry.id), alias: trimmedAlias });
      navigation.goBack();
    } catch (err) {
      setSaving(false);
      const message = err instanceof Error ? err.message : String(err);
      setStep({
        status: 'error',
        message: `Couldn't save — ${message}.`,
      });
    }
  }

  const isValidated = step.status === 'validated';
  const isValidating = step.status === 'validating';
  const errorMessage = step.status === 'error' ? step.message : null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Team ID</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 1234567"
        placeholderTextColor={colors.textMuted}
        value={teamIdInput}
        onChangeText={(v) => {
          setTeamIdInput(v);
          // Reset validation state when the ID changes.
          if (isValidated || step.status === 'error') {
            setStep({ status: 'idle' });
            setAlias('');
          }
        }}
        keyboardType="number-pad"
        autoFocus
        autoCorrect={false}
        editable={!isValidated && !saving}
        accessibilityLabel="FPL team ID"
      />

      {!isValidated ? (
        <Pressable
          onPress={onValidate}
          disabled={isValidating}
          style={({ pressed }) => [
            styles.primaryBtn,
            (pressed || isValidating) && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>
            {isValidating ? 'Checking…' : 'Find team'}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.validatedBlock}>
          <View style={styles.previewCard}>
            <Text style={styles.previewLabel}>Team</Text>
            <Text style={styles.previewName}>{step.entry.name}</Text>
            <Text style={styles.previewManager}>
              {step.entry.player_first_name} {step.entry.player_last_name}
            </Text>
          </View>

          <Text style={styles.label}>Alias</Text>
          <TextInput
            style={styles.input}
            value={alias}
            onChangeText={setAlias}
            placeholder="How you want to see them in your list"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel="Friend alias"
          />

          <Pressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.primaryBtn,
              (pressed || saving) && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {saving ? 'Saving…' : 'Add friend'}
            </Text>
          </Pressable>
        </View>
      )}

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: colors.background,
    gap: 12,
  },
  label: {
    paddingHorizontal: 4,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 17,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.5 },
  validatedBlock: { gap: 12 },
  previewCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  previewLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewName: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  previewManager: { marginTop: 2, color: colors.textMuted, fontSize: 14 },
  error: {
    paddingHorizontal: 4,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
