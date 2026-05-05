import { ScrollView, StyleSheet } from 'react-native';
import { FIELDS_IN_PICKER_ORDER } from '../players/fields';
import type { FieldKey } from '../players/types';
import { spacing, useThemedStyles, type Colors } from '../theme';
import { CheckRow } from './dialog/CheckRow';
import { DialogShell } from './dialog/DialogShell';
import { Section } from './dialog/Section';

type Props = {
  visible: boolean;
  onClose: () => void;
  selected: readonly FieldKey[];
  onToggle: (key: FieldKey) => void;
};

export function ColumnPickerDialog({ visible, onClose, selected, onToggle }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title="Columns"
      rightAction={{ label: 'Done', onPress: onClose }}
    >
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Section hint="Pick which numeric columns appear in the list. Name, team and position are always shown.">
          {FIELDS_IN_PICKER_ORDER.map((f) => (
            <CheckRow
              key={f.key}
              label={f.label}
              hint={`shown as “${f.shortLabel}”`}
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
