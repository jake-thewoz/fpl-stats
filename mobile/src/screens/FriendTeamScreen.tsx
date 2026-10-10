import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useMyTeam } from '../hooks/useMyTeam';
import { useQueryState } from '../hooks/useQueryState';
import { LoadingView } from '../components/LoadingView';
import { ErrorView } from '../components/ErrorView';
import type { FriendTeamScreenProps } from '../navigation/types';
import { useThemedStyles } from '../theme';
import { ChipBadge, Header, PicksUnavailableNote } from './MyTeam/Header';
import { lineupFromPicks } from './MyTeam/lineup';
import { PitchView } from './MyTeam/PitchView';
import { EMPTY_SQUAD_MESSAGE, gameweekPointsText, squadRows } from './MyTeam/rows';
import { makeStyles } from './MyTeam/styles';

type Props = FriendTeamScreenProps;

/** A friend's current squad on the pitch, as the FPL app shows it. */
export default function FriendTeamScreen({ route }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { teamId } = route.params;

  const teamQuery = useMyTeam(teamId, { freeHitFallback: false });
  const teamData = teamQuery.data;
  const data = useMemo(
    () =>
      teamData === undefined
        ? undefined
        : { team: teamData, lineup: lineupFromPicks(squadRows(teamData.squad)) },
    [teamData],
  );
  const { state, refreshing, onRefresh, onRetry } = useQueryState(
    teamQuery.queries,
    data,
  );

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') {
    return (
      <ErrorView
        title="Couldn't load this team"
        message={state.message}
        onRetry={onRetry}
      />
    );
  }

  const { team, lineup } = state.data;
  const activeChip = team.picks?.active_chip;
  const hasSquad = lineup.starters.length > 0;

  return (
    <View style={styles.container}>
      <Header entry={team.entry} gameweek={team.gameweek} />
      {team.picksError ? <PicksUnavailableNote message={team.picksError} /> : null}
      {activeChip ? <ChipBadge chip={activeChip} /> : null}
      {hasSquad ? (
        <PitchView
          lineup={lineup}
          getStatText={gameweekPointsText}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyBody}>{EMPTY_SQUAD_MESSAGE}</Text>
        </View>
      )}
    </View>
  );
}
