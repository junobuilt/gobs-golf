// B6 snapshot script: Best Ball (best-1 net per hole).
//   Part 1 — Live-data 2-Ball regression check. Same shape as b2/b3/b4/b5
//            Part 1 (with TD11 format-filter guard).
//   Part 2 — Synthetic Best Ball assertions. No production Best Ball rounds
//            yet, so hand-crafted inputs with known outputs.
//
// Usage: npm run snapshot:b6   (or: npx tsx tests/snapshots/snapshot-b6.mjs)

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

// Legacy inline 2-Ball math, kept as the regression ground truth.
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

let engineMod;
try {
  engineMod = await import(pathToFileURL("./src/lib/scoring/engine.ts").href);
} catch (err) {
  console.error("Failed to import engine. Run via: npx tsx tests/snapshots/snapshot-b6.mjs");
  console.error(err.message);
  process.exit(2);
}
const { computeHoleResult, computeRoundResult } = engineMod;

// ── PART 1: Live-data 2-Ball regression check ──────────────────────────────

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
  // TD11 guard — only 2-Ball (or null/legacy) rounds match the legacy comparator.
  if (round.format && round.format !== "2_ball") continue;
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

// ── PART 2: Synthetic Best Ball (best-1 net per hole) ──────────────────────

const failures2 = [];
function check2(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures2.push({ label, actual: a, expected: e });
}

// 4-player team, all CH=0 → net == gross.
// Hole 1 (par 4): scores 4, 5, 6, 7. Best 1 = 4 → contributor A.
const hole1 = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },
    { playerId: "B", grossScore: 5, courseHandicap: 0 },
    { playerId: "C", grossScore: 6, courseHandicap: 0 },
    { playerId: "D", grossScore: 7, courseHandicap: 0 },
  ],
});
check2("Best Ball hole teamScore (best of 4/5/6/7 = 4)", hole1.teamScore, 4);
check2("Best Ball hole contributors (single)", hole1.contributingPlayerIds, ["A"]);

// Handicap can flip who wins. CH=18 on player C (SI 1 = 1 stroke).
const hole1Hcp = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 1 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },  // net 4
    { playerId: "C", grossScore: 4, courseHandicap: 18 }, // net 3 (1 stroke)
  ],
});
check2("Best Ball net wins over gross when handicap pulls a tie", hole1Hcp.teamScore, 3);
check2("Best Ball net winner is the handicapped player", hole1Hcp.contributingPlayerIds, ["C"]);

// 3-player team is still best-1.
const hole3p = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 5, courseHandicap: 0 },
    { playerId: "B", grossScore: 4, courseHandicap: 0 },
    { playerId: "C", grossScore: 6, courseHandicap: 0 },
  ],
});
check2("Best Ball 3-player teamScore (best of 5/4/6 = 4)", hole3p.teamScore, 4);
check2("Best Ball 3-player contributor", hole3p.contributingPlayerIds, ["B"]);

// 2-player team still best-1 (B is lower).
const hole2p = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 5, courseHandicap: 0 },
    { playerId: "B", grossScore: 4, courseHandicap: 0 },
  ],
});
check2("Best Ball 2-player teamScore (best of 5/4 = 4)", hole2p.teamScore, 4);

// Tie-break: first-in-input order wins (engine contract).
const holeTie = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },
    { playerId: "B", grossScore: 4, courseHandicap: 0 }, // tied
    { playerId: "C", grossScore: 5, courseHandicap: 0 },
  ],
});
check2("Best Ball tie — input order wins", holeTie.contributingPlayerIds, ["A"]);

// Override hole — all non-null contribute, sum wins.
const holeOverride = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [9] },
  hole: { holeNumber: 9, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: 4, courseHandicap: 0 },
    { playerId: "B", grossScore: 5, courseHandicap: 0 },
    { playerId: "C", grossScore: 6, courseHandicap: 0 },
    { playerId: "D", grossScore: 7, courseHandicap: 0 },
  ],
});
check2("Best Ball override hole sums all 4", holeOverride.teamScore, 22);
check2("Best Ball override hole all contribute", holeOverride.contributingPlayerIds, ["A", "B", "C", "D"]);

// Round-level: 3 holes par 4, contributing scores 4 / 5 / 4. teamParAtScored
// must scale by contributor count (1 per non-override hole).
const round = computeRoundResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  holes: [
    { holeNumber: 1, par: 4, strokeIndex: 10 },
    { holeNumber: 2, par: 4, strokeIndex: 5 },
    { holeNumber: 3, par: 4, strokeIndex: 1 },
  ],
  players: [
    { playerId: "A", courseHandicap: 0, grossScores: { 1: 4, 2: 6, 3: 5 } },
    { playerId: "B", courseHandicap: 0, grossScores: { 1: 5, 2: 5, 3: 4 } },
    { playerId: "C", courseHandicap: 0, grossScores: { 1: 6, 2: 7, 3: 6 } },
  ],
});
// Best per hole: 4, 5, 4 → teamScore = 13.
check2("Best Ball round teamScore (4+5+4)", round.teamScore, 13);
// teamParAtScored = par × 1 contributor per hole × 3 holes = 12.
check2("Best Ball round teamParAtScored (par × 1 × 3)", round.teamParAtScored, 12);
check2("Best Ball round holesScored", round.holesScored, 3);

// All players null on a hole → teamScore null on that hole.
const holeNull = computeHoleResult({
  format: "best_ball",
  formatConfig: { basis: "net", override_holes: [] },
  hole: { holeNumber: 1, par: 4, strokeIndex: 10 },
  players: [
    { playerId: "A", grossScore: null, courseHandicap: 0 },
    { playerId: "B", grossScore: null, courseHandicap: 0 },
  ],
});
check2("Best Ball all-null hole teamScore is null", holeNull.teamScore, null);
check2("Best Ball all-null hole contributors", holeNull.contributingPlayerIds, []);

console.log();
if (failures2.length === 0) {
  console.log("Part 2 — synthetic Best Ball: all assertions pass ✓");
} else {
  console.log(`Part 2: ${failures2.length} FAILURES`);
  for (const f of failures2) console.log(JSON.stringify(f));
  process.exit(1);
}

console.log();
console.log("snapshot:b6 PASSED");
