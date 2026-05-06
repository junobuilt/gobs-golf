// B5 snapshot script:
//   Part 1 — Live-data 2-Ball regression check. Existing rounds have
//            format_config.override_holes = [], so engine output must still
//            match legacy inline 2-Ball math. Confirms the override branch
//            and the new teamParAtScored formula don't drift the no-override
//            path.
//   Part 2 — Synthetic 2-Ball with override on holes 9 and 18. Verifies
//            override holes sum all 4 scores while non-override holes take
//            best-2.
//   Part 3 — Synthetic GOBS House with override (no-op verification).
//            Computing the same round with and without override produces
//            identical teamScore.
//
// Usage: npm run snapshot:b5

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ── Legacy inline 2-Ball math (verbatim ground truth) ──────────────────────

function legacyGetHandicapStrokes(courseHandicap, strokeIndex) {
  if (courseHandicap === null || courseHandicap === 0) return 0;
  const ch = Math.abs(courseHandicap);
  const fullStrokes = Math.floor(ch / 18);
  const remainder = ch % 18;
  let strokes = fullStrokes + (strokeIndex <= remainder ? 1 : 0);
  if (courseHandicap < 0) strokes = -strokes;
  return strokes;
}

function legacyHoleTeamScore(playersOnTeam, holesByTee, scoreMap, holeNumber, mode) {
  const grossScores = [];
  const netScores = [];
  for (const rp of playersOnTeam) {
    const s = scoreMap[rp.id]?.[holeNumber];
    if (s == null) continue;
    grossScores.push(s);
    const holes = holesByTee[rp.tee_id] || [];
    const holeInfo = holes.find(h => h.hole_number === holeNumber);
    const hcpStrokes = holeInfo
      ? legacyGetHandicapStrokes(rp.course_handicap, holeInfo.stroke_index)
      : 0;
    netScores.push(s - hcpStrokes);
  }
  if (grossScores.length < 2) return null;
  grossScores.sort((a, b) => a - b);
  netScores.sort((a, b) => a - b);
  return mode === "gross"
    ? grossScores[0] + grossScores[1]
    : netScores[0] + netScores[1];
}

// ── Engine import ──────────────────────────────────────────────────────────

let engineMod;
try {
  engineMod = await import(pathToFileURL("./src/lib/scoring/engine.ts").href);
} catch (err) {
  console.error("Failed to import engine. Run via: npx tsx tests/snapshots/snapshot-b5.mjs");
  console.error(err.message);
  process.exit(2);
}
const { computeHoleResult, computeRoundResult } = engineMod;

// ── PART 1: Live-data 2-Ball regression ────────────────────────────────────

const { data: rounds } = await supabase
  .from("rounds")
  .select("id, played_on, format")
  .order("id");

const { data: rps } = await supabase
  .from("round_players")
  .select("id, round_id, tee_id, team_number, course_handicap")
  .gt("team_number", 0)
  .not("tee_id", "is", null);

const rpsByRound = new Map();
for (const rp of rps || []) {
  if (!rpsByRound.has(rp.round_id)) rpsByRound.set(rp.round_id, []);
  rpsByRound.get(rp.round_id).push(rp);
}

const allRpIds = (rps || []).map(r => r.id);
const { data: scores } = allRpIds.length
  ? await supabase.from("scores").select("round_player_id, hole_number, strokes").in("round_player_id", allRpIds)
  : { data: [] };

const scoreMap = {};
for (const s of scores || []) {
  if (!scoreMap[s.round_player_id]) scoreMap[s.round_player_id] = {};
  scoreMap[s.round_player_id][s.hole_number] = s.strokes;
}

const teeIds = [...new Set((rps || []).map(r => r.tee_id))];
const holesByTee = {};
for (const teeId of teeIds) {
  const { data: h } = await supabase
    .from("holes")
    .select("hole_number, par, stroke_index")
    .eq("tee_id", teeId)
    .order("hole_number");
  holesByTee[teeId] = h || [];
}

let comparisons = 0;
const mismatches = [];
for (const round of (rounds || [])) {
  const teamPlayers = rpsByRound.get(round.id) || [];
  if (teamPlayers.length === 0) continue;

  const byTeam = {};
  for (const rp of teamPlayers) {
    if (!byTeam[rp.team_number]) byTeam[rp.team_number] = [];
    byTeam[rp.team_number].push(rp);
  }
  for (const team of Object.values(byTeam)) team.sort((a, b) => a.id - b.id);

  for (const [teamNum, players] of Object.entries(byTeam)) {
    const firstTee = players[0]?.tee_id;
    const holes = holesByTee[firstTee] || [];
    for (const hole of holes) {
      for (const mode of ["gross", "net"]) {
        const legacy = legacyHoleTeamScore(players, holesByTee, scoreMap, hole.hole_number, mode);
        const engine = computeHoleResult({
          format: round.format || "2_ball",
          formatConfig: { basis: mode, best_n: 2, override_holes: [] },
          hole: { holeNumber: hole.hole_number, par: hole.par, strokeIndex: hole.stroke_index },
          players: players.map(p => ({
            playerId: String(p.id),
            grossScore: scoreMap[p.id]?.[hole.hole_number] ?? null,
            courseHandicap: p.course_handicap,
          })),
        }).teamScore;
        comparisons++;
        if (legacy !== engine) {
          mismatches.push({ round_id: round.id, team: Number(teamNum), hole: hole.hole_number, mode, legacy, engine });
        }
      }
    }
  }
}
console.log(`Part 1 — live-data 2-Ball regression: ${comparisons} comparisons across ${(rounds || []).length} rounds.`);
if (mismatches.length === 0) {
  console.log("Part 1: All match. ✓");
} else {
  console.log(`Part 1: MISMATCHES: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 20)) console.log(JSON.stringify(m));
  process.exit(1);
}

// ── PART 2: Synthetic 2-Ball with overrides on holes 9 and 18 ──────────────

const failures2 = [];
function check2(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures2.push({ label, actual: a, expected: e });
}

// Build an 18-hole round, 4 players, scores 4/5/6/7 every hole.
// Overrides on holes 9 and 18: those holes sum all 4 (=22).
// Other 16 holes: best-2 = 4+5 = 9.
// Total teamScore = 22+22 + 9*16 = 44 + 144 = 188.
const holes18 = Array.from({ length: 18 }, (_, i) => ({
  holeNumber: i + 1,
  par: 4,
  strokeIndex: i + 1,
}));
const players4 = [
  { playerId: "A", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, 4])) },
  { playerId: "B", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, 5])) },
  { playerId: "C", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, 6])) },
  { playerId: "D", courseHandicap: 0, grossScores: Object.fromEntries(holes18.map(h => [h.holeNumber, 7])) },
];

const overrideRound = computeRoundResult({
  format: "2_ball",
  formatConfig: { basis: "net", best_n: 2, override_holes: [9, 18] },
  holes: holes18,
  players: players4,
});

check2("Override round teamScore (22+22 + 9*16)", overrideRound.teamScore, 22 + 22 + 9 * 16);
check2("Override round holesScored", overrideRound.holesScored, 18);
// teamParAtScored: hole 9 par × 4 + hole 18 par × 4 + 16 holes × par × 2 = 16 + 16 + 16*8 = 160
check2("Override round teamParAtScored", overrideRound.teamParAtScored, 4 * 4 + 4 * 4 + 16 * (4 * 2));

// Per-hole spot checks
const hole9Result = overrideRound.perHole.find(h => h.holeNumber === 9)?.result;
check2("Hole 9 (override) teamScore", hole9Result?.teamScore, 22);
check2("Hole 9 (override) contributors", hole9Result?.contributingPlayerIds, ["A", "B", "C", "D"]);

const hole5Result = overrideRound.perHole.find(h => h.holeNumber === 5)?.result;
check2("Hole 5 (no override) teamScore", hole5Result?.teamScore, 9);
check2("Hole 5 (no override) contributors", hole5Result?.contributingPlayerIds, ["A", "B"]);

const hole18Result = overrideRound.perHole.find(h => h.holeNumber === 18)?.result;
check2("Hole 18 (override) teamScore", hole18Result?.teamScore, 22);
check2("Hole 18 (override) contributors", hole18Result?.contributingPlayerIds, ["A", "B", "C", "D"]);

console.log();
if (failures2.length === 0) {
  console.log("Part 2 — synthetic 2-Ball with overrides: all assertions pass ✓");
} else {
  console.log(`Part 2: ${failures2.length} FAILURES`);
  for (const f of failures2) console.log(JSON.stringify(f));
  process.exit(1);
}

// ── PART 3: GOBS House override is a no-op ─────────────────────────────────

const failures3 = [];
function check3(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures3.push({ label, actual: a, expected: e });
}

// Same scores, same round, computed twice: with and without override.
const gobsPlayers = [
  { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 6, 3: 3 } }, // par=2, dbl bogey=-1, birdie=3
  { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 7, 3: 4 } }, // bogey=1, triple bogey=-1, par=2
];
const gobsHoles = [
  { holeNumber: 1, par: 4, strokeIndex: 10 },
  { holeNumber: 2, par: 4, strokeIndex: 5 },
  { holeNumber: 3, par: 4, strokeIndex: 1 },
];

const gobsWithoutOverride = computeRoundResult({
  format: "gobs_house",
  formatConfig: { basis: "net", override_holes: [] },
  holes: gobsHoles,
  players: gobsPlayers,
});

const gobsWithOverride = computeRoundResult({
  format: "gobs_house",
  formatConfig: { basis: "net", override_holes: [1, 2, 3] }, // every hole flagged; should change nothing
  holes: gobsHoles,
  players: gobsPlayers,
});

check3("GOBS House teamScore identical with vs without override", gobsWithOverride.teamScore, gobsWithoutOverride.teamScore);
check3("GOBS House perHole length identical", gobsWithOverride.perHole.length, gobsWithoutOverride.perHole.length);
for (let i = 0; i < gobsWithoutOverride.perHole.length; i++) {
  const a = gobsWithoutOverride.perHole[i].result;
  const b = gobsWithOverride.perHole[i].result;
  check3(`GOBS House hole ${i + 1} teamScore identical`, b.teamScore, a.teamScore);
}

// Sanity: the actual values
// Hole 1: par=2 + bogey=1 = 3
// Hole 2: dbl bogey=-1 + triple bogey=-1 = -2
// Hole 3: birdie=3 + par=2 = 5
// Total: 3 + (-2) + 5 = 6
check3("GOBS House total round teamScore", gobsWithoutOverride.teamScore, 6);

console.log();
if (failures3.length === 0) {
  console.log("Part 3 — synthetic GOBS House override no-op: all assertions pass ✓");
} else {
  console.log(`Part 3: ${failures3.length} FAILURES`);
  for (const f of failures3) console.log(JSON.stringify(f));
  process.exit(1);
}

console.log();
console.log("snapshot:b5 PASSED");
