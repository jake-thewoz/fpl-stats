import type { SquadEntry } from '../../api/myTeam';
import type { LineupSlot } from './lineup';
import type { MyTeamRow } from './types';

export const EMPTY_SQUAD_MESSAGE = 'No squad data available yet for this gameweek.';

type PlayerXp = { xp: number; xp_h3: number | null; xp_h5: number | null };
type KnownPlayerEntry = SquadEntry & { player: NonNullable<SquadEntry['player']> };

/** Pitch tiles show this gameweek's points, captain multiplier included,
 *  matching the GW total in the header. */
export function gameweekPointsText(slot: LineupSlot): string {
  const points = slot.row.gwPoints;
  if (points == null) return '– pts';
  return points === 1 ? '1 pt' : `${points} pts`;
}

/** Squad entries as table/pitch rows. Players missing from `/players`
 *  are dropped; xP columns stay empty when `xpById` is omitted. */
export function squadRows(
  squad: readonly SquadEntry[],
  xpById?: ReadonlyMap<number, PlayerXp>,
): MyTeamRow[] {
  return squad
    .filter((s): s is KnownPlayerEntry => s.player != null)
    .map((s) => toMyTeamRow(s, xpById?.get(s.player.id)));
}

function toMyTeamRow(s: KnownPlayerEntry, xp: PlayerXp | undefined): MyTeamRow {
  const { player } = s;
  const formNum = parseFloat(player.form);
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    price: player.price,
    total_points: player.total_points,
    form: Number.isNaN(formNum) ? 0 : formNum,
    xp: xp?.xp ?? null,
    xp_h3: xp?.xp_h3 ?? null,
    xp_h5: xp?.xp_h5 ?? null,
    defcon: player.defcon,
    defcon_per_90: player.defcon_per_90,
    selected_by_percent: player.selected_by_percent,
    points_per_game: player.points_per_game,
    minutes: player.minutes,
    goals_scored: player.goals_scored,
    assists: player.assists,
    clean_sheets: player.clean_sheets,
    bonus: player.bonus,
    bps: player.bps,
    ict_index: player.ict_index,
    expected_goals: player.expected_goals,
    expected_assists: player.expected_assists,
    cost_change_event: player.cost_change_event,
    squadSlot: s.pick.position,
    isStarter: s.isStarter,
    isCaptain: s.pick.is_captain,
    isViceCaptain: s.pick.is_vice_captain,
    gwPoints: s.gwPoints,
  };
}
