import { View } from 'react-native';
import { Text } from '../../components/Text';
import { ClubShirt, CLUB_SHIRT_SIZE } from '../../components/ClubShirt';
import type { Player } from '../../api/players';
import type { TransferMove } from '../../api/transferSuggestions';
import { useThemedStyles } from '../../theme';
import { formatBankDelta, formatXpDelta } from '../../transfers/format';
import { makeStyles } from './styles';

/**
 * One transfer as OUT → IN: the player sold on a coral tile, the player
 * bought on a mint tile, and the move's xP gain and bank change between.
 */
export function MoveRow({
  move,
  playersById,
}: {
  move: TransferMove;
  playersById: Map<number, Player>;
}) {
  const styles = useThemedStyles(makeStyles);
  const positive = move.delta_xp >= 0;

  return (
    <View style={styles.moveRow}>
      <PlayerTile
        side="out"
        fallback={move.out.web_name}
        player={playersById.get(move.out.player_id)}
      />
      <View style={styles.moveDelta}>
        <Text
          style={[styles.moveDeltaXp, positive ? styles.goodText : styles.badText]}
          accessibilityLabel={`${formatXpDelta(move.delta_xp)} expected points`}
        >
          {formatXpDelta(move.delta_xp)}
        </Text>
        <Text style={styles.moveDeltaBank}>{formatBankDelta(move.cost_change)}</Text>
      </View>
      <PlayerTile
        side="in"
        fallback={move.in.web_name}
        player={playersById.get(move.in.player_id)}
      />
    </View>
  );
}

/** Shirt + name + "club · pos · £" on a tile tinted by direction. The
 *  "in" tile mirrors the layout so both shirts sit on the outer edges. */
function PlayerTile({
  side,
  fallback,
  player,
}: {
  side: 'out' | 'in';
  fallback: string;
  player: Player | undefined;
}) {
  const styles = useThemedStyles(makeStyles);

  const team = player?.team ?? '';
  const sub = [team, player?.position, player ? `£${player.price.toFixed(1)}m` : null]
    .filter(Boolean)
    .join(' · ');
  const isIn = side === 'in';

  return (
    <View
      style={[styles.playerTile, isIn ? styles.playerTileIn : styles.playerTileOut]}
      accessibilityLabel={`${isIn ? 'Buy' : 'Sell'} ${player?.name ?? fallback}`}
    >
      <ClubShirt teamShort={team} size={CLUB_SHIRT_SIZE.listRow} />
      <View style={[styles.playerText, isIn && styles.playerTextIn]}>
        <Text style={styles.playerName} numberOfLines={1}>
          {player?.name ?? fallback}
        </Text>
        <Text style={styles.playerSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </View>
  );
}
