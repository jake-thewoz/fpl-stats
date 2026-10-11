import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { FIELD_GROUPS, type FieldGroup, type FieldGroupKey } from '../players/fields';
import type { FieldKey } from '../players/types';
import { spacing, useThemedStyles, type Colors } from '../theme';
import { CheckRow } from './dialog/CheckRow';
import { DialogShell } from './dialog/DialogShell';
import { FieldGroupTabs } from './dialog/FieldGroupTabs';
import { Section } from './dialog/Section';

type Props = {
  visible: boolean;
  onClose: () => void;
  selected: readonly FieldKey[];
  onToggle: (key: FieldKey) => void;
};

export function ColumnPickerDialog({ visible, onClose, selected, onToggle }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [activeGroup, setActiveGroup] = useState<FieldGroupKey>(FIELD_GROUPS[0].key);
  const group = FIELD_GROUPS.find((g) => g.key === activeGroup) ?? FIELD_GROUPS[0];
  const pickedIn = (g: FieldGroup) =>
    g.fields.filter((f) => selected.includes(f.key)).length;
  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title="Columns"
      rightAction={{ label: 'Done', onPress: onClose }}
    >
      <FieldGroupTabs
        groups={FIELD_GROUPS}
        active={activeGroup}
        onChange={setActiveGroup}
        countFor={pickedIn}
      />
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Section hint="Pick which numeric columns appear in the list. Name, team and position are always shown.">
          {group.fields.map((f) => (
            <CheckRow
              key={f.key}
              label={f.label}
              hint={`“${f.shortLabel}” · ${f.description}`}
              checked={selected.includes(f.key)}
              onPress={() => onToggle(f.key)}
            />
          ))}
        </Section>
      </ScrollView>
    </DialogShell>
  );
}

const makeStyles = (_c: Colors) =>
  StyleSheet.create({
    scrollBody: { paddingBottom: spacing.xxxl },
  });
