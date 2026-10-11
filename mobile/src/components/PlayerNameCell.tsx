import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ClubShirt, CLUB_SHIRT_SIZE } from './ClubShirt';
import { MatchStatusGlyph } from '../gameweek/MatchStatusGlyph';
import { fontSize, spacing, useThemedStyles, type Colors } from '../theme';

type Props = {
  team: string;
  name: string;
  /** Second line, e.g. "ARS · MID". */
  subline: string;
  /** Extra markers after the name, e.g. My Team's captain badge. */
  badges?: ReactNode;
};

/** Pinned name column of a `PlayerListTable` row: club shirt, name, subline. */
export function PlayerNameCell({ team, name, subline, badges }: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row}>
      <ClubShirt teamShort={team} size={CLUB_SHIRT_SIZE.listRow} />
      <View style={styles.text}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            <MatchStatusGlyph teamShort={team} />
            {name}
          </Text>
          {badges}
        </View>
        <Text style={styles.subline} numberOfLines={1}>
          {subline}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    // minWidth 0 lets the name ellipsize instead of pushing past the column.
    text: { flex: 1, minWidth: 0 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    name: {
      flexShrink: 1,
      fontSize: fontSize.base,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    subline: {
      fontSize: fontSize.sm,
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
  });
