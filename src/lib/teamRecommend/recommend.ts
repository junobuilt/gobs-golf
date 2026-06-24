// Team Recommendation Engine — I6 + multi-start.
// Pure function: no IO, no Supabase, no React. Accepts pre-computed CH values
// and a pair-count closure (from computePairMatrix in playedWith/compute.ts).
//
// Balance is a hard guardrail; novelty (minimizing repeat pairings) is the
// objective inside it. The engine never trades balance for novelty.
//
// MULTI-START (2026-06-18): instead of a single snake-draft seed, the engine
// runs the SAME balance-constrained pipeline (spread-min if needed → novelty-
// within-band) from SEED_COUNT starting drafts and keeps the best feasible
// result via `pickBetter`. Snake draft is seed #1, so the chosen output can
// only match or beat the old single-seed engine.
//
// Determinism: the RNG is seeded from `roundId` when present (else the sorted
// player IDs), XOR the re-roll `nonce`. Same input + same nonce → same teams;
// re-roll varies the nonce to get a different-but-deterministic draft.
//
// The engine returns STRUCTURED NUMBERS only (spread / repeats / seeds /
// metBand). User-facing "Why these teams?" copy is built by the modal from
// these fields — the engine never emits player-name or per-swap prose.

export type PartitionMode =
  | { mode: "size"; value: number }   // "teams of N" — engine derives k
  | { mode: "count"; value: number }; // "N teams" — engine uses k directly

export type RecommendInput = {
  players: { id: number; courseHandicap: number }[];
  pairCounts: (a: number, b: number) => number;
  partition: PartitionMode;
  toleranceCH: number;
  // Determinism inputs. `roundId` is the stable seed source (falls back to the
  // sorted player IDs when absent); `nonce` is the re-roll counter XOR'd in.
  // `seed` is an explicit parent-seed override used by tests for direct control.
  roundId?: number | string | null;
  nonce?: number;
  seed?: number;
};

export type RecommendResult = {
  teams: { playerIds: number[]; avgCH: number }[];
  spread: number;        // CH-average spread of the chosen teams
  repeats: number;       // repeat-pairing count of the chosen teams
  seeds: number;         // how many starting drafts were compared
  metBand: boolean;      // chosen teams are inside the tolerance band
  teamCountBumped: boolean; // k was raised above the requested partition to
                            // honor the hard 4-player cap (drives the modal note)
};

// Hard cap: no team may EVER exceed this many players. k is floored at
// ceil(n / MAX_TEAM_SIZE) in both partition modes so the cap holds regardless
// of the admin's requested team size / team count.
const MAX_TEAM_SIZE = 4;

// Number of starting drafts compared each run: snake + novelty-greedy + 3 random
// restarts. Single tunable; restarts = SEED_COUNT - 2.
const SEED_COUNT = 5;

// ── Seeded RNG + hashing ─────────────────────────────────────────────────────

// Mulberry32 — tiny seeded PRNG, no deps.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash of a string → stable seed source for roundId / player IDs.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Parent seed for a run: explicit `seed` override wins (tests); otherwise hash
// `roundId` when present, else the sorted player IDs. The re-roll `nonce` is
// XOR'd in so each re-roll is a different-but-deterministic draft.
function deriveParentSeed(input: RecommendInput): number {
  const base =
    input.seed !== undefined
      ? input.seed >>> 0
      : input.roundId != null
        ? hashStr(`r:${input.roundId}`)
        : hashStr(input.players.map((p) => p.id).sort((a, b) => a - b).join("-"));
  const nonce = (input.nonce ?? 0) >>> 0;
  return (base ^ nonce) >>> 0;
}

// Derive the per-seed sub-seeds from the parent in a FIXED order so that the
// snake seed is identical whether we run the full multi-start or snake-only
// (the never-worse comparison depends on this).
function deriveSeeds(parentSeed: number): { snakeSeed: number; restartSeeds: number[] } {
  const rng = mulberry32(parentSeed);
  const next = () => Math.floor(rng() * 4294967296) >>> 0;
  const snakeSeed = next();
  const restartSeeds = Array.from({ length: SEED_COUNT - 2 }, () => next());
  return { snakeSeed, restartSeeds };
}

// ── Partitioning helpers ─────────────────────────────────────────────────────

// Distribute n items into k buckets so sizes differ by at most 1.
// Larger buckets come first.
function partitionSizes(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => (i < extra ? base + 1 : base));
}

// Fisher-Yates in-place shuffle of a sub-array [lo, hi).
function shuffleRange<T>(arr: T[], lo: number, hi: number, rng: () => number): void {
  for (let i = hi - 1; i > lo; i--) {
    const j = lo + Math.floor(rng() * (i - lo + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Seed generators ──────────────────────────────────────────────────────────

// Seed #1 — snake draft: sort players by CH desc, shuffle within equal-CH tiers
// if rng provided (enables re-roll), then deal left→right in even rounds,
// right→left in odd rounds. This is the original single-seed behavior.
function snakeDraft(
  players: { id: number; courseHandicap: number }[],
  k: number,
  rng?: () => number,
): number[][] {
  const sorted = [...players].sort((a, b) => b.courseHandicap - a.courseHandicap);

  // Pre-shuffle within equal-CH tiers so re-roll varies even when repeats are
  // already 0 in the seed (the shuffle changes which balanced option is found
  // first, not whether balance is met).
  if (rng) {
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length && sorted[j].courseHandicap === sorted[i].courseHandicap) j++;
      if (j - i > 1) shuffleRange(sorted, i, j, rng);
      i = j;
    }
  }

  const teams: number[][] = Array.from({ length: k }, () => []);
  for (let pick = 0; pick < sorted.length; pick++) {
    const round = Math.floor(pick / k);
    const posInRound = pick % k;
    const teamIdx = round % 2 === 0 ? posInRound : k - 1 - posInRound;
    teams[teamIdx].push(sorted[pick].id);
  }
  return teams;
}

// Seed #2 — novelty-greedy: fill team slots in round-robin draft order, at each
// pick choosing the remaining player who adds the FEWEST prior pairings with
// that team's current members. Ignores CH entirely (balance is restored by the
// per-seed pipeline). Deterministic: ties break to the lowest player id.
function noveltyGreedySeed(
  players: { id: number; courseHandicap: number }[],
  k: number,
  pairCounts: (a: number, b: number) => number,
): number[][] {
  const sizes = partitionSizes(players.length, k);
  const teams: number[][] = Array.from({ length: k }, () => []);

  // Round-robin team order: level 0 across all teams, then level 1, etc.,
  // skipping teams already at capacity.
  const order: number[] = [];
  const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
  for (let level = 0; level < maxSize; level++) {
    for (let t = 0; t < k; t++) {
      if (sizes[t] > level) order.push(t);
    }
  }

  const remaining = players.map((p) => p.id).sort((a, b) => a - b);
  for (const t of order) {
    let bestIdx = -1;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      let cost = 0;
      for (const m of teams[t]) cost += pairCounts(remaining[i], m);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    teams[t].push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return teams;
}

// Seeds #3-5 — random restart: shuffle all players, deal into size-correct teams.
function randomRestartSeed(
  players: { id: number; courseHandicap: number }[],
  k: number,
  rng: () => number,
): number[][] {
  const sizes = partitionSizes(players.length, k);
  const ids = players.map((p) => p.id);
  shuffleRange(ids, 0, ids.length, rng);
  const teams: number[][] = [];
  let idx = 0;
  for (let t = 0; t < k; t++) {
    teams.push(ids.slice(idx, idx + sizes[t]));
    idx += sizes[t];
  }
  return teams;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function teamAvgCH(teamIds: number[], chMap: Map<number, number>): number {
  if (teamIds.length === 0) return 0;
  return teamIds.reduce((s, id) => s + (chMap.get(id) ?? 0), 0) / teamIds.length;
}

function computeSpread(avgCHs: number[]): number {
  if (avgCHs.length === 0) return 0;
  return Math.max(...avgCHs) - Math.min(...avgCHs);
}

function computeNoveltyCost(
  teams: number[][],
  pairCounts: (a: number, b: number) => number,
): number {
  let cost = 0;
  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        cost += pairCounts(team[i], team[j]);
      }
    }
  }
  return cost;
}

// Compute the novelty-cost delta and new avgCHs resulting from swapping
// player pa (in team ia) with player pb (in team ib). O(teamSize).
function swapDelta(
  teams: number[][],
  ia: number,
  ib: number,
  pa: number,
  pb: number,
  chMap: Map<number, number>,
  pairCounts: (a: number, b: number) => number,
): { deltaNovelty: number; newAvgA: number; newAvgB: number } {
  const teamA = teams[ia];
  const teamB = teams[ib];
  const chA = chMap.get(pa) ?? 0;
  const chB = chMap.get(pb) ?? 0;

  const sumA = teamA.reduce((s, id) => s + (chMap.get(id) ?? 0), 0);
  const sumB = teamB.reduce((s, id) => s + (chMap.get(id) ?? 0), 0);
  const newAvgA = teamA.length > 0 ? (sumA - chA + chB) / teamA.length : 0;
  const newAvgB = teamB.length > 0 ? (sumB - chB + chA) / teamB.length : 0;

  let deltaNovelty = 0;
  for (const other of teamA) {
    if (other === pa) continue;
    deltaNovelty -= pairCounts(pa, other);
    deltaNovelty += pairCounts(pb, other);
  }
  for (const other of teamB) {
    if (other === pb) continue;
    deltaNovelty -= pairCounts(pb, other);
    deltaNovelty += pairCounts(pa, other);
  }

  return { deltaNovelty, newAvgA, newAvgB };
}

// Apply a swap in-place.
function applySwap(teams: number[][], ia: number, pa: number, ib: number, pb: number): void {
  const ai = teams[ia].indexOf(pa);
  const bi = teams[ib].indexOf(pb);
  teams[ia][ai] = pb;
  teams[ib][bi] = pa;
}

// Compute avgCHs array from current team assignments.
function computeAvgCHs(teams: number[][], chMap: Map<number, number>): number[] {
  return teams.map((t) => teamAvgCH(t, chMap));
}

const ITER_CAP = 500;

// ── Per-seed pipeline ────────────────────────────────────────────────────────

type SeedResult = {
  teams: number[][];
  spread: number;
  noveltyCost: number;
  metBand: boolean;
};

// Run ONE starting draft through the balance-constrained pipeline:
//   in-band seed  → novelty-within-band local search
//   over-band seed → spread-minimizing search → (if it lands in-band) novelty
// Balance is a hard guardrail: a swap that pushes spread over the band is never
// taken in the novelty phase. Operates on a private copy of `seed`.
function optimizeFromSeed(
  seed: number[][],
  k: number,
  chMap: Map<number, number>,
  pairCounts: (a: number, b: number) => number,
  toleranceCH: number,
): SeedResult {
  const teams = seed.map((t) => [...t]);
  const avgCHs = computeAvgCHs(teams, chMap);
  let spread = computeSpread(avgCHs);
  let noveltyCost = computeNoveltyCost(teams, pairCounts);

  // novelty-within-band local search — assumes spread ≤ band on entry.
  const runNoveltyPhase = () => {
    let improved = true;
    let iters = 0;
    while (improved && iters < ITER_CAP) {
      improved = false;
      iters++;
      let bestDelta = 0;
      let bestIa = -1, bestIb = -1, bestPa = -1, bestPb = -1;
      let bestNewAvgA = 0, bestNewAvgB = 0;

      for (let ia = 0; ia < k; ia++) {
        for (let ib = ia + 1; ib < k; ib++) {
          for (const pa of teams[ia]) {
            for (const pb of teams[ib]) {
              const { deltaNovelty, newAvgA, newAvgB } = swapDelta(
                teams, ia, ib, pa, pb, chMap, pairCounts,
              );
              if (deltaNovelty >= 0) continue; // not improving

              // Balance guardrail.
              const newAvgCHs = [...avgCHs];
              newAvgCHs[ia] = newAvgA;
              newAvgCHs[ib] = newAvgB;
              if (computeSpread(newAvgCHs) > toleranceCH) continue;

              if (deltaNovelty < bestDelta) {
                bestDelta = deltaNovelty;
                bestIa = ia; bestIb = ib; bestPa = pa; bestPb = pb;
                bestNewAvgA = newAvgA; bestNewAvgB = newAvgB;
              }
            }
          }
        }
      }

      if (bestIa !== -1) {
        applySwap(teams, bestIa, bestPa, bestIb, bestPb);
        avgCHs[bestIa] = bestNewAvgA;
        avgCHs[bestIb] = bestNewAvgB;
        noveltyCost += bestDelta;
        spread = computeSpread(avgCHs);
        improved = true;
      }
    }
  };

  if (spread <= toleranceCH) {
    runNoveltyPhase();
  } else {
    // Spread-minimizing search: lex-min (spread, novelty).
    let improved = true;
    let iters = 0;
    while (improved && iters < ITER_CAP) {
      improved = false;
      iters++;
      let bestSpread = spread;
      let bestNovelty = noveltyCost;
      let bestIa = -1, bestIb = -1, bestPa = -1, bestPb = -1;
      let bestNewAvgA = 0, bestNewAvgB = 0;

      for (let ia = 0; ia < k; ia++) {
        for (let ib = ia + 1; ib < k; ib++) {
          for (const pa of teams[ia]) {
            for (const pb of teams[ib]) {
              const { deltaNovelty, newAvgA, newAvgB } = swapDelta(
                teams, ia, ib, pa, pb, chMap, pairCounts,
              );
              const newAvgCHs = [...avgCHs];
              newAvgCHs[ia] = newAvgA;
              newAvgCHs[ib] = newAvgB;
              const newSpread = computeSpread(newAvgCHs);
              const newNovelty = noveltyCost + deltaNovelty;

              if (
                newSpread < bestSpread ||
                (newSpread === bestSpread && newNovelty < bestNovelty)
              ) {
                bestSpread = newSpread;
                bestNovelty = newNovelty;
                bestIa = ia; bestIb = ib; bestPa = pa; bestPb = pb;
                bestNewAvgA = newAvgA; bestNewAvgB = newAvgB;
              }
            }
          }
        }
      }

      if (bestIa !== -1 && bestSpread < spread) {
        applySwap(teams, bestIa, bestPa, bestIb, bestPb);
        avgCHs[bestIa] = bestNewAvgA;
        avgCHs[bestIb] = bestNewAvgB;
        noveltyCost = bestNovelty;
        spread = bestSpread;
        improved = true;
      }
    }

    // If the spread search closed the band, optimize novelty on top.
    if (spread <= toleranceCH) {
      runNoveltyPhase();
    }
  }

  return { teams, spread, noveltyCost, metBand: spread <= toleranceCH };
}

// ── Selection ────────────────────────────────────────────────────────────────

// Choose the better of two per-seed results, in the exact priority order:
//   1. in-band beats out-of-band
//   2. among in-band: lowest repeat-pairing count
//   3. tie: lowest spread
//   4. still tied: keep `a` (the earlier seed — deterministic)
//   5. if neither is in-band: lowest spread (the fallback)
// Used in a left-to-right reduce over seeds in fixed order, so `a` is always the
// earlier seed and ties resolve to it.
function pickBetter(a: SeedResult, b: SeedResult): SeedResult {
  if (a.metBand !== b.metBand) return a.metBand ? a : b;
  if (a.metBand) {
    if (a.noveltyCost !== b.noveltyCost) return a.noveltyCost < b.noveltyCost ? a : b;
    if (a.spread !== b.spread) return a.spread < b.spread ? a : b;
    return a;
  }
  // Neither in-band → lowest spread.
  if (a.spread !== b.spread) return a.spread < b.spread ? a : b;
  return a;
}

// ── Entry points ─────────────────────────────────────────────────────────────

function setup(input: RecommendInput): {
  players: { id: number; courseHandicap: number }[];
  chMap: Map<number, number>;
  k: number;
  teamCountBumped: boolean;
  parentSeed: number;
} {
  const { players, partition } = input;
  for (const p of players) {
    if (!Number.isFinite(p.courseHandicap)) {
      throw new Error(
        `Player ${p.id} has non-finite courseHandicap: ${p.courseHandicap}`,
      );
    }
  }
  const n = players.length;
  const chMap = new Map<number, number>(players.map((p) => [p.id, p.courseHandicap]));

  // The team count the admin's selection implies, BEFORE the cap is enforced.
  let requestedK: number;
  if (partition.mode === "count") {
    // "N teams" — manual admin input, clamped to [1, n].
    requestedK = Math.max(1, Math.min(partition.value, n));
  } else {
    // "Teams of N" — enough teams that no team exceeds the requested size.
    // ceil (not round): round(25/4)=6 → a 5-man team; ceil(25/4)=7 caps at 4.
    requestedK = Math.max(1, Math.ceil(n / partition.value));
  }

  // Hard cap: floor k at ceil(n / MAX_TEAM_SIZE) so no team can ever exceed
  // MAX_TEAM_SIZE, even when the admin asked for fewer/larger teams. When this
  // raises k above the request we flag it so the modal can surface a note.
  const minTeamsForCap = Math.max(1, Math.ceil(n / MAX_TEAM_SIZE));
  const k = Math.max(requestedK, minTeamsForCap);
  const teamCountBumped = k > requestedK;

  return { players, chMap, k, teamCountBumped, parentSeed: deriveParentSeed(input) };
}

function toResult(
  sr: SeedResult,
  seeds: number,
  chMap: Map<number, number>,
  teamCountBumped: boolean,
): RecommendResult {
  return {
    teams: sr.teams.map((ids) => ({ playerIds: ids, avgCH: teamAvgCH(ids, chMap) })),
    spread: sr.spread,
    repeats: sr.noveltyCost,
    seeds,
    metBand: sr.metBand,
    teamCountBumped,
  };
}

// Multi-start: run all SEED_COUNT seeds through the pipeline, pick the best.
// This is the default generation path.
export function recommendTeams(input: RecommendInput): RecommendResult {
  if (input.players.length === 0) {
    return { teams: [], spread: 0, repeats: 0, seeds: SEED_COUNT, metBand: true, teamCountBumped: false };
  }
  const { players, chMap, k, teamCountBumped, parentSeed } = setup(input);
  const { snakeSeed, restartSeeds } = deriveSeeds(parentSeed);

  // Fixed seed order — seed #1 is the snake draft (old behavior baseline).
  const seeds: number[][][] = [
    snakeDraft(players, k, mulberry32(snakeSeed)),
    noveltyGreedySeed(players, k, input.pairCounts),
    ...restartSeeds.map((s) => randomRestartSeed(players, k, mulberry32(s))),
  ];

  const results = seeds.map((seed) =>
    optimizeFromSeed(seed, k, chMap, input.pairCounts, input.toleranceCH),
  );
  const chosen = results.reduce((best, cur) => pickBetter(best, cur));
  return toResult(chosen, SEED_COUNT, chMap, teamCountBumped);
}

// Snake-only path: seed #1 alone through the same pipeline. This is the OLD
// single-seed engine, kept for the never-worse guarantee test — it uses the
// identical snake sub-seed as multi-start's seed #1, so the two are comparable.
export function recommendTeamsSnakeOnly(input: RecommendInput): RecommendResult {
  if (input.players.length === 0) {
    return { teams: [], spread: 0, repeats: 0, seeds: 1, metBand: true, teamCountBumped: false };
  }
  const { players, chMap, k, teamCountBumped, parentSeed } = setup(input);
  const { snakeSeed } = deriveSeeds(parentSeed);
  const seed = snakeDraft(players, k, mulberry32(snakeSeed));
  const chosen = optimizeFromSeed(seed, k, chMap, input.pairCounts, input.toleranceCH);
  return toResult(chosen, 1, chMap, teamCountBumped);
}
