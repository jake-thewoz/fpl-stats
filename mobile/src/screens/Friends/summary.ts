/**
 * What the Friends hero and award tags say about everyone's loaded
 * entries. Pure, so the rules (who gets a tag, what "average" means) are
 * tested without rendering.
 *
 * The comparison celebrates people rather than ranking them: awards go to
 * whoever stands out on a stat, ties share them, and nobody gets a
 * position number.
 */
import type { Entry } from '../../api/entry';

export type LoadedTeam = {
  id: string;
  isMe: boolean;
  entry: Entry;
};

export type AwardKind =
  | 'topGameweek'
  | 'bestRank'
  | 'biggestSquad'
  | 'mostTransfers'
  | 'fewestTransfers';

/** In the order a row shows its tags; the first that fits is the one
 *  people see on a narrow screen. */
export const AWARD_ORDER: readonly AwardKind[] = [
  'topGameweek',
  'bestRank',
  'biggestSquad',
  'mostTransfers',
  'fewestTransfers',
];

/** Fewer teams than this and there's nobody to compare against. */
export const MIN_TEAMS_TO_COMPARE = 2;

/** FPL sends squad value in tenths of a million. */
const VALUE_UNITS_PER_MILLION = 10;

export type StripScore = {
  id: string;
  initials: string;
  points: number;
  isMe: boolean;
};

export type GameweekSummary = {
  /** Lowest score first, for plotting along a line. */
  scores: StripScore[];
  top: { team: LoadedTeam; points: number };
  /** Your score; null when your team isn't in the list. */
  myPoints: number | null;
  /** Your friends' mean, leaving you out so you're compared with them. */
  friendsAverage: number | null;
};

export type Spotlight = {
  kind: 'bestRank' | 'biggestSquad' | 'mostTransfers';
  /** The first of any tied winners. */
  team: LoadedTeam;
  value: number;
};

type Stat = (entry: Entry) => number | null;

const STATS: Record<AwardKind, { stat: Stat; best: 'high' | 'low' }> = {
  topGameweek: { stat: (e) => e.summary_event_points, best: 'high' },
  bestRank: { stat: (e) => e.summary_overall_rank, best: 'low' },
  biggestSquad: { stat: squadValueMillions, best: 'high' },
  mostTransfers: { stat: (e) => e.last_deadline_total_transfers, best: 'high' },
  fewestTransfers: { stat: (e) => e.last_deadline_total_transfers, best: 'low' },
};

export function squadValueMillions(entry: Entry): number | null {
  const value = entry.last_deadline_value;
  return value == null ? null : value / VALUE_UNITS_PER_MILLION;
}

/** "Ana Ruiz" → "Ana R.". Falls back to the squad name when FPL sends
 *  no manager name. */
export function shortManagerName(entry: Entry): string {
  const first = entry.player_first_name.trim();
  const last = entry.player_last_name.trim();
  if (!first && !last) return entry.name;
  if (!last) return first;
  if (!first) return last;
  return `${first} ${last[0]}.`;
}

/** "Ana Ruiz" → "AR"; a single name gives its first two letters. */
export function managerInitials(entry: Entry): string {
  const words = `${entry.player_first_name} ${entry.player_last_name}`
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const source = words.length > 0 ? words : [entry.name];
  const initials =
    source.length === 1
      ? source[0].slice(0, 2)
      : `${source[0][0]}${source[source.length - 1][0]}`;
  return initials.toUpperCase();
}

/** Everyone who holds the best value of a stat. Empty when fewer than
 *  `MIN_TEAMS_TO_COMPARE` teams have the stat, or when they all tie,
 *  since then nobody stands out. */
export function winners(teams: readonly LoadedTeam[], kind: AwardKind): LoadedTeam[] {
  const { stat, best } = STATS[kind];
  const rated = teams
    .map((team) => ({ team, value: stat(team.entry) }))
    .filter((r): r is { team: LoadedTeam; value: number } => r.value != null);
  if (rated.length < MIN_TEAMS_TO_COMPARE) return [];
  const values = rated.map((r) => r.value);
  const target = best === 'high' ? Math.max(...values) : Math.min(...values);
  const holders = rated.filter((r) => r.value === target);
  if (holders.length === rated.length) return [];
  return holders.map((r) => r.team);
}

/** Each team's awards, in `AWARD_ORDER`. Teams with none are absent. */
export function awardsByTeam(teams: readonly LoadedTeam[]): Map<string, AwardKind[]> {
  const awards = new Map<string, AwardKind[]>();
  for (const kind of AWARD_ORDER) {
    for (const team of winners(teams, kind)) {
      awards.set(team.id, [...(awards.get(team.id) ?? []), kind]);
    }
  }
  return awards;
}

export function gameweekSummary(teams: readonly LoadedTeam[]): GameweekSummary | null {
  const scored = teams
    .map((team) => ({ team, points: team.entry.summary_event_points }))
    .filter((s): s is { team: LoadedTeam; points: number } => s.points != null);
  if (scored.length < MIN_TEAMS_TO_COMPARE) return null;

  const top = scored.reduce((best, s) => (s.points > best.points ? s : best));
  const mine = scored.find((s) => s.team.isMe);
  const friends = scored.filter((s) => !s.team.isMe);
  const friendsAverage =
    friends.length === 0
      ? null
      : friends.reduce((sum, s) => sum + s.points, 0) / friends.length;

  return {
    scores: scored
      .map((s) => ({
        id: s.team.id,
        initials: managerInitials(s.team.entry),
        points: s.points,
        isMe: s.team.isMe,
      }))
      .sort((a, b) => a.points - b.points),
    top,
    myPoints: mine?.points ?? null,
    friendsAverage,
  };
}

const SPOTLIGHT_KINDS: readonly Spotlight['kind'][] = [
  'bestRank',
  'biggestSquad',
  'mostTransfers',
];

/** The season cards: one per stat that has a standout. */
export function spotlights(teams: readonly LoadedTeam[]): Spotlight[] {
  return SPOTLIGHT_KINDS.flatMap((kind) => {
    const [team] = winners(teams, kind);
    const value = team == null ? null : STATS[kind].stat(team.entry);
    return team == null || value == null ? [] : [{ kind, team, value }];
  });
}
