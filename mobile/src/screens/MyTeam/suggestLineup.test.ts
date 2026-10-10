import type { PositionCode } from '../../players/positions';
import { formationLabel } from './lineup';
import { suggestLineup, type LineupMetric } from './suggestLineup';
import type { MyTeamRow } from './types';

type RowSpec = {
  name: string;
  position: PositionCode;
  xp: number | null;
  /** Defaults to the xP value so form-based tests have a realistic baseline. */
  form?: number;
  starter?: boolean;
  captain?: boolean;
  vice?: boolean;
};

/** Builds a squad in FPL pick order; squadSlot follows array position. */
function squad(specs: RowSpec[]): MyTeamRow[] {
  return specs.map((spec, index) => ({
    id: index + 1,
    name: spec.name,
    team: 'MCI',
    position: spec.position,
    price: 5,
    total_points: 0,
    form: spec.form ?? spec.xp ?? 0,
    xp: spec.xp,
    xp_h3: null,
    xp_h5: null,
    defcon: 0,
    defcon_per_90: null,
    selected_by_percent: 0,
    points_per_game: null,
    minutes: 0,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    bonus: 0,
    bps: 0,
    ict_index: 0,
    expected_goals: 0,
    expected_assists: 0,
    cost_change_event: 0,
    squadSlot: index + 1,
    isStarter: spec.starter ?? false,
    isCaptain: spec.captain ?? false,
    isViceCaptain: spec.vice ?? false,
    gwPoints: null,
  }));
}

/** A typical 4-4-2 squad (2 GK, 5 DEF, 5 MID, 3 FWD) with Haaland
 *  captained. Bench: Pope, Burn, Mbeumo, Delap, each scoring below every
 *  starter, so the user's lineup is already optimal by xP. */
function typicalSquad(overrides: Partial<Record<string, Partial<RowSpec>>> = {}) {
  const base: RowSpec[] = [
    { name: 'Raya', position: 'GKP', xp: 4.0, starter: true },
    { name: 'Gabriel', position: 'DEF', xp: 4.5, starter: true },
    { name: 'Saliba', position: 'DEF', xp: 4.2, starter: true },
    { name: 'Virgil', position: 'DEF', xp: 3.9, starter: true },
    { name: 'Gvardiol', position: 'DEF', xp: 3.5, starter: true },
    { name: 'Salah', position: 'MID', xp: 7.0, starter: true, vice: true },
    { name: 'Bruno Fernandes', position: 'MID', xp: 5.8, starter: true },
    { name: 'Palmer', position: 'MID', xp: 5.5, starter: true },
    { name: 'Rogers', position: 'MID', xp: 4.1, starter: true },
    { name: 'Haaland', position: 'FWD', xp: 7.6, starter: true, captain: true },
    { name: 'Isak', position: 'FWD', xp: 5.2, starter: true },
    { name: 'Pope', position: 'GKP', xp: 3.6 },
    { name: 'Burn', position: 'DEF', xp: 2.9 },
    { name: 'Mbeumo', position: 'MID', xp: 3.3 },
    { name: 'Delap', position: 'FWD', xp: 3.0 },
  ];
  return squad(base.map((spec) => ({ ...spec, ...overrides[spec.name] })));
}

/** suggestLineup for squads that can always field an XI. */
function suggest(rows: MyTeamRow[], metric: LineupMetric) {
  const suggestion = suggestLineup(rows, metric);
  if (!suggestion) throw new Error('expected a legal XI from this squad');
  return suggestion;
}

const names = (slots: { row: MyTeamRow }[]) => slots.map((slot) => slot.row.name);
const captainOf = (slots: { row: MyTeamRow; isCaptain: boolean }[]) =>
  slots.find((slot) => slot.isCaptain)?.row.name;
const viceOf = (slots: { row: MyTeamRow; isViceCaptain: boolean }[]) =>
  slots.find((slot) => slot.isViceCaptain)?.row.name;

describe('suggestLineup', () => {
  it('keeps an already-optimal lineup unchanged', () => {
    const { lineup, suggestedScore, currentScore } = suggest(typicalSquad(), 'xp');
    expect(formationLabel(lineup)).toBe('4-4-2');
    expect(captainOf(lineup.starters)).toBe('Haaland');
    expect(viceOf(lineup.starters)).toBe('Salah');
    expect(lineup.starters.every((slot) => slot.change === undefined)).toBe(true);
    expect(suggestedScore).toBeCloseTo(currentScore);
  });

  it('switches formation when a benched player outscores a starter', () => {
    // Delap (FWD, bench) now beats Gvardiol, the weakest starting DEF.
    const { lineup } = suggest(typicalSquad({ Delap: { xp: 6.0 } }), 'xp');

    expect(formationLabel(lineup)).toBe('3-4-3');
    const delap = lineup.starters.find((slot) => slot.row.name === 'Delap');
    const gvardiol = lineup.bench.find((slot) => slot.row.name === 'Gvardiol');
    expect(delap?.change).toBe('in');
    expect(gvardiol?.change).toBe('out');
  });

  it('moves the armband to the top scorer and counts it double', () => {
    const rows = typicalSquad({ Salah: { xp: 9.0 } });
    const { lineup, suggestedScore, currentScore } = suggest(rows, 'xp');

    expect(captainOf(lineup.starters)).toBe('Salah');
    expect(viceOf(lineup.starters)).toBe('Haaland');
    // Same XI, so the only gain is captaining Salah (9.0) over Haaland (7.6).
    expect(suggestedScore - currentScore).toBeCloseTo(9.0 - 7.6);
  });

  it('puts the backup keeper first on the bench, then outfielders best-first', () => {
    const rows = typicalSquad({ Burn: { xp: 3.2 }, Delap: { xp: 3.25 } });
    const { lineup } = suggest(rows, 'xp');

    expect(names(lineup.bench)).toEqual(['Pope', 'Mbeumo', 'Delap', 'Burn']);
  });

  it('keeps the current starter when a bench player ties', () => {
    const { lineup } = suggest(typicalSquad({ Burn: { xp: 3.5 } }), 'xp');

    expect(names(lineup.starters)).toContain('Gvardiol');
    expect(names(lineup.bench)).toContain('Burn');
  });

  it('keeps the current formation when another one ties', () => {
    // Starting Mbeumo over Gvardiol (3-5-2) scores exactly the same.
    const { lineup } = suggest(typicalSquad({ Mbeumo: { xp: 3.5 } }), 'xp');

    expect(formationLabel(lineup)).toBe('4-4-2');
    expect(lineup.starters.every((slot) => slot.change === undefined)).toBe(true);
  });

  it('treats a missing metric value as zero', () => {
    const { lineup } = suggest(typicalSquad({ Raya: { xp: null } }), 'xp');

    expect(names(lineup.starters)).toContain('Pope');
    expect(lineup.bench[0]?.row.name).toBe('Raya');
  });

  it('optimises for the chosen metric', () => {
    // Gvardiol is the weakest starter by xP but the best defender by form.
    const rows = typicalSquad({
      Gvardiol: { form: 9 },
      Burn: { form: 8 },
      Gabriel: { form: 1 },
    });
    const byXp = suggest(rows, 'xp');
    const byForm = suggest(rows, 'form');

    expect(names(byXp.lineup.starters)).toContain('Gabriel');
    expect(names(byForm.lineup.starters)).not.toContain('Gabriel');
    expect(names(byForm.lineup.starters)).toContain('Burn');
  });

  it('returns null when the squad cannot field a legal XI', () => {
    const withoutKeepers = typicalSquad().filter((row) => row.position !== 'GKP');

    expect(suggestLineup(withoutKeepers, 'xp')).toBeNull();
  });
});
