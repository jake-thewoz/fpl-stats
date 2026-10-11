import { Text } from '../../components/Text';
import { PlayerNameCell } from '../../components/PlayerNameCell';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';
import type { MyTeamRow } from './types';

/**
 * Renders the pinned-name-column contents for a My Team row. Bench
 * rows are de-emphasised by the table's getRowStyle (opacity 0.6);
 * this component adds the captain badges and the bench / GW points
 * sub-line.
 */
export function MyTeamNameCell({ row }: { row: MyTeamRow }) {
  const styles = useThemedStyles(makeStyles);
  const subParts = [row.team, row.position];
  if (!row.isStarter) subParts.push('Bench');
  if (row.gwPoints != null) subParts.push(`${row.gwPoints} GW pts`);

  return (
    <PlayerNameCell
      team={row.team}
      name={row.name}
      subline={subParts.join(' · ')}
      badges={
        <>
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
        </>
      }
    />
  );
}
