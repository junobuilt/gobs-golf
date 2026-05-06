// B2 snapshot script: verifies the new scoring engine produces identical
// per-hole and per-round team scores to the inline 2-Ball math that lived in
// scorecard/page.tsx and summary/page.tsx before the B2 refactor.
//
// Workflow expected by Phase B (and reused by B3, B4, B5):
//   1. Run BEFORE rewiring components: confirms engine math matches legacy.
//   2. Run AFTER rewiring components: confirms data hasn't drifted.
// Any mismatch fails the script with non-zero exit and full per-hole context.
//
// Usage: node tests/snapshots/snapshot-b2.mjs
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

// ── Legacy inline 2-Ball math (copied verbatim from the pre-B2 scorecard) ──
// Kept in this script as the "ground truth" we compare the engine against.

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
  // Mirrors the legacy summary best-2 loop and scorecard best-2 loop.
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

// ── Engine import ─────────────────────────────────────────────────────────
// Loaded dynamically so this file can run as plain ESM. The engine TS files
// would need transpilation for direct import, so we point at the .ts source
// via tsx/ts-node when available — otherwise the script will surface that
// gap. Vitest already type-checks the engine; this script focuses on data.

let engineMod;
try {
  // Lazy-load via tsx if installed
  await import("tsx/esm/api").then(api => api.register());
} catch {
  // tsx not installed; will try direct .ts import (Node 22+ may support)
}

try {
  engineMod = await import(pathToFileURL("./src/lib/scoring/engine.ts").href);
} catch (err) {
  console.error("Failed to import engine. If running on Node <22, install tsx: npm i -D tsx");
  console.error(err.message);
  process.exit(2);
}

const { computeHoleResult } = engineMod;

// ── Query data ────────────────────────────────────────────────────────────

const { data: rounds } = await supabase
  .from("rounds")
  .select("id, played_on, format, format_config")
  .order("id");

if (!rounds?.length) {
  console.log("No rounds found. Nothing to verify.");
  process.exit(0);
}

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

// ── Compare per (round, team, hole, mode) ─────────────────────────────────

let comparisons = 0;
const mismatches = [];

for (const round of rounds) {
  const teamPlayers = rpsByRound.get(round.id) || [];
  if (teamPlayers.length === 0) continue;

  // Group by team
  const byTeam = {};
  for (const rp of teamPlayers) {
    if (!byTeam[rp.team_number]) byTeam[rp.team_number] = [];
    byTeam[rp.team_number].push(rp);
  }
  // Stable insertion order: order by id ASC (matches scorecard's .order("id"))
  for (const team of Object.values(byTeam)) {
    team.sort((a, b) => a.id - b.id);
  }

  for (const [teamNum, players] of Object.entries(byTeam)) {
    // Determine the "hole list" — derive from the first player's tee
    const firstTee = players[0]?.tee_id;
    const holes = holesByTee[firstTee] || [];

    for (const hole of holes) {
      for (const mode of ["gross", "net"]) {
        const legacy = legacyHoleTeamScore(players, holesByTee, scoreMap, hole.hole_number, mode);

        const engineInput = {
          format: round.format || "2_ball",
          formatConfig: { basis: mode, best_n: 2, override_holes: [] },
          hole: { holeNumber: hole.hole_number, par: hole.par, strokeIndex: hole.stroke_index },
          players: players.map(p => ({
            playerId: String(p.id),
            grossScore: scoreMap[p.id]?.[hole.hole_number] ?? null,
            courseHandicap: p.course_handicap,
          })),
        };
        const engineResult = computeHoleResult(engineInput);
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
            playerCount: players.length,
            scores: players.map(p => ({ id: p.id, ch: p.course_handicap, gross: scoreMap[p.id]?.[hole.hole_number] ?? null })),
          });
        }
      }
    }
  }
}

console.log(`Compared ${comparisons} (round, team, hole, mode) tuples across ${rounds.length} rounds.`);
if (mismatches.length === 0) {
  console.log("All match. ✓");
  process.exit(0);
} else {
  console.log(`MISMATCHES: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 20)) {
    console.log(JSON.stringify(m));
  }
  process.exit(1);
}
