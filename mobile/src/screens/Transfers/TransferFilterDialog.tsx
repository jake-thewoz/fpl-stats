import { View } from 'react-native';
import { CheckRow } from '../../components/dialog/CheckRow';
import { DialogShell } from '../../components/dialog/DialogShell';
import { Section } from '../../components/dialog/Section';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl';
import { FREE_TRANSFER_OPTIONS } from '../../transfers/settings';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';

/**
 * Filter dialog for the Transfers tab: free-transfer count and the
 * position set to draw suggestions from.
 */

export type Position = {
  /** FPL element_type id (1=GKP, 2=DEF, 3=MID, 4=FWD). */
  id: number;
  /** Display label (e.g. "Defenders"). */
  label: string;
};

const FREE_TRANSFER_SEGMENTS: readonly SegmentOption<number>[] =
  FREE_TRANSFER_OPTIONS.map((n) => ({ value: n, label: String(n) }));

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The count hits are charged against. Undefined until the first
   *  response arrives with the derived count. */
  freeTransfers: number | undefined;
  derivedFreeTransfers: number | undefined;
  onChangeFreeTransfers: (n: number) => void;
  positions: readonly Position[];
  selectedPositions: readonly number[];
  onTogglePosition: (id: number) => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
};

export function TransferFilterDialog({
  visible,
  onClose,
  freeTransfers,
  derivedFreeTransfers,
  onChangeFreeTransfers,
  positions,
  selectedPositions,
  onTogglePosition,
  hasActiveFilters,
  onClearAll,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const freeTransfersHint =
    derivedFreeTransfers === undefined
      ? 'Loads with your suggestions.'
      : `Your FPL history says ${derivedFreeTransfers}. Adjust it if you've already made transfers this gameweek, since FPL doesn't show them until the deadline.`;
  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title="Filter"
      leftAction={{ label: 'Reset', onPress: onClearAll, disabled: !hasActiveFilters }}
      rightAction={{ label: 'Done', onPress: onClose }}
    >
      <Section title="Free transfers" hint={freeTransfersHint}>
        {freeTransfers === undefined ? null : (
          <View style={styles.dialogControlBody}>
            <SegmentedControl
              options={FREE_TRANSFER_SEGMENTS}
              value={freeTransfers}
              onChange={onChangeFreeTransfers}
            />
          </View>
        )}
      </Section>
      <Section
        title="Position"
        hint="Leave all unchecked to see suggestions across every position."
      >
        {positions.map((p) => (
          <CheckRow
            key={p.id}
            label={p.label}
            checked={selectedPositions.includes(p.id)}
            onPress={() => onTogglePosition(p.id)}
          />
        ))}
      </Section>
    </DialogShell>
  );
}
