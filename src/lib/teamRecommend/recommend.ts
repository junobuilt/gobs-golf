// Team Recommendation Engine — I6.
// Pure function: no IO, no Supabase, no React. Accepts pre-computed CH values
// and a pair-count closure (from computePairMatrix in playedWith/compute.ts).
//
// Balance is a hard guardrail; novelty (minimizing repeat pairings) is the
// objective inside it. The engine never trades balance for novelty.

export type PartitionMode =
  | { mode: "size"; value: number }   // "teams of N" — engine derives k
  | { mode: "count"; value: number }; // "N teams" — engine uses k directly

export type RecommendInput = {
  players: { id: number; courseHandicap: number }[];
  pairCounts: (a: number, b: number) => number;
  partition: PartitionMode;
  toleranceCH: number;
  seed?: number;
};

export type RecommendResult = {
  teams: { playerIds: number[]; avgCH: number }[];
  spread: number;
  noveltyCost: number;
  metBand: boolean;
  notes: string[];
};

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

// Snake draft: sort players by CH desc, shuffle within equal-CH tiers if rng
// provided (enables re-roll), then deal left→right in even rounds, right→left
// in odd rounds.
function snakeDraft(
  players: { id: number; courseHandicap: number }[],
  k: number,
  rng?: () => number,
): number[][] {
  const sorted = [...players].sort((a, b) => b.courseHandicap - a.courseHandicap);

  // Pre-shuffle within equal-CH tiers so re-roll varies even when noveltyCost
  // is already 0 in the seed (i.e., the shuffle changes which balanced option
  // is found first, not whether balance is met).
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
const NOTES_CAP = 20;

export function recommendTeams(input: RecommendInput): RecommendResult {
  const { players, pairCounts, partition, toleranceCH, seed } = input;

  // Validate inputs.
  for (const p of players) {
    if (!Number.isFinite(p.courseHandicap)) {
      throw new Error(
        `Player ${p.id} has non-finite courseHandicap: ${p.courseHandicap}`,
      );
    }
  }

  const notes: string[] = [];
  const n = players.length;

  if (n === 0) {
    return { teams: [], spread: 0, noveltyCost: 0, metBand: true, notes };
  }

  const chMap = new Map<number, number>(players.map((p) => [p.id, p.courseHandicap]));

  // Derive k.
  let k: number;
  if (partition.mode === "count") {
    k = Math.max(1, Math.min(partition.value, n));
  } else {
    k = Math.max(1, Math.min(Math.round(n / partition.value), n));
  }

  const rng = seed !== undefined ? mulberry32(seed) : undefined;
  const teams = snakeDraft(players, k, rng);

  let avgCHs = computeAvgCHs(teams, chMap);
  let spread = computeSpread(avgCHs);
  let noveltyCost = computeNoveltyCost(teams, pairCounts);
  let suppressedSwapCount = 0;

  // ── Feasible branch: seed is inside the band ────────────────────────────────
  if (spread <= toleranceCH) {
    notes.push(`Seed spread ${spread.toFixed(2)} pts — inside the ${toleranceCH}-pt band; optimizing novelty.`);
    let improved = true;
    let iters = 0;
    while (improved && iters < ITER_CAP) {
      improved = false;
      iters++;
      let bestDeltaNovelty = 0;
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

              // Check balance guardrail.
              const newAvgCHs = [...avgCHs];
              newAvgCHs[ia] = newAvgA;
              newAvgCHs[ib] = newAvgB;
              const newSpread = computeSpread(newAvgCHs);
              if (newSpread > toleranceCH) continue; // balance guardrail

              if (deltaNovelty < bestDeltaNovelty) {
                bestDeltaNovelty = deltaNovelty;
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
        noveltyCost += bestDeltaNovelty;
        spread = computeSpread(avgCHs);
        improved = true;
        if (notes.length < NOTES_CAP) {
          notes.push(
            `Swapped player ${bestPa}↔${bestPb} to cut repeat pairings by ${-bestDeltaNovelty} (balance unchanged at ${spread.toFixed(2)} pts).`,
          );
        } else {
          suppressedSwapCount++;
        }
      }
    }
    if (suppressedSwapCount > 0) {
      notes.push(`…and ${suppressedSwapCount} more novelty swaps.`);
    }
  } else {
    // ── Infeasible branch: seed violates the band ──────────────────────────────
    notes.push(
      `Seed spread ${spread.toFixed(2)} pts — outside the ${toleranceCH}-pt band; running spread-minimizing search.`,
    );
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

              // Lex-min (spread, novelty): prefer lower spread first, then lower novelty.
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

    // If the spread-minimizing search brought us into the band, run the
    // feasible novelty-optimizing loop on top.
    if (spread <= toleranceCH) {
      notes.push(
        `Spread reduced to ${spread.toFixed(2)} pts — now inside the band; continuing with novelty optimization.`,
      );
      let noveltyImproved = true;
      let niters = 0;
      while (noveltyImproved && niters < ITER_CAP) {
        noveltyImproved = false;
        niters++;
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
                if (deltaNovelty >= 0) continue;
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
          noveltyImproved = true;
          if (notes.length < NOTES_CAP) {
            notes.push(
              `Swapped player ${bestPa}↔${bestPb} to cut repeat pairings by ${-bestDelta}.`,
            );
          } else {
            suppressedSwapCount++;
          }
        }
      }
      if (suppressedSwapCount > 0) {
        notes.push(`…and ${suppressedSwapCount} more novelty swaps.`);
      }
    } else {
      notes.push(
        `Couldn't meet the ${toleranceCH}-pt band — closest spread ${spread.toFixed(2)} pts.`,
      );
    }
  }

  const metBand = spread <= toleranceCH;

  return {
    teams: teams.map((ids) => ({ playerIds: ids, avgCH: teamAvgCH(ids, chMap) })),
    spread,
    noveltyCost,
    metBand,
    notes,
  };
}
