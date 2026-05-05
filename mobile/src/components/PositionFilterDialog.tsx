import { CheckRow } from './dialog/CheckRow';
import { DialogShell } from './dialog/DialogShell';
import { Section } from './dialog/Section';

/**
 * Slim single-section filter dialog used by the Transfers tab to narrow
 * transfer suggestions to a chosen position set.
 */

export type Position = {
  /** FPL element_type id (1=GKP, 2=DEF, 3=MID, 4=FWD). */
  id: number;
  /** Display label (e.g. "Defenders"). */
  label: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  positions: readonly Position[];
  selected: readonly number[];
  onToggle: (id: number) => void;
  onClearAll: () => void;
};

export function PositionFilterDialog({
  visible,
  onClose,
  positions,
  selected,
  onToggle,
  onClearAll,
}: Props) {
  const hasAny = selected.length > 0;
  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title="Filter"
      leftAction={{ label: 'Clear', onPress: onClearAll, disabled: !hasAny }}
      rightAction={{ label: 'Done', onPress: onClose }}
    >
      <Section
        title="Position"
        hint="Leave all unchecked to see suggestions across every position."
      >
        {positions.map((p) => (
          <CheckRow
            key={p.id}
            label={p.label}
            checked={selected.includes(p.id)}
            onPress={() => onToggle(p.id)}
          />
        ))}
      </Section>
    </DialogShell>
  );
}
