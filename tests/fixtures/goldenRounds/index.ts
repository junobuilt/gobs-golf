import type { GoldenBundle } from "./build";
import { round171 } from "./data/round171";
import { round161 } from "./data/round161";
import { round157 } from "./data/round157";
import { round148 } from "./data/round148";

// The set of frozen prod rounds golden-mastered. Each spans a distinct engine
// path that has a real finalized round in prod. (Shambles / Texas Scramble /
// Alternate Shot have NO real rounds yet — they stay covered by their
// hand-derived engine unit tests: engine-shambles.test.ts, teamHandicap.test.ts,
// results-teamcard-net.test.ts.)
export const GOLDEN_ROUNDS: Array<{ name: string; bundle: GoldenBundle }> = [
  { name: "round 171 — 2-Ball, net best-2, override holes 9/12 (payout-anchored)", bundle: round171 },
  { name: "round 161 — 2-Ball, net best-2, BLIND DRAW (gross-anchored)", bundle: round161 },
  { name: "round 157 — Best Ball, net best-1, override holes 5/16 (gross-anchored)", bundle: round157 },
  { name: "round 148 — GOBS Stableford, mixed tees, BLIND DRAW (gross-anchored)", bundle: round148 },
];
