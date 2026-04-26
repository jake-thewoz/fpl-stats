import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
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
import { colors } from '../theme';

/**
 * Field-aware filter dialog. Supports multi-select for position + team,
 * min/max ranges for every numeric field. Replaces the original
 * chip-based dialog from #68 — same UI vocabulary, much richer
 * field set.
 *
 * The dialog manages a draft filter state internally and only commits
 * to the parent on `Done`. That way mid-edit changes don't trigger
 * refetches per keystroke.
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

  const onClear = () => setDraft(EMPTY_FILTER);
  const onDone = () => {
    onApply(draft);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={onClear} hitSlop={8}>
            {({ pressed }) => (
              <Text style={[styles.topAction, pressed && styles.pressed]}>
                Clear
              </Text>
            )}
          </Pressable>
          <Text style={styles.title}>Filter</Text>
          <Pressable onPress={onDone} hitSlop={8}>
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

        <ScrollView
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
        >
          <CategoricalSection
            title="Position"
            options={positions}
            selected={draft.positions}
            onToggle={togglePosition}
            emptyHint="Positions appear once players load."
          />
          <CategoricalSection
            title="Team"
            options={teams}
            selected={draft.teams}
            onToggle={toggleTeam}
            emptyHint="Teams appear once players load."
          />

          {FIELDS_IN_PICKER_ORDER.map((f) => (
            <RangeSection
              key={f.key}
              title={f.label}
              range={draft.ranges[f.key]}
              onChange={(r) => setRange(f.key, r)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function CategoricalSection({
  title, options, selected, onToggle, emptyHint,
}: {
  title: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyHint: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>
        {options.length === 0 ? (
          <Text style={styles.emptyHint}>{emptyHint}</Text>
        ) : (
          options.map((opt) => (
            <CheckRow
              key={opt}
              label={opt}
              checked={selected.includes(opt)}
              onPress={() => onToggle(opt)}
            />
          ))
        )}
      </View>
    </View>
  );
}

function RangeSection({
  title, range, onChange,
}: {
  title: string;
  range: RangeFilter | undefined;
  onChange: (r: RangeFilter) => void;
}) {
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={[styles.sectionBody, styles.rangeBody]}>
        <RangeInput
          label="Min"
          value={min}
          onChangeNumber={(v) => onChange({ min: v, max })}
        />
        <View style={styles.rangeSep} />
        <RangeInput
          label="Max"
          value={max}
          onChangeNumber={(v) => onChange({ min, max: v })}
        />
      </View>
    </View>
  );
}

function RangeInput({
  label, value, onChangeNumber,
}: {
  label: string;
  value: number | null;
  onChangeNumber: (value: number | null) => void;
}) {
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  pressed: { opacity: 0.5 },
  scrollBody: { paddingBottom: 64 },
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
  emptyHint: { padding: 16, color: colors.textMuted },
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
  rangeBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rangeInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rangeLabel: { fontSize: 14, color: colors.textMuted, width: 30 },
  rangeField: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangeSep: { width: 12 },
});
