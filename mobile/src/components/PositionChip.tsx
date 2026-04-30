/**
 * Small coloured chip for a player's position. Used in the player-list
 * sublines on My Team, Players, and Transfers — replaces the plain
 * "TEAM · POS · £price" text with "TEAM · [POS] · £price" so the
 * position pops at a glance.
 *
 * The four positions map to the FPL-classic earth-toned palette
 * declared in ``theme/colors.ts`` (GKP amber, DEF slate-blue, MID sage,
 * FWD terracotta). Background + text-colour pairs come from the theme,
 * so dark-mode variants flow through automatically.
 *
 * Falls back to a neutral muted style if it gets an unexpected position
 * string — defensive in case future ingest rewires the field, but in
 * practice ``JoinedPlayer.position`` is always one of the four.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles, type Colors } from '../theme';

type Props = {
  pos: string;
};

function positionTone(pos: string, c: Colors): { bg: string; fg: string } | null {
  switch (pos) {
    case 'GKP': return { bg: c.posGkp, fg: c.onPosGkp };
    case 'DEF': return { bg: c.posDef, fg: c.onPosDef };
    case 'MID': return { bg: c.posMid, fg: c.onPosMid };
    case 'FWD': return { bg: c.posFwd, fg: c.onPosFwd };
    default:    return null;
  }
}

export function PositionChip({ pos }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const tone = positionTone(pos, colors);
  const bg = tone?.bg ?? colors.border;
  const fg = tone?.fg ?? colors.textMuted;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }]}>{pos}</Text>
    </View>
  );
}

const makeStyles = (_c: Colors) =>
  StyleSheet.create({
    chip: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      alignSelf: 'flex-start',
    },
    chipText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
  });
