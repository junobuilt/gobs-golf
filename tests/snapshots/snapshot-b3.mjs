// B3 snapshot script:
//   Part 1 — Live-data 2-Ball regression check. Confirms the engine, after
//            adding 3-Ball, still produces identical team scores to the
//            legacy inline 2-Ball math on every existing round.
//   Part 2 — Synthetic 3-Ball assertion. No 3-Ball production rounds exist
//            yet, so we hand-craft inputs with known expected outputs and
//            assert exact match against the engine.
//
// Usage: npm run snapshot:b3   (or: npx tsx tests/snapshots/snapshot-b3.mjs)
//
// Reads .env.local for Supabase credentials. Anon-key only — read-only queries.

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

// ── Legacy inline 2-Ball math (verbatim copy preserved as ground truth) ──

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

// ── Engine import via tsx-registered loader ─────────────────────────────────

let engineMod;
try {
  engineMod = await import(pathToFileURL("./src/lib/scoring/engine.ts").href);
} catch (err) {
  console.error("Failed to import engine. Run via: npx tsx tests/snapshots/snapshot-b3.mjs");
  console.error(err.message);
  process.exit(2);
}

const { computeHoleResult, computeRoundResult } = engineMod;

// ── PART 1: Live-data 2-Ball regression check ────────────────────────────

const { data: rounds } = await supabase
  .from("rounds")
  .select("id, played_on, format, format_config")
  .order("id");

const { data: rps } = await supabase
  .from("round_players")
  .select("id, round_id, player_id, tee_id, team_number, course_handicap")
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
  for (const team of Object.values(byTeam)) {
    team.sort((a, b) => a.id - b.id);
  }

  for (const [teamNum, players] of Object.entries(byTeam)) {
    const firstTee = players[0]?.tee_id;
    const holes = holesByTee[firstTee] || [];

    for (const hole of holes) {
      for (const mode of ["gross", "net"]) {
        const legacy = legacyHoleTeamScore(players, holesByTee, scoreMap, hole.hole_number, mode);
        const engineResult = computeHoleResult({
          format: round.format || "2_ball",
          formatConfig: { basis: mode, best_n: 2, override_holes: [] },
          hole: { holeNumber: hole.hole_number, par: hole.par, strokeIndex: hole.stroke_index },
          players: players.map(p => ({
            playerId: String(p.id),
            grossScore: scoreMap[p.id]?.[hole.hole_number] ?? null,
            courseHandicap: p.course_handicap,
          })),
        });
        const engine = engineResult.teamScore;

        comparisons++;
        if (legacy !== engine) {
          mismatches.push({
            round_id: round.id,
            played_on: round.played_on,
            team: Number(teamNum),
            hole: hole.hole_number,
            mode,
            legacy,
            engine,
          });
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

// ── PART 2: Synthetic 3-Ball assertion ───────────────────────────────────

const config3Ball = { basis: "net", best_n: 3, override_holes: [] };

// Hole 1: par 4, SI 10. Scores 4/5/6/7 with CH=0. Best 3 net = 4+5+6 = 15.
const hole1 = computeHoleResult({
  format: "3_ball",
  formatConfig: config3Ball,
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },
    { playerId: "B", grossScore: 5, courseHandicap: 0 },
    { playerId: "C", grossScore: 6, courseHandicap: 0 },
    { playerId: "D", grossScore: 7, courseHandicap: 0 },
  ],
});
const expectHole1 = { teamScore: 15, contributing: ["A", "B", "C"] };

// Hole 2: par 4, SI 1. A has CH=22 → 2 strokes; gross 6 → net 4.
//         Others CH=0 gross 5/6/7 → net 5/6/7. Best 3 = 4+5+6 = 15.
const hole2 = computeHoleResult({
  format: "3_ball",
  formatConfig: config3Ball,
  hole: { holeNumber: 2, par: 4, strokeIndex: 1 },
  players: [
    { playerId: "A", grossScore: 6, courseHandicap: 22 },
    { playerId: "B", grossScore: 5, courseHandicap: 0 },
    { playerId: "C", grossScore: 6, courseHandicap: 0 },
    { playerId: "D", grossScore: 7, courseHandicap: 0 },
  ],
});
const expectHole2 = { teamScore: 15, contributing: ["A", "B", "C"] };

// Hole 3: par 4, SI 5. B is null. A/C/D scored 5/5/5. Best 3 = 5+5+5 = 15.
const hole3 = computeHoleResult({
  format: "3_ball",
  formatConfig: config3Ball,
  hole: { holeNumber: 3, par: 4, strokeIndex: 5 },
  players: [
    { playerId: "A", grossScore: 5, courseHandicap: 0 },
    { playerId: "B", grossScore: null, courseHandicap: 0 },
    { playerId: "C", grossScore: 5, courseHandicap: 0 },
    { playerId: "D", grossScore: 5, courseHandicap: 0 },
  ],
});
const expectHole3 = { teamScore: 15, contributing: ["A", "C", "D"] };

const failures = [];
function check(label, actual, expected) {
  const actualKey = JSON.stringify({ teamScore: actual.teamScore, contributing: actual.contributingPlayerIds });
  const expectedKey = JSON.stringify({ teamScore: expected.teamScore, contributing: expected.contributing });
  if (actualKey !== expectedKey) {
    failures.push({ label, actual: actualKey, expected: expectedKey });
  }
}
check("Hole 1 — best-3-of-4 no strokes", hole1, expectHole1);
check("Hole 2 — best-3-of-4 with CH=22 on SI=1", hole2, expectHole2);
check("Hole 3 — best-3-of-4 with one null", hole3, expectHole3);

// Round-level aggregate: 3 holes × 15 = 45
const round = computeRoundResult({
  format: "3_ball",
  formatConfig: config3Ball,
  holes: [
    { holeNumber: 1, par: 4, strokeIndex: 10 },
    { holeNumber: 2, par: 4, strokeIndex: 1 },
    { holeNumber: 3, par: 4, strokeIndex: 5 },
  ],
  players: [
    { playerId: "A", courseHandicap: 22, grossScores: { 1: 4, 2: 6, 3: 5 } },
    { playerId: "B", courseHandicap: 0,  grossScores: { 1: 5, 2: 5, 3: null } },
    { playerId: "C", courseHandicap: 0,  grossScores: { 1: 6, 2: 6, 3: 5 } },
    { playerId: "D", courseHandicap: 0,  grossScores: { 1: 7, 2: 7, 3: 5 } },
  ],
});
// CH=22 distribution: fullStrokes=1, remainder=4 (SI 1-4 get 2 strokes; SI 5-18 get 1).
// Hole 1 (SI 10 → A gets 1 stroke): A net=3, B=5, C=6, D=7. Best 3 = 3+5+6 = 14.
// Hole 2 (SI 1  → A gets 2 strokes): A net=4, B=5, C=6, D=7. Best 3 = 4+5+6 = 15.
// Hole 3 (SI 5  → A gets 1 stroke): A net=4, B=null, C=5, D=5. Best 3 = 4+5+5 = 14.
// Round total = 14 + 15 + 14 = 43.
const expectedRoundTotal = 43;
if (round.teamScore !== expectedRoundTotal) {
  failures.push({
    label: "Round-level aggregate",
    actual: `teamScore=${round.teamScore}`,
    expected: `teamScore=${expectedRoundTotal}`,
  });
}

console.log();
console.log(`Part 2 — synthetic 3-Ball: ${failures.length === 0 ? "all assertions pass" : `${failures.length} FAILURES`}`);
if (failures.length > 0) {
  for (const f of failures) console.log(JSON.stringify(f));
  process.exit(1);
}
console.log("Part 2: All match. ✓");
console.log();
console.log("snapshot:b3 PASSED");
