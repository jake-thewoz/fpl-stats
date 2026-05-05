import type { JoinedPlayer } from '../../players/types';

/** Per-row decoration data that's My-Team-specific (captain/bench/this
 *  GW points). Lives alongside the shared JoinedPlayer fields rather
 *  than baking them into the cross-screen type. */
export type MyTeamRow = JoinedPlayer & {
  isStarter: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  /** This GW's contribution to the team total (raw × multiplier).
   *  null when live data hasn't arrived yet. */
  gwPoints: number | null;
};
