import { Text, View } from 'react-native';
import { ClubBackground } from '../../components/ClubBackground';
import type { Player } from '../../api/players';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';

/**
 * Left or right "name + team · pos · price" block in a move row.
 * Carries the club-coloured gradient backdrop; the right-aligned variant
 * mirrors the gradient so both halves of the row fade toward the centre.
 */
export function PlayerBlock({
  align,
  fallback,
  player,
}: {
  align: 'left' | 'right';
  fallback: string;
  player: Player | undefined;
}) {
  const styles = useThemedStyles(makeStyles);

  const name = player?.name ?? fallback;
  const team = player?.team ?? '';
  const position = player?.position ?? '';
  const price = player?.price;
  const sub = [team, position, price ? `£${price.toFixed(1)}m` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[
        styles.playerBlock,
        align === 'right' ? styles.playerBlockRight : styles.playerBlockLeft,
      ]}
    >
      {team ? <ClubBackground teamShort={team} mirror={align === 'right'} /> : null}
      <View style={styles.playerTextBackdrop}>
        <Text style={styles.playerName} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={styles.playerTextBackdrop}>
        <Text style={styles.playerSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

/** Centre column of a move row: arrow + xP-delta pill + bank-delta pill. */
export function CenterBadge({
  deltaXp,
  costChange,
}: {
  deltaXp: number;
  costChange: number;
}) {
  const styles = useThemedStyles(makeStyles);

  const xpStr = `${deltaXp >= 0 ? '+' : ''}${deltaXp.toFixed(1)} xP`;
  // 0.0 ties to positive (matches "+0.0" sign).
  const positive = deltaXp >= 0;

  return (
    <View style={styles.center}>
      <View style={styles.arrowRow}>
        <Text style={styles.arrowText}>→</Text>
      </View>
      {/* xP delta pill is sign-coloured: sage for positive moves, red
          for negative. Mostly the bundle-net positives, but per-move
          deltas inside a multi-move bundle can go negative — the pill
          colour gives that move's contribution at a glance. */}
      <View
        style={[
          styles.deltaXpPill,
          positive ? styles.deltaXpPillPositive : styles.deltaXpPillNegative,
        ]}
      >
        <Text
          style={[
            styles.deltaXpPillText,
            positive ? styles.deltaXpPillTextPositive : styles.deltaXpPillTextNegative,
          ]}
        >
          {xpStr}
        </Text>
      </View>
      <BankDeltaPill costChange={costChange} />
    </View>
  );
}

/**
 * Bank-delta pill used by both per-move CenterBadge and bundle-level
 * BundleSummary. ``costChange`` is FPL's API form (positive = swap costs
 * money). We negate for display so the pill reads as the user's bank
 * delta: positive = "you gained money".
 *
 * - Gain → sage / accentSoft (matches the positive delta-xP pill).
 * - Loss → red / danger.
 * - £0.0 → muted text without a tinted background, since neither
 *   "good" nor "bad" applies to a wash trade.
 */
export function BankDeltaPill({ costChange }: { costChange: number }) {
  const styles = useThemedStyles(makeStyles);
  const bankDelta = -costChange / 10;
  const text =
    bankDelta === 0
      ? '£0.0'
      : `${bankDelta > 0 ? '+' : '−'}£${Math.abs(bankDelta).toFixed(1)}m`;
  if (bankDelta === 0) {
    return <Text style={styles.bankDeltaNeutral}>{text}</Text>;
  }
  const positive = bankDelta > 0;
  return (
    <View
      style={[
        styles.bankDeltaPill,
        positive ? styles.bankDeltaPillPositive : styles.bankDeltaPillNegative,
      ]}
    >
      <Text
        style={[
          styles.bankDeltaPillText,
          positive ? styles.bankDeltaPillTextPositive : styles.bankDeltaPillTextNegative,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
