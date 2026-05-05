import { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FIELDS_IN_PICKER_ORDER } from '../players/fields';
import type {
  FieldKey,
  FilterState,
  RangeFilter,
} from '../players/types';
import { EMPTY_FILTER } from '../players/types';
import {
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';
import { CheckRow } from './dialog/CheckRow';
import { DialogShell } from './dialog/DialogShell';
import { Section } from './dialog/Section';

/**
 * Field-aware filter dialog. Multi-select for position + team, and a
 * min/max range for every numeric field. The dialog manages a draft
 * filter state internally and only commits on Done — mid-edit changes
 * don't trigger refetches per keystroke.
 */
type Props = {
  visible: boolean;
  onClose: () => void;
  /** Current applied filter — used as the dialog's initial draft. */
  filter: FilterState;
  /** Available position values (typically derived from the dataset). */
  positions: readonly string[];
  /** Available team values. */
  teams: readonly string[];
  onApply: (filter: FilterState) => void;
};

export function FilterDialog({
  visible, onClose, filter, positions, teams, onApply,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  // Draft state lives only while the dialog is open. Re-seeded from the
  // applied filter every time the dialog opens — applying-then-reopening
  // shows the user's latest applied state, not whatever they typed before
  // a previous Cancel.
  const [draft, setDraft] = useState<FilterState>(filter);
  useEffect(() => {
    if (visible) setDraft(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const togglePosition = (p: string) => {
    setDraft((d) => ({
      ...d,
      positions: d.positions.includes(p)
        ? d.positions.filter((x) => x !== p)
        : [...d.positions, p],
    }));
  };
  const toggleTeam = (t: string) => {
    setDraft((d) => ({
      ...d,
      teams: d.teams.includes(t)
        ? d.teams.filter((x) => x !== t)
        : [...d.teams, t],
    }));
  };
  const setRange = (key: FieldKey, range: RangeFilter) => {
    setDraft((d) => ({
      ...d,
      ranges: { ...d.ranges, [key]: range },
    }));
  };

  const onClear = () => {
    // Commit empty + dismiss in one tap — without this, hitting Clear
    // only reset the internal draft and the user saw no list change
    // until they also tapped Done. One-tap "give me everything back"
    // is the right shape for this action.
    setDraft(EMPTY_FILTER);
    onApply(EMPTY_FILTER);
    onClose();
  };
  const onDone = () => {
    onApply(draft);
    onClose();
  };

  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title="Filter"
      leftAction={{ label: 'Clear', onPress: onClear }}
      rightAction={{ label: 'Done', onPress: onDone }}
    >
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="Position">
          {positions.length === 0 ? (
            <Text style={styles.emptyHint}>
              Positions appear once players load.
            </Text>
          ) : (
            positions.map((opt) => (
              <CheckRow
                key={opt}
                label={opt}
                checked={draft.positions.includes(opt)}
                onPress={() => togglePosition(opt)}
              />
            ))
          )}
        </Section>

        {FIELDS_IN_PICKER_ORDER.map((f) => (
          <Section key={f.key} title={f.label}>
            <View style={styles.rangeBody}>
              <RangeInput
                label="Min"
                value={draft.ranges[f.key]?.min ?? null}
                onChangeNumber={(v) =>
                  setRange(f.key, {
                    min: v,
                    max: draft.ranges[f.key]?.max ?? null,
                  })
                }
              />
              <View style={styles.rangeSep} />
              <RangeInput
                label="Max"
                value={draft.ranges[f.key]?.max ?? null}
                onChangeNumber={(v) =>
                  setRange(f.key, {
                    min: draft.ranges[f.key]?.min ?? null,
                    max: v,
                  })
                }
              />
            </View>
          </Section>
        ))}

        {/* Team last — least-used filter in practice, kept off the
            top so it doesn't push the more common ranges down. */}
        <Section title="Team">
          {teams.length === 0 ? (
            <Text style={styles.emptyHint}>
              Teams appear once players load.
            </Text>
          ) : (
            teams.map((opt) => (
              <CheckRow
                key={opt}
                label={opt}
                checked={draft.teams.includes(opt)}
                onPress={() => toggleTeam(opt)}
              />
            ))
          )}
        </Section>
      </ScrollView>
    </DialogShell>
  );
}

function RangeInput({
  label, value, onChangeNumber,
}: {
  label: string;
  value: number | null;
  onChangeNumber: (value: number | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // Local text mirrors the parent value so partial inputs ("3.", "-") can
  // exist mid-edit without round-tripping to a number. We resync text from
  // value only when the parent clears it externally (e.g. Clear All) —
  // otherwise the user's keystrokes drive the field.
  const [text, setText] = useState<string>(value == null ? '' : String(value));
  useEffect(() => {
    if (value == null && text !== '') setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChangeText = (t: string) => {
    setText(t);
    if (t === '' || t === '-' || t === '.' || t === '-.') {
      onChangeNumber(null);
      return;
    }
    const n = parseFloat(t);
    onChangeNumber(Number.isNaN(n) ? null : n);
  };

  return (
    <View style={styles.rangeInput}>
      <Text style={styles.rangeLabel}>{label}</Text>
      <TextInput
        style={styles.rangeField}
        keyboardType="decimal-pad"
        value={text}
        onChangeText={onChangeText}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
      />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    // 64px keeps the last section clear of the bottom-of-screen gesture
    // area on tall phones; not part of the standard scale.
    scrollBody: { paddingBottom: 64 },
    emptyHint: { padding: spacing.xl, color: c.textMuted },
    rangeBody: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
    },
    rangeInput: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    // 30px width keeps "Min"/"Max" labels at a fixed column so the inputs
    // line up; fontSize.md = 14 matches the surrounding form scale.
    rangeLabel: { fontSize: fontSize.md, color: c.textMuted, width: 30 },
    rangeField: {
      flex: 1,
      fontSize: fontSize.lg,
      color: c.textPrimary,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: c.background,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    rangeSep: { width: spacing.lg },
  });
