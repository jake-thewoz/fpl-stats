import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getFplTeamId } from '../storage/user';

/** Tri-state representing the team-id slot:
 *   - `undefined`: read in flight (first render)
 *   - `null`: user hasn't set a team id
 *   - `string`: set to the FPL team id */
export type FocusedTeamId = string | null | undefined;

/**
 * Reads the user's FPL team id from storage every time the screen
 * gains focus. Re-reads on focus (not just mount) so a team-id
 * change in Settings propagates back to consumer screens without a
 * full app reload — that's the point of this hook.
 *
 * Replaces the hand-rolled `let alive = true` ceremony that
 * MyTeamScreen and TransfersScreen both repeated identically.
 */
export function useFocusedTeamId(): FocusedTeamId {
  const [teamId, setTeamId] = useState<FocusedTeamId>(undefined);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getFplTeamId().then((id) => {
        if (alive) setTeamId(id);
      });
      return () => {
        alive = false;
      };
    }, []),
  );
  return teamId;
}
