/**
 * Field metadata shared by both screens. Adding a new column/filter is one
 * entry here — both screens pick it up automatically.
 */
import type { PlayerStatKey } from '../api/playerStats';
import { gameweekRangeLabel } from '../fixtures/upcoming';
import { formatCompact } from '../format/rank';
import { HEAT_CEILING } from '../theme/heat';
import type { FieldKey, JoinedPlayer, SortDir } from './types';

export type FieldDef = {
  key: FieldKey;
  /** Long label for picker rows ("Expected points"). */
  label: string;
  /** Short label for column headers ("xP"). */
  shortLabel: string;
  /** One plain-English sentence for someone new to FPL stats. */
  description: string;
  /** Default sort direction the first time the user taps this column. */
  defaultSortDir: SortDir;
  /** Read the value off a JoinedPlayer for sort/filter/format. */
  accessor: (p: JoinedPlayer) => number | null;
  /** Render a cell value as a string. */
  format: (value: number | null) => string;
};

const fmtNumber = (v: number | null): string => (v == null ? '—' : v.toFixed(1));
// Per-90 rates are mostly below 1 (an elite forward's xG/90 is ~0.6), so
// one decimal place would flatten them.
const PER_90_DECIMALS = 2;
const fmtPer90 = (v: number | null): string =>
  v == null ? '—' : v.toFixed(PER_90_DECIMALS);
const fmtPrice = (v: number | null): string => (v == null ? '—' : `£${v.toFixed(1)}`);
const fmtInt = (v: number | null): string => (v == null ? '—' : String(v));
const fmtPercent = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);
// Cost change: signed £m delta. +0.1 / -0.2 / 0.0
const fmtCostChange = (v: number | null): string => {
  if (v == null) return '—';
  if (v === 0) return '£0.0';
  const sign = v > 0 ? '+' : '−';
  return `${sign}£${Math.abs(v).toFixed(1)}`;
};

type StatFieldSpec = Omit<FieldDef, 'key' | 'accessor' | 'defaultSortDir'> & {
  defaultSortDir?: SortDir;
};

/** Columns read from `/players/stats`, which are blank until it loads. */
const STAT_FIELD_SPECS: Record<PlayerStatKey, StatFieldSpec> = {
  event_points: {
    label: 'Gameweek points',
    shortLabel: 'GW pts',
    description: 'FPL points scored in the current gameweek.',
    format: fmtInt,
  },
  dreamteam_count: {
    label: 'Dream Team appearances',
    shortLabel: 'DT',
    description: "Times the player has made FPL's Team of the Week.",
    format: fmtInt,
  },
  ep_next: {
    label: "FPL's expected points",
    shortLabel: 'FPL xP',
    description:
      "FPL's own points prediction for the next gameweek, for comparison with this app's xP.",
    format: fmtNumber,
  },
  expected_goal_involvements: {
    label: 'Expected goal involvements',
    shortLabel: 'xGI',
    description: 'Expected goals plus expected assists this season.',
    format: fmtNumber,
  },
  expected_goals_per_90: {
    label: 'Expected goals per 90',
    shortLabel: 'xG/90',
    description: 'Expected goals per 90 minutes played.',
    format: fmtPer90,
  },
  expected_assists_per_90: {
    label: 'Expected assists per 90',
    shortLabel: 'xA/90',
    description: 'Expected assists per 90 minutes played.',
    format: fmtPer90,
  },
  expected_goal_involvements_per_90: {
    label: 'Expected goal involvements per 90',
    shortLabel: 'xGI/90',
    description: 'Expected goals plus expected assists per 90 minutes played.',
    format: fmtPer90,
  },
  penalties_missed: {
    label: 'Penalties missed',
    shortLabel: 'PM',
    description: 'Penalties missed this season. Each costs 2 points.',
    format: fmtInt,
  },
  goals_conceded: {
    label: 'Goals conceded',
    shortLabel: 'GC',
    description:
      'Goals conceded while the player was on the pitch. Goalkeepers and defenders lose a point for every two.',
    defaultSortDir: 'asc',
    format: fmtInt,
  },
  goals_conceded_per_90: {
    label: 'Goals conceded per 90',
    shortLabel: 'GC/90',
    description: 'Goals conceded per 90 minutes on the pitch.',
    defaultSortDir: 'asc',
    format: fmtPer90,
  },
  expected_goals_conceded: {
    label: 'Expected goals conceded',
    shortLabel: 'xGC',
    description:
      'How many goals the chances against the team would usually produce while the player was on the pitch.',
    defaultSortDir: 'asc',
    format: fmtNumber,
  },
  expected_goals_conceded_per_90: {
    label: 'Expected goals conceded per 90',
    shortLabel: 'xGC/90',
    description: 'Expected goals conceded per 90 minutes on the pitch.',
    defaultSortDir: 'asc',
    format: fmtPer90,
  },
  clean_sheets_per_90: {
    label: 'Clean sheets per 90',
    shortLabel: 'CS/90',
    description: 'Clean sheets per 90 minutes played.',
    format: fmtPer90,
  },
  saves: {
    label: 'Saves',
    shortLabel: 'Saves',
    description: 'Saves this season. Goalkeepers earn a point for every three.',
    format: fmtInt,
  },
  saves_per_90: {
    label: 'Saves per 90',
    shortLabel: 'Sv/90',
    description: 'Saves per 90 minutes played.',
    format: fmtPer90,
  },
  penalties_saved: {
    label: 'Penalties saved',
    shortLabel: 'PS',
    description: 'Penalties saved this season. Each earns 5 points.',
    format: fmtInt,
  },
  own_goals: {
    label: 'Own goals',
    shortLabel: 'OG',
    description: 'Own goals this season. Each costs 2 points.',
    format: fmtInt,
  },
  tackles: {
    label: 'Tackles',
    shortLabel: 'Tkl',
    description: 'Tackles this season, one part of defensive contributions.',
    format: fmtInt,
  },
  clearances_blocks_interceptions: {
    label: 'Clearances, blocks and interceptions',
    shortLabel: 'CBI',
    description:
      'Clearances, blocks and interceptions this season, the main part of defensive contributions.',
    format: fmtInt,
  },
  recoveries: {
    label: 'Recoveries',
    shortLabel: 'Rec',
    description:
      'Balls won back this season. They count towards defensive contributions for midfielders and forwards.',
    format: fmtInt,
  },
  starts: {
    label: 'Starts',
    shortLabel: 'Starts',
    description: 'Matches started this season.',
    format: fmtInt,
  },
  starts_per_90: {
    label: 'Starts per 90',
    shortLabel: 'St/90',
    description:
      'Starts per 90 minutes played. Near 1 means a regular starter; well above 1 means they tend to come off early.',
    format: fmtPer90,
  },
  yellow_cards: {
    label: 'Yellow cards',
    shortLabel: 'YC',
    description: 'Yellow cards this season. Each costs a point.',
    defaultSortDir: 'asc',
    format: fmtInt,
  },
  red_cards: {
    label: 'Red cards',
    shortLabel: 'RC',
    description: 'Red cards this season. Each costs 3 points.',
    defaultSortDir: 'asc',
    format: fmtInt,
  },
  influence: {
    label: 'Influence',
    shortLabel: 'Inf',
    description:
      "FPL's rating of a player's impact on matches: goals, assists, key defensive actions. The I in ICT.",
    format: fmtNumber,
  },
  creativity: {
    label: 'Creativity',
    shortLabel: 'Cre',
    description:
      "FPL's rating of how many chances a player creates for others. The C in ICT.",
    format: fmtNumber,
  },
  threat: {
    label: 'Threat',
    shortLabel: 'Thr',
    description: "FPL's rating of how often a player threatens to score. The T in ICT.",
    format: fmtNumber,
  },
  transfers_in: {
    label: 'Transfers in (season)',
    shortLabel: 'In',
    description: 'Times managers have bought the player this season.',
    format: formatCompact,
  },
  transfers_out: {
    label: 'Transfers out (season)',
    shortLabel: 'Out',
    description: 'Times managers have sold the player this season.',
    format: formatCompact,
  },
  transfers_in_event: {
    label: 'Transfers in (this GW)',
    shortLabel: 'In GW',
    description:
      'Times managers have bought the player this gameweek. Heavy buying pushes the price up.',
    format: formatCompact,
  },
  transfers_out_event: {
    label: 'Transfers out (this GW)',
    shortLabel: 'Out GW',
    description:
      'Times managers have sold the player this gameweek. Heavy selling pushes the price down.',
    format: formatCompact,
  },
  cost_change_start: {
    label: 'Price change (season)',
    shortLabel: 'Δ£ ssn',
    description: 'How much the price has moved since the start of the season.',
    format: fmtCostChange,
  },
  value_form: {
    label: 'Value (form)',
    shortLabel: 'Val F',
    description: 'Form divided by price: recent points per million.',
    format: fmtNumber,
  },
  value_season: {
    label: 'Value (season)',
    shortLabel: 'Val S',
    description: 'Total points divided by price: season points per million.',
    format: fmtNumber,
  },
};

const STAT_FIELD_DEFS = Object.fromEntries(
  Object.entries(STAT_FIELD_SPECS).map(([key, spec]) => {
    const statKey = key as PlayerStatKey;
    const def: FieldDef = {
      defaultSortDir: 'desc',
      ...spec,
      key: statKey,
      accessor: (p) => p.stats?.[statKey] ?? null,
    };
    return [statKey, def];
  }),
) as Record<PlayerStatKey, FieldDef>;

export const FIELD_DEFS: Record<FieldKey, FieldDef> = {
  ...STAT_FIELD_DEFS,
  xp: {
    key: 'xp',
    label: 'Expected points (next GW)',
    shortLabel: 'xP',
    description: 'Points our model expects the player to score in the next gameweek.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp,
    format: fmtNumber,
  },
  xp_h3: {
    key: 'xp_h3',
    label: 'Expected points (next 3 GWs)',
    shortLabel: 'xP·3',
    description: 'Expected points added up over the next three gameweeks.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h3,
    format: fmtNumber,
  },
  xp_h5: {
    key: 'xp_h5',
    label: 'Expected points (next 5 GWs)',
    shortLabel: 'xP·5',
    description: 'Expected points added up over the next five gameweeks.',
    defaultSortDir: 'desc',
    accessor: (p) => p.xp_h5,
    format: fmtNumber,
  },
  fixtures: {
    key: 'fixtures',
    label: 'Fixtures (next 3 GWs)',
    shortLabel: 'Next 3',
    description:
      "The next three opponents, coloured by FPL's difficulty rating from easy (mint) to hard (coral). Capitals mean a home game. Sorting and filtering use the average rating, with a blank gameweek counted as the hardest.",
    defaultSortDir: 'asc',
    accessor: (p) => p.fixture_difficulty,
    format: fmtNumber,
  },
  form: {
    key: 'form',
    label: 'Form',
    shortLabel: 'Form',
    description: "FPL's average points per game over the last 30 days.",
    defaultSortDir: 'desc',
    accessor: (p) => p.form,
    format: fmtNumber,
  },
  price: {
    key: 'price',
    label: 'Price',
    shortLabel: 'Price',
    description: 'Current FPL price, in millions.',
    defaultSortDir: 'desc',
    accessor: (p) => p.price,
    format: fmtPrice,
  },
  total_points: {
    key: 'total_points',
    label: 'Total points',
    shortLabel: 'Points',
    description: 'FPL points scored so far this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.total_points,
    format: fmtInt,
  },
  defcon: {
    key: 'defcon',
    label: 'Defensive contributions',
    shortLabel: 'Defcon',
    description:
      'Defensive contributions this season: tackles, blocks, interceptions and clearances (plus recoveries for midfielders and forwards). Enough in one match earns 2 points.',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon,
    format: fmtInt,
  },
  defcon_per_90: {
    key: 'defcon_per_90',
    label: 'Defcon per 90',
    shortLabel: 'Defcon/90',
    description:
      'Defensive contributions per 90 minutes played, so part-time players compare fairly.',
    defaultSortDir: 'desc',
    accessor: (p) => p.defcon_per_90,
    format: fmtNumber,
  },
  points_per_game: {
    key: 'points_per_game',
    label: 'Points per game',
    shortLabel: 'PPG',
    description: 'Average FPL points per appearance this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.points_per_game,
    format: fmtNumber,
  },
  selected_by_percent: {
    key: 'selected_by_percent',
    label: 'Selected by %',
    shortLabel: 'Sel %',
    description: 'Share of all FPL managers who own the player.',
    defaultSortDir: 'desc',
    accessor: (p) => p.selected_by_percent,
    format: fmtPercent,
  },
  minutes: {
    key: 'minutes',
    label: 'Minutes',
    shortLabel: 'Mins',
    description: 'Minutes played this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.minutes,
    format: fmtInt,
  },
  goals_scored: {
    key: 'goals_scored',
    label: 'Goals',
    shortLabel: 'G',
    description: 'Goals scored this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.goals_scored,
    format: fmtInt,
  },
  assists: {
    key: 'assists',
    label: 'Assists',
    shortLabel: 'A',
    description: 'Assists this season.',
    defaultSortDir: 'desc',
    accessor: (p) => p.assists,
    format: fmtInt,
  },
  clean_sheets: {
    key: 'clean_sheets',
    label: 'Clean sheets',
    shortLabel: 'CS',
    description:
      "Matches this season where the player's team conceded nothing while they played 60+ minutes.",
    defaultSortDir: 'desc',
    accessor: (p) => p.clean_sheets,
    format: fmtInt,
  },
  bonus: {
    key: 'bonus',
    label: 'Bonus points',
    shortLabel: 'Bonus',
    description:
      'Bonus points earned this season. The top three performers in each match get 3, 2 and 1.',
    defaultSortDir: 'desc',
    accessor: (p) => p.bonus,
    format: fmtInt,
  },
  bps: {
    key: 'bps',
    label: 'BPS',
    shortLabel: 'BPS',
    description:
      "Bonus Points System score: FPL's per-match performance rating that decides who gets bonus points.",
    defaultSortDir: 'desc',
    accessor: (p) => p.bps,
    format: fmtInt,
  },
  ict_index: {
    key: 'ict_index',
    label: 'ICT index',
    shortLabel: 'ICT',
    description:
      "FPL's Influence, Creativity and Threat index, a rating of attacking involvement.",
    defaultSortDir: 'desc',
    accessor: (p) => p.ict_index,
    format: fmtNumber,
  },
  expected_goals: {
    key: 'expected_goals',
    label: 'Expected goals',
    shortLabel: 'xG',
    description:
      "Expected goals: how many goals the player's shots would usually produce.",
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_goals,
    format: fmtNumber,
  },
  expected_assists: {
    key: 'expected_assists',
    label: 'Expected assists',
    shortLabel: 'xA',
    description:
      "Expected assists: how many assists the player's passes would usually produce.",
    defaultSortDir: 'desc',
    accessor: (p) => p.expected_assists,
    format: fmtNumber,
  },
  cost_change_event: {
    key: 'cost_change_event',
    label: 'Price change (this GW)',
    shortLabel: 'Δ£',
    description: 'How much the price has moved this gameweek.',
    defaultSortDir: 'desc',
    accessor: (p) => p.cost_change_event,
    format: fmtCostChange,
  },
};

export type FieldGroupKey =
  | 'projections'
  | 'points'
  | 'attack'
  | 'defence'
  | 'playingTime'
  | 'ict'
  | 'market';

export type FieldGroup = {
  key: FieldGroupKey;
  label: string;
  fields: readonly FieldDef[];
};

/** Every field, in the tabs the column picker and filter dialog show
 *  them under. Projections lead as the headline signal; defcon leads
 *  Defence as the 25/26 scoring lever. Each field sits in exactly one
 *  group (a test checks). */
export const FIELD_GROUPS: readonly FieldGroup[] = [
  {
    key: 'projections',
    label: 'Projections',
    fields: [
      FIELD_DEFS.xp,
      FIELD_DEFS.xp_h3,
      FIELD_DEFS.xp_h5,
      FIELD_DEFS.fixtures,
      FIELD_DEFS.ep_next,
    ],
  },
  {
    key: 'points',
    label: 'Points',
    fields: [
      FIELD_DEFS.total_points,
      FIELD_DEFS.event_points,
      FIELD_DEFS.form,
      FIELD_DEFS.points_per_game,
      FIELD_DEFS.bonus,
      FIELD_DEFS.bps,
      FIELD_DEFS.dreamteam_count,
    ],
  },
  {
    key: 'attack',
    label: 'Attack',
    fields: [
      FIELD_DEFS.goals_scored,
      FIELD_DEFS.assists,
      FIELD_DEFS.expected_goals,
      FIELD_DEFS.expected_assists,
      FIELD_DEFS.expected_goal_involvements,
      FIELD_DEFS.expected_goals_per_90,
      FIELD_DEFS.expected_assists_per_90,
      FIELD_DEFS.expected_goal_involvements_per_90,
      FIELD_DEFS.penalties_missed,
    ],
  },
  {
    key: 'defence',
    label: 'Defence',
    fields: [
      FIELD_DEFS.defcon,
      FIELD_DEFS.defcon_per_90,
      FIELD_DEFS.tackles,
      FIELD_DEFS.clearances_blocks_interceptions,
      FIELD_DEFS.recoveries,
      FIELD_DEFS.clean_sheets,
      FIELD_DEFS.clean_sheets_per_90,
      FIELD_DEFS.goals_conceded,
      FIELD_DEFS.goals_conceded_per_90,
      FIELD_DEFS.expected_goals_conceded,
      FIELD_DEFS.expected_goals_conceded_per_90,
      FIELD_DEFS.saves,
      FIELD_DEFS.saves_per_90,
      FIELD_DEFS.penalties_saved,
      FIELD_DEFS.own_goals,
    ],
  },
  {
    key: 'playingTime',
    label: 'Minutes',
    fields: [
      FIELD_DEFS.minutes,
      FIELD_DEFS.starts,
      FIELD_DEFS.starts_per_90,
      FIELD_DEFS.yellow_cards,
      FIELD_DEFS.red_cards,
    ],
  },
  {
    key: 'ict',
    label: 'ICT',
    fields: [
      FIELD_DEFS.ict_index,
      FIELD_DEFS.influence,
      FIELD_DEFS.creativity,
      FIELD_DEFS.threat,
    ],
  },
  {
    key: 'market',
    label: 'Market',
    fields: [
      FIELD_DEFS.price,
      FIELD_DEFS.selected_by_percent,
      FIELD_DEFS.cost_change_event,
      FIELD_DEFS.cost_change_start,
      FIELD_DEFS.transfers_in_event,
      FIELD_DEFS.transfers_out_event,
      FIELD_DEFS.transfers_in,
      FIELD_DEFS.transfers_out,
      FIELD_DEFS.value_form,
      FIELD_DEFS.value_season,
    ],
  },
];

/** All fields, group by group. */
export const FIELDS_IN_PICKER_ORDER: readonly FieldDef[] = FIELD_GROUPS.flatMap(
  (group) => group.fields,
);

/** Names the gameweeks the xP and fixtures columns cover, under their
 *  headers, so it's explicit that both look past a live gameweek to the
 *  next deadline. */
export function columnHeaderSublabels(
  xpGameweek: number | null,
  fixtureGameweeks: readonly number[] | undefined,
): Partial<Record<FieldKey, string>> {
  const sublabels: Partial<Record<FieldKey, string>> = {};
  if (xpGameweek != null) sublabels.xp = `GW${xpGameweek}`;
  const fixturesLabel = gameweekRangeLabel(fixtureGameweeks ?? []);
  if (fixturesLabel != null) sublabels.fixtures = fixturesLabel;
  return sublabels;
}

/**
 * How a sorted column's cells are heat-coloured. A rate (per game, per 90,
 * per gameweek ahead) has a fixed ceiling. A season total grows every
 * gameweek, so its ceiling is per gameweek played and scales with the
 * season; a fixed one would turn every regular starter mint by spring.
 */
type ColumnHeat =
  | { kind: 'rate'; ceiling: number }
  | { kind: 'seasonTotal'; ceilingPerGameweek: number };

/**
 * Ceilings sit around an elite player's level, so only standouts reach
 * full mint. Price, ownership, price change and transfers are left out:
 * a bigger number there isn't a better pick. So are the stats where less
 * is better (goals conceded, cards, own goals, missed penalties), since
 * the scale only rewards size.
 */
const XP_H3_GAMEWEEKS = 3;
const XP_H5_GAMEWEEKS = 5;

const COLUMN_HEAT: Partial<Record<FieldKey, ColumnHeat>> = {
  xp: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints },
  xp_h3: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints * XP_H3_GAMEWEEKS },
  xp_h5: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints * XP_H5_GAMEWEEKS },
  form: { kind: 'rate', ceiling: 8 },
  points_per_game: { kind: 'rate', ceiling: 7 },
  // The per-match defcon bonus threshold for midfielders and forwards.
  defcon_per_90: { kind: 'rate', ceiling: 12 },
  total_points: { kind: 'seasonTotal', ceilingPerGameweek: 7 },
  defcon: { kind: 'seasonTotal', ceilingPerGameweek: 12 },
  minutes: { kind: 'seasonTotal', ceilingPerGameweek: 90 },
  goals_scored: { kind: 'seasonTotal', ceilingPerGameweek: 0.75 },
  assists: { kind: 'seasonTotal', ceilingPerGameweek: 0.5 },
  clean_sheets: { kind: 'seasonTotal', ceilingPerGameweek: 0.5 },
  bonus: { kind: 'seasonTotal', ceilingPerGameweek: 1 },
  bps: { kind: 'seasonTotal', ceilingPerGameweek: 30 },
  ict_index: { kind: 'seasonTotal', ceilingPerGameweek: 8 },
  expected_goals: { kind: 'seasonTotal', ceilingPerGameweek: 0.75 },
  expected_assists: { kind: 'seasonTotal', ceilingPerGameweek: 0.4 },
  event_points: { kind: 'rate', ceiling: HEAT_CEILING.playerPoints },
  ep_next: { kind: 'rate', ceiling: HEAT_CEILING.expectedPoints },
  dreamteam_count: { kind: 'seasonTotal', ceilingPerGameweek: 0.25 },
  expected_goal_involvements: { kind: 'seasonTotal', ceilingPerGameweek: 1 },
  expected_goals_per_90: { kind: 'rate', ceiling: 0.75 },
  expected_assists_per_90: { kind: 'rate', ceiling: 0.4 },
  expected_goal_involvements_per_90: { kind: 'rate', ceiling: 1 },
  clean_sheets_per_90: { kind: 'rate', ceiling: 0.5 },
  saves: { kind: 'seasonTotal', ceilingPerGameweek: 4 },
  saves_per_90: { kind: 'rate', ceiling: 4 },
  tackles: { kind: 'seasonTotal', ceilingPerGameweek: 3 },
  clearances_blocks_interceptions: { kind: 'seasonTotal', ceilingPerGameweek: 8 },
  recoveries: { kind: 'seasonTotal', ceilingPerGameweek: 8 },
  starts: { kind: 'seasonTotal', ceilingPerGameweek: 1 },
  influence: { kind: 'seasonTotal', ceilingPerGameweek: 30 },
  creativity: { kind: 'seasonTotal', ceilingPerGameweek: 30 },
  threat: { kind: 'seasonTotal', ceilingPerGameweek: 30 },
  value_form: { kind: 'rate', ceiling: 1.2 },
  value_season: { kind: 'seasonTotal', ceilingPerGameweek: 0.5 },
};

/**
 * The value at which a column's heat cell turns fully mint, or null when
 * the column isn't heat-coloured. Season totals need `gameweeksPlayed`
 * and stay plain before the first gameweek or when it's unknown.
 */
export function heatCeiling(
  key: FieldKey,
  gameweeksPlayed: number | null,
): number | null {
  const heat = COLUMN_HEAT[key];
  if (heat == null) return null;
  if (heat.kind === 'rate') return heat.ceiling;
  if (gameweeksPlayed == null || gameweeksPlayed <= 0) return null;
  return heat.ceilingPerGameweek * gameweeksPlayed;
}

/** Gameweeks finished before the one xP projects. The live gameweek, if
 *  any, counts as played: its points are already in the season totals. */
export function gameweeksPlayedBefore(xpGameweek: number | null): number | null {
  return xpGameweek == null ? null : xpGameweek - 1;
}

/** Defaults a brand-new install gets. Picked to emphasise xP — the
 *  newest signal, what the unified rebuild is for — and the fixture run
 *  that drives it. */
export const DEFAULT_COLUMNS: FieldKey[] = ['xp', 'fixtures', 'form', 'price'];

/** Columns added to the defaults after release, oldest first. Each is
 *  added once to columns a user saved before it existed; removing it
 *  afterwards sticks. */
export const INTRODUCED_COLUMNS: FieldKey[] = ['fixtures'];

export const DEFAULT_SORT = { field: 'xp' as FieldKey, dir: 'desc' as SortDir };
