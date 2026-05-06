// B4 snapshot script:
//   Part 1 — Live-data 2-Ball regression check. Existing 2_ball rounds must
//            still produce identical results to the legacy inline math after
//            the Stableford additions and the bestN gating in
//            computeRoundResult.
//   Part 2 — Synthetic Stableford Standard assertion.
//   Part 3 — Synthetic Stableford Modified assertion (custom point_values).
//   Part 4 — Synthetic GOBS House assertion (negative totals).
//
// Usage: npm run snapshot:b4

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
  console.error("Failed to import engine. Run via: npx tsx tests/snapshots/snapshot-b4.mjs");
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

// ── PART 2: Synthetic Stableford Standard ──────────────────────────────────

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push({ label, actual: a, expected: e });
}

// Hole 1, par 4, SI 10. Players: 4 (par), 3 (birdie), 5 (bogey), 6 (dbl bogey).
// Expected: 2+3+1+0 = 6 points.
const standardHole = computeHoleResult({
  format: "stableford_standard",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },
    { playerId: "B", grossScore: 3, courseHandicap: 0 },
    { playerId: "C", grossScore: 5, courseHandicap: 0 },
    { playerId: "D", grossScore: 6, courseHandicap: 0 },
  ],
});
check("Standard mixed-team hole — teamScore", standardHole.teamScore, 6);
check("Standard mixed-team hole — A points (par)", standardHole.perPlayer.find(p => p.playerId === "A")?.points, 2);
check("Standard mixed-team hole — B points (birdie)", standardHole.perPlayer.find(p => p.playerId === "B")?.points, 3);
check("Standard mixed-team hole — C points (bogey)", standardHole.perPlayer.find(p => p.playerId === "C")?.points, 1);
check("Standard mixed-team hole — D points (dbl bogey)", standardHole.perPlayer.find(p => p.playerId === "D")?.points, 0);

// Round-level: 3 holes of standardHole-equivalent → 18 points total.
const standardRound = computeRoundResult({
  format: "stableford_standard",
  formatConfig: { basis: "net", override_holes: [] },
  holes: [
    { holeNumber: 1, par: 4, strokeIndex: 10 },
    { holeNumber: 2, par: 4, strokeIndex: 5 },
    { holeNumber: 3, par: 4, strokeIndex: 1 },
  ],
  players: [
    { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 3, 3: 5 } }, // 2+3+1 = 6
    { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 4, 3: 6 } }, // 1+2+0 = 3
  ],
});
check("Standard round teamScore (6 + 3)", standardRound.teamScore, 9);
check("Standard round teamParAtScored is 0", standardRound.teamParAtScored, 0);
check("Standard round holesScored is 3", standardRound.holesScored, 3);

console.log();
if (failures.length === 0) {
  console.log("Part 2 — synthetic Stableford Standard: all assertions pass ✓");
} else {
  console.log(`Part 2: ${failures.length} FAILURES`);
  for (const f of failures) console.log(JSON.stringify(f));
  process.exit(1);
}

// ── PART 3: Synthetic Stableford Modified ──────────────────────────────────

const failuresM = [];
function checkM(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failuresM.push({ label, actual: a, expected: e });
}

// Custom values: birdie=5, eagle=8, others default.
const modifiedHole = computeHoleResult({
  format: "stableford_modified",
  formatConfig: {
    basis: "net",
    override_holes: [],
    point_values: { birdie: 5, eagle: 8 },
  },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par → 2 (default)
    { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie → 5 (custom)
    { playerId: "C", grossScore: 2, courseHandicap: 0 }, // eagle → 8 (custom)
    { playerId: "D", grossScore: 5, courseHandicap: 0 }, // bogey → 1 (default)
  ],
});
checkM("Modified hole teamScore (2+5+8+1)", modifiedHole.teamScore, 16);
checkM("Modified A points (par default)", modifiedHole.perPlayer.find(p => p.playerId === "A")?.points, 2);
checkM("Modified B points (birdie custom)", modifiedHole.perPlayer.find(p => p.playerId === "B")?.points, 5);
checkM("Modified C points (eagle custom)", modifiedHole.perPlayer.find(p => p.playerId === "C")?.points, 8);
checkM("Modified D points (bogey default)", modifiedHole.perPlayer.find(p => p.playerId === "D")?.points, 1);

console.log();
if (failuresM.length === 0) {
  console.log("Part 3 — synthetic Stableford Modified: all assertions pass ✓");
} else {
  console.log(`Part 3: ${failuresM.length} FAILURES`);
  for (const f of failuresM) console.log(JSON.stringify(f));
  process.exit(1);
}

// ── PART 4: Synthetic GOBS House ───────────────────────────────────────────

const failuresG = [];
function checkG(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failuresG.push({ label, actual: a, expected: e });
}

// Mixed team with at least one double-bogey-or-worse to exercise the -1 path.
const gobsHole = computeHoleResult({
  format: "gobs_house",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 }, // par → 2
    { playerId: "B", grossScore: 3, courseHandicap: 0 }, // birdie → 3
    { playerId: "C", grossScore: 6, courseHandicap: 0 }, // dbl bogey → -1
    { playerId: "D", grossScore: 8, courseHandicap: 0 }, // quad+ → -1 (flat)
  ],
});
checkG("GOBS House hole teamScore (2+3-1-1)", gobsHole.teamScore, 3);
checkG("GOBS House A points (par)", gobsHole.perPlayer.find(p => p.playerId === "A")?.points, 2);
checkG("GOBS House B points (birdie)", gobsHole.perPlayer.find(p => p.playerId === "B")?.points, 3);
checkG("GOBS House C points (dbl bogey -1)", gobsHole.perPlayer.find(p => p.playerId === "C")?.points, -1);
checkG("GOBS House D points (quintuple bogey still -1)", gobsHole.perPlayer.find(p => p.playerId === "D")?.points, -1);

// Negative round total: 4 players each blow up on 2 holes → -8.
const gobsRound = computeRoundResult({
  format: "gobs_house",
  formatConfig: { basis: "net", override_holes: [] },
  holes: [
    { holeNumber: 1, par: 4, strokeIndex: 10 },
    { holeNumber: 2, par: 4, strokeIndex: 5 },
  ],
  players: [
    { playerId: "A", courseHandicap: 0, grossScores: { 1: 6, 2: 7 } }, // -1, -1
    { playerId: "B", courseHandicap: 0, grossScores: { 1: 7, 2: 8 } }, // -1, -1
    { playerId: "C", courseHandicap: 0, grossScores: { 1: 8, 2: 9 } }, // -1, -1
    { playerId: "D", courseHandicap: 0, grossScores: { 1: 9, 2: 10 } }, // -1, -1
  ],
});
checkG("GOBS House round teamScore (-8)", gobsRound.teamScore, -8);
checkG("GOBS House round teamParAtScored is 0", gobsRound.teamParAtScored, 0);

console.log();
if (failuresG.length === 0) {
  console.log("Part 4 — synthetic GOBS House: all assertions pass ✓");
} else {
  console.log(`Part 4: ${failuresG.length} FAILURES`);
  for (const f of failuresG) console.log(JSON.stringify(f));
  process.exit(1);
}

console.log();
console.log("snapshot:b4 PASSED");
