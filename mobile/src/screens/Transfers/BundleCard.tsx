import { Pressable, Text, View } from 'react-native';
import type { Player } from '../../api/players';
import type { TransferBundle } from '../../api/transferSuggestions';
import { useThemedStyles } from '../../theme';
import { CompareTable } from './CompareTable';
import { BankDeltaPill, CenterBadge, PlayerBlock } from './MoveRow';
import { makeStyles } from './styles';

/** Stable key for a bundle, joining out→in pairs. Kept stable across
 *  refreshes so an expanded card stays expanded if the same bundle is
 *  still in the list. */
export function bundleKey(bundle: TransferBundle): string {
  return bundle.moves
    .map((m) => `${m.out.player_id}-${m.in.player_id}`)
    .join('|');
}

export function BundleCard({
  bundle,
  playersById,
  isExpanded,
  onToggle,
}: {
  bundle: TransferBundle;
  playersById: Map<number, Player>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isMulti = bundle.num_transfers > 1;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityLabel={
        isExpanded ? 'Collapse bundle details' : 'Expand bundle details'
      }
    >
      {isMulti ? <BundleSummary bundle={bundle} /> : null}
      {bundle.moves.map((move, i) => (
        <View key={`${move.out.player_id}-${move.in.player_id}`}>
          {i > 0 ? <View style={styles.moveDivider} /> : null}
          <View style={styles.cardRow}>
            <PlayerBlock
              align="left"
              fallback={move.out.web_name}
              player={playersById.get(move.out.player_id)}
            />
            <CenterBadge
              deltaXp={move.delta_xp}
              costChange={move.cost_change}
            />
            <PlayerBlock
              align="right"
              fallback={move.in.web_name}
              player={playersById.get(move.in.player_id)}
            />
          </View>
        </View>
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

function BundleSummary({ bundle }: { bundle: TransferBundle }) {
  const styles = useThemedStyles(makeStyles);
  const positive = bundle.delta_xp_net >= 0;
  const netStr = `${positive ? '+' : ''}${bundle.delta_xp_net.toFixed(1)} xP`;
  return (
    <View style={styles.bundleSummary}>
      {/* Net xP gets the same sign-coloured-pill treatment as the
          per-move CenterBadge so the bundle headline is visually
          consistent with the moves it describes. Slightly larger
          font / padding to keep it the dominant element on the card. */}
      <View
        style={[
          styles.bundleSummaryNetPill,
          positive
            ? styles.bundleSummaryNetPillPositive
            : styles.bundleSummaryNetPillNegative,
        ]}
      >
        <Text
          style={[
            styles.bundleSummaryNetPillText,
            positive
              ? styles.bundleSummaryNetPillTextPositive
              : styles.bundleSummaryNetPillTextNegative,
          ]}
        >
          {netStr}
        </Text>
      </View>
      {/* Detail row: bank pill + (conditional) hit pill. The bundle's
          transfer count is implicit from the move stack rendered
          below, so the previous "N transfers" text has been dropped. */}
      <View style={styles.bundleSummaryDetailRow}>
        <BankDeltaPill costChange={bundle.total_cost_change} />
        {bundle.hit_cost > 0 ? <HitPill hitCost={bundle.hit_cost} /> : null}
      </View>
    </View>
  );
}

/** Small red pill showing the −N point hit cost on a multi-transfer
 *  bundle. Only rendered when ``hit_cost > 0``; the absence of the
 *  pill is the "no hit" signal. */
function HitPill({ hitCost }: { hitCost: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.bankDeltaPill, styles.bankDeltaPillNegative]}>
      <Text style={[styles.bankDeltaPillText, styles.bankDeltaPillTextNegative]}>
        −{hitCost} pts
      </Text>
    </View>
  );
}
