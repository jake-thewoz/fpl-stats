import { Pressable, View } from 'react-native';
import { Text } from '../../components/Text';
import type { Player } from '../../api/players';
import type { TransferBundle } from '../../api/transferSuggestions';
import { useThemedStyles } from '../../theme';
import { CompareTable } from './CompareTable';
import { bankDelta, formatBankDelta, formatXpDelta } from '../../transfers/format';
import { MoveRow } from './MoveRow';
import { makeStyles } from './styles';

/** Stable key for a bundle, joining out→in pairs. Kept stable across
 *  refreshes so an expanded card stays expanded if the same bundle is
 *  still in the list. */
export function bundleKey(bundle: TransferBundle): string {
  return bundle.moves.map((m) => `${m.out.player_id}-${m.in.player_id}`).join('|');
}

export function BundleCard({
  bundle,
  playersById,
  isTopRanked,
  isExpanded,
  onToggle,
}: {
  bundle: TransferBundle;
  playersById: Map<number, Player>;
  /** The best suggestion in the list, which gets a mint border. */
  isTopRanked: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isMulti = bundle.num_transfers > 1;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.card,
        isTopRanked && styles.cardTopRanked,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityLabel={
        isExpanded ? 'Collapse bundle details' : 'Expand bundle details'
      }
    >
      <BundleSummary bundle={bundle} />
      {bundle.moves.map((move) => (
        <MoveRow
          key={`${move.out.player_id}-${move.in.player_id}`}
          move={move}
          playersById={playersById}
        />
      ))}
      <View style={styles.chevronRow}>
        <Text style={styles.chevron}>{isExpanded ? '▴' : '▾'}</Text>
      </View>
      {isExpanded
        ? bundle.moves.map((move, i) => (
            <View key={`compare-${move.out.player_id}-${move.in.player_id}`}>
              {isMulti ? (
                <Text style={styles.compareMoveLabel}>
                  Move {i + 1}: {move.out.web_name} → {move.in.web_name}
                </Text>
              ) : null}
              <CompareTable move={move} />
            </View>
          ))
        : null}
    </Pressable>
  );
}

/** The card's headline: net xP gain, then what it costs in bank and hits. */
function BundleSummary({ bundle }: { bundle: TransferBundle }) {
  const styles = useThemedStyles(makeStyles);
  const positive = bundle.delta_xp_net >= 0;
  const bank = bankDelta(bundle.total_cost_change);

  return (
    <View style={styles.bundleSummary}>
      <Text style={[styles.netXp, positive ? styles.goodText : styles.badText]}>
        {formatXpDelta(bundle.delta_xp_net)}
      </Text>
      <Text style={styles.netXpLabel}>xP net</Text>
      <View style={styles.costChips}>
        <CostChip
          label={`Bank ${formatBankDelta(bundle.total_cost_change)}`}
          tone={bank > 0 ? 'good' : bank < 0 ? 'bad' : 'neutral'}
        />
        {/* No chip when there's no hit: its absence is the signal. */}
        {bundle.hit_cost > 0 ? (
          <CostChip label={`Hit −${bundle.hit_cost}`} tone="bad" />
        ) : null}
      </View>
    </View>
  );
}

function CostChip({ label, tone }: { label: string; tone: 'good' | 'bad' | 'neutral' }) {
  const styles = useThemedStyles(makeStyles);
  const toneStyle =
    tone === 'good'
      ? styles.costChipGood
      : tone === 'bad'
        ? styles.costChipBad
        : styles.costChipNeutral;
  return <Text style={[styles.costChip, toneStyle]}>{label}</Text>;
}
