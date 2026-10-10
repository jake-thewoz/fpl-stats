import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { assembleMyTeam, needsPreviousPicks, type MyTeamData } from '../api/myTeam';
import {
  entryGameweekQuery,
  entryQuery,
  gameweekLiveQuery,
  playersQuery,
} from '../query/queries';

// Placeholders for dependent queries' keys while their inputs are
// unknown; the queries are disabled until the real values arrive.
const NO_TEAM_ID = '';
const NO_GAMEWEEK = 0;

export type MyTeamOptions = {
  /** Show last gameweek's squad instead of a Free Hit eleven, so the
   *  user can plan around their persistent team. Off when viewing a
   *  friend's squad, where the eleven actually playing is the point. */
  freeHitFallback?: boolean;
};

export type MyTeamQuery = {
  data: MyTeamData | undefined;
  /** Every query the view is built from, for refresh / retry / errors. */
  queries: UseQueryResult<unknown, Error>[];
};

/**
 * The user's squad for the current gameweek, joined with player data and
 * live points. Picks and live points wait on the entry (it names the
 * current gameweek); the previous gameweek's picks are only fetched when
 * Free Hit is active and `freeHitFallback` is on (the default). Pass
 * `null` for no team: every query stays idle.
 */
export function useMyTeam(
  teamId: string | null,
  { freeHitFallback = true }: MyTeamOptions = {},
): MyTeamQuery {
  const hasTeam = teamId != null;
  const entry = useQuery({ ...entryQuery(teamId ?? NO_TEAM_ID), enabled: hasTeam });
  const players = useQuery({ ...playersQuery(), enabled: hasTeam });

  const gameweek = entry.data?.entry.current_event ?? null;
  const hasGameweek = hasTeam && gameweek != null;
  const picks = useQuery({
    ...entryGameweekQuery(teamId ?? NO_TEAM_ID, gameweek ?? NO_GAMEWEEK),
    enabled: hasGameweek,
  });
  const live = useQuery({
    ...gameweekLiveQuery(gameweek ?? NO_GAMEWEEK),
    enabled: hasGameweek,
  });
  const previousGameweek = (gameweek ?? NO_GAMEWEEK) - 1;
  const previousPicks = useQuery({
    ...entryGameweekQuery(teamId ?? NO_TEAM_ID, previousGameweek),
    enabled:
      freeHitFallback &&
      hasGameweek &&
      needsPreviousPicks(picks.data, gameweek ?? NO_GAMEWEEK),
  });

  const data = useMemo(
    () =>
      assembleMyTeam({
        entry,
        players,
        picks,
        live,
        previousPicks: freeHitFallback ? previousPicks : null,
      }),
    // Each result object is new every render; its data and error are
    // what the assembly actually reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      entry.data,
      entry.error,
      players.data,
      players.error,
      picks.data,
      picks.error,
      live.data,
      live.error,
      previousPicks.data,
      previousPicks.error,
      freeHitFallback,
    ],
  );

  return { data, queries: [entry, players, picks, live, previousPicks] };
}
