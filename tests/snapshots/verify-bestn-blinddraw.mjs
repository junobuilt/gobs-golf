// Belt-and-suspenders verification for the best-N blind-draw fix.
// Runs the REAL engine (computeRoundResult) over the 5 affected finalized
// rounds, both WITHOUT the fill (old behavior) and WITH the fill (fixed
// behavior), and reports before/after/delta. Confirms the SQL replication used
// in the Step 1 report matches actual engine semantics.
//
// Usage: npx tsx tests/snapshots/verify-bestn-blinddraw.mjs

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

const { computeRoundResult } = await import(
  pathToFileURL("./src/lib/scoring/engine.ts").href
);

// SQL-derived expectations from the Step 1 report (current = before fix,
// expected = after fix). The script asserts the live engine reproduces these.
const EXPECTED = {
  101: { before: -11, after: -17 },
  118: { before: -4, after: -3 },
  141: { before: 12, after: -1 },
  147: { before: 8, after: 1 },
  161: { before: 0, after: -11 },
};

const ROUND_IDS = [101, 118, 141, 147, 161];

function totalOf(result) {
  // Mirrors results.ts:276 — total = rawTeamScore + blindDrawTotal - teamPar.
  return (result.teamScore ?? 0) + result.blindDrawTotal - result.teamParAtScored;
}

let failures = 0;

for (const roundId of ROUND_IDS) {
  const { data: round } = await supabase
    .from("rounds")
    .select("id, format, format_config")
    .eq("id", roundId)
    .single();

  const fc = round.format_config || {};
  const useGross = (fc.scoring_basis || "net") === "gross";

  const { data: bd } = await supabase
    .from("blind_draws")
    .select("short_team_number, drawn_player_id, hole_range_start, hole_range_end")
    .eq("round_id", roundId)
    .single();

  // All round_players for the round (need short-team members + the drawn
  // player's own row for their tee/CH/scores).
  const { data: rps } = await supabase
    .from("round_players")
    .select("id, player_id, team_number, tee_id, course_handicap")
    .eq("round_id", roundId)
    .gt("team_number", 0);

  const shortTeam = rps.filter(r => r.team_number === bd.short_team_number);
  const drawnRp = rps.find(r => r.player_id === bd.drawn_player_id);

  const rpIds = rps.map(r => r.id);
  const { data: scores } = await supabase
    .from("scores")
    .select("round_player_id, hole_number, strokes")
    .in("round_player_id", rpIds);

  const scoresByRp = {};
  for (const s of scores) {
    (scoresByRp[s.round_player_id] ??= {})[s.hole_number] = s.strokes;
  }

  const teeIds = [...new Set(rps.map(r => r.tee_id))];
  const holesByTee = {};
  for (const teeId of teeIds) {
    const { data: h } = await supabase
      .from("holes")
      .select("hole_number, par, stroke_index")
      .eq("tee_id", teeId)
      .order("hole_number");
    holesByTee[teeId] = h.map(r => ({
      holeNumber: r.hole_number,
      par: r.par,
      strokeIndex: r.stroke_index,
    }));
  }

  const teamHoles = holesByTee[shortTeam[0].tee_id];
  const playersForEngine = shortTeam.map(rp => ({
    playerId: String(rp.id),
    courseHandicap: useGross ? 0 : rp.course_handicap,
    grossScores: scoresByRp[rp.id] || {},
  }));

  const blindDrawInputs = [
    {
      drawnPlayerId: String(drawnRp.id),
      drawnPlayerCourseHandicap: useGross ? 0 : drawnRp.course_handicap,
      drawnPlayerScores: scoresByRp[drawnRp.id] || {},
      drawnPlayerHoles: holesByTee[drawnRp.tee_id] || [],
      holeRangeStart: bd.hole_range_start,
      holeRangeEnd: bd.hole_range_end,
    },
  ];

  const engineConfig = { ...fc, basis: useGross ? "gross" : "net" };

  const before = computeRoundResult({
    format: round.format,
    formatConfig: engineConfig,
    holes: teamHoles,
    players: playersForEngine,
    // No blindDraws → reproduces the pre-fix behavior (best-N ignored fills).
  });
  const after = computeRoundResult({
    format: round.format,
    formatConfig: engineConfig,
    holes: teamHoles,
    players: playersForEngine,
    blindDraws: blindDrawInputs,
  });

  const tb = totalOf(before);
  const ta = totalOf(after);
  const exp = EXPECTED[roundId];
  const ok = tb === exp.before && ta === exp.after;
  if (!ok) failures++;

  console.log(
    `round ${roundId} (${round.format}, team ${bd.short_team_number}): ` +
      `before=${tb} after=${ta} delta=${ta - tb}  ` +
      `[SQL expected before=${exp.before} after=${exp.after}]  ${ok ? "✓" : "✗ MISMATCH"}`,
  );
}

console.log();
if (failures === 0) {
  console.log("verify-bestn-blinddraw PASSED — engine matches SQL replication ✓");
} else {
  console.log(`verify-bestn-blinddraw FAILED — ${failures} mismatch(es)`);
  process.exit(1);
}
