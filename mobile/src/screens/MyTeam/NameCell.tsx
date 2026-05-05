import { Text, View } from 'react-native';
import { ClubBackground } from '../../components/ClubBackground';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';
import type { MyTeamRow } from './types';

/**
 * Renders the pinned-name-column contents for a My Team row. Bench
 * rows are de-emphasised by the table's getRowStyle (opacity 0.6);
 * this component is responsible for the name + badges + sub-line.
 */
export function MyTeamNameCell({ row }: { row: MyTeamRow }) {
  const styles = useThemedStyles(makeStyles);
  const subParts = [row.team, row.position];
  if (!row.isStarter) subParts.push('Bench');
  const subline = subParts.join(' · ');

  return (
    <>
      <ClubBackground teamShort={row.team} />
      <View style={styles.nameLine}>
        <View style={styles.textBackdrop}>
          <Text style={styles.nameText} numberOfLines={1}>
            {row.name}
          </Text>
        </View>
        {row.isCaptain ? (
          <Text style={styles.playerBadge} accessibilityLabel="captain">
            C
          </Text>
        ) : null}
        {row.isViceCaptain ? (
          <Text style={styles.playerBadge} accessibilityLabel="vice-captain">
            V
          </Text>
        ) : null}
      </View>
      <View style={styles.textBackdrop}>
        <Text style={styles.subText} numberOfLines={1}>
          {subline}
          {row.gwPoints != null ? `  ·  ${row.gwPoints} GW pts` : ''}
        </Text>
      </View>
    </>
  );
}
