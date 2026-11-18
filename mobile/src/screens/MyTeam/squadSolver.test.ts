import { solveSquad } from './squadSolver';
/** Cross-checks the solver against exhaustive search on small random
 *  pools with a tight club limit, so the branch and bound gets exercised. */
it('matches exhaustive search on small pools', () => {
  let a = 7;
  const rand = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const rules = {
    budget: 0,
    squadShape: { GKP: 1, DEF: 2, MID: 2, FWD: 1 },
    starterLimits: {
      GKP: { min: 1, max: 1 },
      DEF: { min: 1, max: 2 },
      MID: { min: 1, max: 2 },
      FWD: { min: 0, max: 1 },
    },
    startingXiSize: 4,
    maxPerClub: 2,
    benchWeight: 0.1,
    captainMultiplier: 2,
  };
  for (let trial = 0; trial < 30; trial++) {
    const shape = { GKP: 3, DEF: 5, MID: 5, FWD: 3 } as const;
    const players = (Object.keys(shape) as (keyof typeof shape)[]).flatMap((p, pi) =>
      Array.from({ length: shape[p] }, (_, i) => ({
        id: pi * 10 + i,
        position: p,
        club: 'C' + Math.floor(rand() * 3),
        cost: 40 + Math.floor(rand() * 40),
        value: Math.round(rand() * 100) / 10,
      })),
    );
    const r = { ...rules, budget: 300 + Math.floor(rand() * 150) };
    const got = solveSquad(players, r);
    // exhaustive
    let best = -Infinity;
    const n = players.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const sel = players.filter((_, i) => mask & (1 << i));
      if (sel.length !== 6) continue;
      const cnt = (p: string) => sel.filter((s) => s.position === p).length;
      if (cnt('GKP') !== 1 || cnt('DEF') !== 2 || cnt('MID') !== 2 || cnt('FWD') !== 1)
        continue;
      if (sel.reduce((s, x) => s + x.cost, 0) > r.budget) continue;
      const clubs: Record<string, number> = {};
      sel.forEach((s) => (clubs[s.club] = (clubs[s.club] ?? 0) + 1));
      if (Math.max(...Object.values(clubs)) > 2) continue;
      // choose XI of 4 = drop 2 bench (any legal), captain best starter
      for (let bm = 0; bm < 64; bm++) {
        const bench = sel.filter((_, i) => bm & (1 << i));
        if (bench.length !== 2) continue;
        const xi = sel.filter((_, i) => !(bm & (1 << i)));
        const c = (p: string) => xi.filter((s) => s.position === p).length;
        if (c('GKP') !== 1 || c('DEF') < 1 || c('MID') < 1) continue;
        const v =
          xi.reduce((s, x) => s + x.value, 0) +
          Math.max(...xi.map((x) => x.value)) +
          0.1 * bench.reduce((s, x) => s + x.value, 0);
        if (v > best) best = v;
      }
    }
    if (best === -Infinity) expect(got).toBeNull();
    else expect(got?.objective).toBeCloseTo(best, 6);
  }
});
