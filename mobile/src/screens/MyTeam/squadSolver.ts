/**
 * Exact solver for "best FPL squad under a budget".
 *
 * Without the per-club limit, positions only interact through the
 * budget, so each position gets a knapsack table over (starters picked,
 * bench picked, captain picked, money spent), and the four tables are
 * merged per formation by max-plus convolution over spend. That gives
 * the best squad ignoring clubs, which is an upper bound for the real
 * problem. The club limit is then enforced by branch and bound: if a
 * club has too many players, one of them must go, so branch on dropping
 * each in turn, exploring the most promising bound first.
 *
 * Costs are integers (FPL's tenths of a million) so spend can index
 * arrays.
 */

export type SolverPosition = 'GKP' | 'DEF' | 'MID' | 'FWD';

export type SolverPlayer = {
  id: number;
  position: SolverPosition;
  club: string;
  /** Integer cost, e.g. 55 for £5.5m. */
  cost: number;
  value: number;
};

export type SolverRules = {
  budget: number;
  squadShape: Record<SolverPosition, number>;
  starterLimits: Record<SolverPosition, { min: number; max: number }>;
  startingXiSize: number;
  maxPerClub: number;
  benchWeight: number;
  captainMultiplier: number;
};

export type SolverResult = {
  starters: number[];
  bench: number[];
  captain: number;
  objective: number;
  /** False if the node limit was hit before optimality was proven. */
  optimal: boolean;
};

const POSITIONS: readonly SolverPosition[] = ['GKP', 'DEF', 'MID', 'FWD'];
/** Branch-and-bound safety valve; real squads settle in a handful of nodes. */
const MAX_NODES = 200;
const NONE = -Infinity;
const EPSILON = 1e-9;

enum Pick {
  Skip = 0,
  Start = 1,
  Bench = 2,
  Captain = 3,
}

/** One position's knapsack table plus what's needed to trace it back. */
type PositionTable = {
  players: SolverPlayer[];
  cap: number;
  stateIndex: (s: number, b: number, c: number) => number;
  /** best[state * (cap + 1) + spend]: best value with spend ≤ `spend`. */
  best: Float64Array;
  decisions: Uint8Array;
  stateCount: number;
};

export function solveSquad(
  players: readonly SolverPlayer[],
  rules: SolverRules,
): SolverResult | null {
  const byPosition = Object.fromEntries(
    POSITIONS.map((p) => [p, players.filter((pl) => pl.position === p)]),
  ) as Record<SolverPosition, SolverPlayer[]>;

  const tableCache = new Map<string, PositionTable | null>();
  const tableFor = (
    position: SolverPosition,
    banned: ReadonlySet<number>,
    cap: number,
  ) => {
    const pool = byPosition[position].filter((pl) => !banned.has(pl.id));
    const key = `${position}|${pool.map((pl) => pl.id).join(',')}`;
    if (!tableCache.has(key)) tableCache.set(key, buildTable(pool, position, rules, cap));
    return tableCache.get(key) ?? null;
  };

  const relax = (banned: ReadonlySet<number>) =>
    solveRelaxed(rules, (p, cap) => tableFor(p, banned, cap), byPosition, banned);

  type Node = { banned: Set<number>; solution: Relaxed };
  const seen = new Set<string>();
  const frontier: Node[] = [];
  const push = (banned: Set<number>) => {
    const key = [...banned].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const solution = relax(banned);
    if (solution) frontier.push({ banned, solution });
  };

  push(new Set());
  let incumbent: Relaxed | null = null;
  let nodes = 0;
  while (frontier.length > 0) {
    frontier.sort((a, b) => b.solution.objective - a.solution.objective);
    const node = frontier.shift();
    if (!node) break;
    if (incumbent && node.solution.objective <= incumbent.objective + EPSILON) break;
    if (++nodes > MAX_NODES) break;

    const overfull = mostOverfullClub(node.solution, players, rules.maxPerClub);
    if (!overfull) {
      incumbent = node.solution;
      continue;
    }
    for (const id of overfull) push(new Set([...node.banned, id]));
  }

  if (!incumbent) return null;
  const best = incumbent;
  return {
    starters: best.starters,
    bench: best.bench,
    captain: best.captain,
    objective: best.objective,
    optimal:
      frontier.length === 0 ||
      frontier.every((n) => n.solution.objective <= best.objective + EPSILON),
  };
}

type Relaxed = {
  starters: number[];
  bench: number[];
  captain: number;
  objective: number;
};

function mostOverfullClub(
  solution: Relaxed,
  players: readonly SolverPlayer[],
  maxPerClub: number,
): number[] | null {
  const ids = new Set([...solution.starters, ...solution.bench]);
  const byClub = new Map<string, number[]>();
  for (const pl of players) {
    if (!ids.has(pl.id)) continue;
    byClub.set(pl.club, [...(byClub.get(pl.club) ?? []), pl.id]);
  }
  let worst: number[] | null = null;
  for (const members of byClub.values()) {
    if (members.length > maxPerClub && (!worst || members.length > worst.length)) {
      worst = members;
    }
  }
  return worst;
}

/** Most a position can spend: the budget less the cheapest legal fill
 *  of every other position. */
function spendCaps(
  rules: SolverRules,
  byPosition: Record<SolverPosition, SolverPlayer[]>,
  banned: ReadonlySet<number>,
): Record<SolverPosition, number> | null {
  const minCost = {} as Record<SolverPosition, number>;
  for (const p of POSITIONS) {
    const costs = byPosition[p]
      .filter((pl) => !banned.has(pl.id))
      .map((pl) => pl.cost)
      .sort((a, b) => a - b);
    if (costs.length < rules.squadShape[p]) return null;
    minCost[p] = costs.slice(0, rules.squadShape[p]).reduce((a, b) => a + b, 0);
  }
  const slack = rules.budget - POSITIONS.reduce((sum, p) => sum + minCost[p], 0);
  if (slack < 0) return null;
  return Object.fromEntries(POSITIONS.map((p) => [p, minCost[p] + slack])) as Record<
    SolverPosition,
    number
  >;
}

function buildTable(
  players: SolverPlayer[],
  position: SolverPosition,
  rules: SolverRules,
  cap: number,
): PositionTable | null {
  const shape = rules.squadShape[position];
  const maxStart = rules.starterLimits[position].max;
  const maxBench = shape - rules.starterLimits[position].min;
  const benchSpan = maxBench + 1;
  const startSpan = maxStart + 1;
  const stateCount = startSpan * benchSpan * 2;
  const stateIndex = (s: number, b: number, c: number) =>
    (c * startSpan + s) * benchSpan + b;
  const width = cap + 1;

  let best = new Float64Array(stateCount * width).fill(NONE);
  best.fill(0, stateIndex(0, 0, 0) * width, stateIndex(0, 0, 0) * width + width);
  const decisions = new Uint8Array(players.length * stateCount * width);

  players.forEach((pl, i) => {
    const next = best.slice();
    const base = i * stateCount * width;
    const options: [Pick, number, number, number, number][] = [
      // [pick, Δstart, Δbench, Δcaptain, value]
      [Pick.Start, 1, 0, 0, pl.value],
      [Pick.Bench, 0, 1, 0, pl.value * rules.benchWeight],
      [Pick.Captain, 1, 0, 1, pl.value * rules.captainMultiplier],
    ];
    for (let c = 0; c <= 1; c++) {
      for (let s = 0; s <= maxStart; s++) {
        for (let b = 0; b <= maxBench; b++) {
          if (s + b > shape) continue;
          const to = stateIndex(s, b, c);
          for (const [pick, ds, db, dc, value] of options) {
            if (s < ds || b < db || c < dc) continue;
            const from = stateIndex(s - ds, b - db, c - dc);
            for (let spend = pl.cost; spend <= cap; spend++) {
              const prev = best[from * width + spend - pl.cost];
              if (prev === NONE) continue;
              const candidate = prev + value;
              if (candidate > next[to * width + spend] + EPSILON) {
                next[to * width + spend] = candidate;
                decisions[base + to * width + spend] = pick;
              }
            }
          }
        }
      }
    }
    best = next;
  });

  return { players, cap, stateIndex, best, decisions, stateCount };
}

function traceBack(
  table: PositionTable,
  state: { s: number; b: number; c: number },
  spend: number,
  out: Relaxed,
) {
  let { s, b, c } = state;
  const width = table.cap + 1;
  for (let i = table.players.length - 1; i >= 0; i--) {
    const pick = table.decisions[
      i * table.stateCount * width + table.stateIndex(s, b, c) * width + spend
    ] as Pick;
    if (pick === Pick.Skip) continue;
    const pl = table.players[i];
    spend -= pl.cost;
    if (pick === Pick.Bench) {
      out.bench.push(pl.id);
      b--;
    } else {
      out.starters.push(pl.id);
      s--;
      if (pick === Pick.Captain) {
        out.captain = pl.id;
        c--;
      }
    }
  }
}

/** Best squad ignoring the club limit, or null if none fits. */
function solveRelaxed(
  rules: SolverRules,
  tableFor: (p: SolverPosition, cap: number) => PositionTable | null,
  byPosition: Record<SolverPosition, SolverPlayer[]>,
  banned: ReadonlySet<number>,
): Relaxed | null {
  const caps = spendCaps(rules, byPosition, banned);
  if (!caps) return null;
  const tables = {} as Record<SolverPosition, PositionTable>;
  for (const p of POSITIONS) {
    const table = tableFor(p, caps[p]);
    if (!table) return null;
    tables[p] = table;
  }

  const row = (p: SolverPosition, s: number, c: number) => {
    const t = tables[p];
    const width = t.cap + 1;
    const offset = t.stateIndex(s, rules.squadShape[p] - s, c) * width;
    return t.best.subarray(offset, offset + width);
  };

  let best: {
    objective: number;
    formation: Record<SolverPosition, number>;
    captainAt: SolverPosition;
    spends: Record<SolverPosition, number>;
  } | null = null;

  for (const formation of formations(rules)) {
    for (const captainAt of POSITIONS) {
      const rows = POSITIONS.map((p) => row(p, formation[p], p === captainAt ? 1 : 0));
      const merged = mergeAll(rows, rules.budget);
      if (merged && (!best || merged.objective > best.objective + EPSILON)) {
        best = {
          objective: merged.objective,
          formation,
          captainAt,
          spends: Object.fromEntries(
            POSITIONS.map((p, i) => [p, merged.spends[i]]),
          ) as Record<SolverPosition, number>,
        };
      }
    }
  }
  if (!best) return null;

  const out: Relaxed = {
    starters: [],
    bench: [],
    captain: -1,
    objective: best.objective,
  };
  for (const p of POSITIONS) {
    const s = best.formation[p];
    traceBack(
      tables[p],
      { s, b: rules.squadShape[p] - s, c: p === best.captainAt ? 1 : 0 },
      best.spends[p],
      out,
    );
  }
  return out;
}

/** Best total over the rows with combined spend ≤ budget, and each
 *  row's share of it. Rows are "best with spend ≤ x", so monotone. */
function mergeAll(
  rows: Float64Array[],
  budget: number,
): { objective: number; spends: number[] } | null {
  // Merge left to right, keeping each intermediate for the trace back.
  const partials: Float64Array[] = [rows[0]];
  for (let k = 1; k < rows.length - 1; k++) {
    partials.push(maxPlus(partials[k - 1], rows[k], budget));
  }
  const last = rows[rows.length - 1];
  const prefix = partials[partials.length - 1];
  let objective = NONE;
  let lastSpend = -1;
  for (let x = 0; x < last.length && x <= budget; x++) {
    const rest = Math.min(budget - x, prefix.length - 1);
    if (last[x] === NONE || prefix[rest] === NONE) continue;
    const total = last[x] + prefix[rest];
    if (total > objective + EPSILON) {
      objective = total;
      lastSpend = x;
    }
  }
  if (lastSpend < 0) return null;

  const spends = new Array<number>(rows.length);
  spends[rows.length - 1] = lastSpend;
  let remaining = Math.min(budget - lastSpend, prefix.length - 1);
  for (let k = rows.length - 2; k >= 1; k--) {
    const target = partials[k][remaining];
    const left = partials[k - 1];
    const right = rows[k];
    let found = -1;
    for (let x = 0; x < right.length && x <= remaining; x++) {
      const l = Math.min(remaining - x, left.length - 1);
      if (
        right[x] !== NONE &&
        left[l] !== NONE &&
        Math.abs(right[x] + left[l] - target) < 1e-6
      ) {
        found = x;
        break;
      }
    }
    spends[k] = found;
    remaining = Math.min(remaining - found, left.length - 1);
  }
  spends[0] = remaining;
  return { objective, spends };
}

function maxPlus(a: Float64Array, b: Float64Array, budget: number): Float64Array {
  const length = Math.min(a.length + b.length - 1, budget + 1);
  const out = new Float64Array(length).fill(NONE);
  for (let x = 0; x < a.length && x < length; x++) {
    const av = a[x];
    if (av === NONE) continue;
    for (let y = 0; y < b.length && x + y < length; y++) {
      const bv = b[y];
      if (bv === NONE) continue;
      const v = av + bv;
      if (v > out[x + y]) out[x + y] = v;
    }
  }
  // Keep "spend ≤ x" semantics: carry the best forward.
  for (let x = 1; x < length; x++) if (out[x - 1] > out[x]) out[x] = out[x - 1];
  return out;
}

function formations(rules: SolverRules): Record<SolverPosition, number>[] {
  const out: Record<SolverPosition, number>[] = [];
  const { GKP, DEF, MID, FWD } = rules.starterLimits;
  for (let g = GKP.min; g <= GKP.max; g++)
    for (let d = DEF.min; d <= DEF.max; d++)
      for (let m = MID.min; m <= MID.max; m++)
        for (let f = FWD.min; f <= FWD.max; f++)
          if (g + d + m + f === rules.startingXiSize)
            out.push({ GKP: g, DEF: d, MID: m, FWD: f });
  return out;
}
