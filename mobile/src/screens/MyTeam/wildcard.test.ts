import { POSITION_CODES, type PositionCode } from '../../players/positions';
import { buildWildcard } from './wildcard';
import type { MyTeamRow } from './types';

const CLUBS = Array.from({ length: 20 }, (_, i) => `C${i}`);
const POOL_SHAPE: Record<PositionCode, number> = { GKP: 70, DEF: 230, MID: 280, FWD: 90 };
const BASE_PRICE: Record<PositionCode, number> = { GKP: 4, DEF: 4, MID: 4.5, FWD: 4.5 };

/** Deterministic PRNG so the synthetic pool is the same every run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function row(
  id: number,
  position: PositionCode,
  team: string,
  price: number,
  xp: number,
) {
  return {
    id,
    name: `P${id}`,
    team,
    position,
    price,
    total_points: Math.round(xp * 4),
    form: xp / 2,
    xp: xp / 5,
    xp_h3: (xp * 3) / 5,
    xp_h5: xp,
    points_per_game: null,
    stats: null,
    fixtures: null,
    fixture_difficulty: null,
    squadSlot: 0,
    isStarter: false,
    isCaptain: false,
    isViceCaptain: false,
    gwPoints: null,
  } as unknown as MyTeamRow;
}

/** ~670 players, a realistic Premier League pool: price loosely tracks
 *  output, with plenty of noise and a long tail of cheap non-starters. */
function syntheticPool(): MyTeamRow[] {
  const rand = mulberry32(42);
  const rows: MyTeamRow[] = [];
  let id = 1;
  for (const position of POSITION_CODES) {
    for (let i = 0; i < POOL_SHAPE[position]; i++) {
      const quality = rand() ** 2.5;
      const price =
        Math.round(
          (BASE_PRICE[position] + quality * (position === 'GKP' ? 2 : 10)) * 10,
        ) / 10;
      const plays = rand() < 0.6;
      const xp = plays ? quality * 30 + rand() * 8 : rand();
      rows.push(row(id++, position, CLUBS[Math.floor(rand() * CLUBS.length)], price, xp));
    }
  }
  return rows;
}

describe('buildWildcard', () => {
  it('builds a legal squad within budget, quickly', () => {
    const pool = syntheticPool();
    const started = Date.now();
    const result = buildWildcard(pool, 'xp_h5', 100);
    const elapsed = Date.now() - started;

    expect(result).not.toBeNull();
    if (!result) return;
    const squad = [...result.lineup.starters, ...result.lineup.bench].map((s) => s.row);
    expect(squad).toHaveLength(15);
    expect(result.lineup.starters).toHaveLength(11);
    expect(result.cost).toBeLessThanOrEqual(100);
    const count = (position: string) =>
      squad.filter((r) => r.position === position).length;
    expect([count('GKP'), count('DEF'), count('MID'), count('FWD')]).toEqual([
      2, 5, 5, 3,
    ]);
    const perClub = new Map<string, number>();
    for (const r of squad) perClub.set(r.team, (perClub.get(r.team) ?? 0) + 1);
    expect(Math.max(...perClub.values())).toBeLessThanOrEqual(3);
    expect(result.lineup.starters.filter((s) => s.isCaptain)).toHaveLength(1);
    expect(result.lineup.bench[0]?.row.position).toBe('GKP');
    expect(result.optimal).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  });

  it('spends on the XI rather than the bench', () => {
    const result = buildWildcard(syntheticPool(), 'xp_h5', 100);
    if (!result) throw new Error('no squad');
    const avg = (rows: { row: MyTeamRow }[]) =>
      rows.reduce((sum, s) => sum + s.row.price, 0) / rows.length;
    expect(avg(result.lineup.bench)).toBeLessThan(avg(result.lineup.starters));
  });

  it('skips players flagged out and lists ins and outs', () => {
    const pool = syntheticPool();
    const star = pool.reduce((best, r) =>
      r.total_points > best.total_points ? r : best,
    );
    const injured = { ...star, xp: 0 };
    const current = pool.slice(0, 15);
    const result = buildWildcard(
      pool.map((r) => (r.id === star.id ? injured : r)),
      'total_points',
      100,
      current,
    );
    if (!result) throw new Error('no squad');
    const ids = result.incoming.map((r) => r.id);
    expect(ids).not.toContain(star.id);
    expect(result.incoming.length).toBe(15 - (15 - result.outgoing.length));
  });

  it('returns null when nothing fits the budget', () => {
    expect(buildWildcard(syntheticPool(), 'xp_h5', 40)).toBeNull();
  });
});
