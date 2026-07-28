// Tournament match-play engine — PURE. No next / Supabase / React.
//
// Single source of truth: this module does NOT reimplement stroke-index
// allocation or net math. It reuses `getHandicapStrokes` (the scorecard "dots"
// allocator, src/lib/scoring/handicap.ts) and — for the greensomes pair — the
// Wave 1C `computeTeamHandicap` half-of-combined path. The one genuinely new
// rule is MATCH strokes (§2.1): everybody plays off the lowest handicap in the
// match. The derived per-hole quantity is always called `matchNet` (never
// `net`) — it uses MATCH strokes, so it legitimately differs from league net
// (which uses a player's own allowance-adjusted CH).

import { getHandicapStrokes } from "@/lib/scoring/handicap";
import { computeTeamHandicap } from "@/lib/scoring/teamHandicap";
import type {
  HoleOutcome,
  MatchInput,
  MatchResult,
  MatchResultRow,
  MatchState,
  MatchStatus,
  PointAdjustment,
  ResolvedResult,
  SidePoints,
  Standings,
  StandingsInPlayEntry,
  StandingsMatchInput,
} from "./types";

// ── Greensomes team handicap ────────────────────────────────────────────────
// Greensomes and foursomes share the SAME "half of combined, .5 up" allowance.
// That formula already lives in the scoring core as computeTeamHandicap's
// `alternate_shot` (2-player) branch — so this wrapper is the ONE place the
// alternate_shot token stands in for a greensomes pair. Flip
// GREENSOMES_TEAM_HANDICAP_METHOD to "sixty_forty" (60% low + 40% high, the
// other common greensomes convention) as a one-line change here + a golden
// update, if Dad confirms that instead. Nothing else in the codebase changes.
export const GREENSOMES_TEAM_HANDICAP_METHOD: "half_combined" | "sixty_forty" =
  "half_combined";

export function greensomesTeamHandicap(
  chA: number | null,
  chB: number | null,
): number {
  if (GREENSOMES_TEAM_HANDICAP_METHOD === "sixty_forty") {
    const a = chA ?? 0;
    const b = chB ?? 0;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return Math.round(0.6 * low + 0.4 * high); // .5 up (Math.round on the non-neg CHs we store)
  }
  // Default: half of combined, .5 up — reuse the scoring core, do not reimplement.
  return computeTeamHandicap("alternate_shot", [chA, chB]) ?? 0;
}

// ── Match strokes (§2.1) ────────────────────────────────────────────────────
// Everybody in a match plays off the LOWEST playing handicap among the match's
// UNITS (players for singles/four-ball, collapsed sides for greensomes). The low
// unit gets 0; nobody goes negative (clamp at 0).
//   matchStrokes(unit) = PH(unit) − min(PH across all units)
export function computeMatchStrokes(
  playingHandicaps: ReadonlyArray<number>,
): number[] {
  if (playingHandicaps.length === 0) return [];
  const min = Math.min(...playingHandicaps);
  return playingHandicaps.map((ph) => Math.max(0, ph - min));
}

// Per-hole matchNet for one scoring line: gross − strokes-on-hole, where the
// stroke allocation reuses getHandicapStrokes with the MATCH stroke count.
function lineMatchNets(
  gross: ReadonlyArray<number | null>,
  matchStrokes: number,
  input: MatchInput,
): (number | null)[] {
  return input.holes.map((h, i) => {
    const g = gross[i];
    if (g == null) return null;
    return g - getHandicapStrokes(matchStrokes, h.strokeIndex);
  });
}

// Each side's per-hole value, by format. null on a hole = that side has no
// score present there. `countingA`/`countingB` are set for four_ball_match ONLY
// (the 0|1 index of the player whose ball produced the side's net; null on an
// unresolved hole or a tie) and left undefined otherwise.
function sideHoleNets(input: MatchInput): {
  a: (number | null)[];
  b: (number | null)[];
  countingA?: (number | null)[];
  countingB?: (number | null)[];
} {
  const { format, sideA, sideB, holes } = input;

  if (format === "greensomes") {
    // Collapse each pair to one number, then §2.1 across the TWO sides.
    const phA = greensomesTeamHandicap(
      sideA.players[0]?.courseHandicap ?? null,
      sideA.players[1]?.courseHandicap ?? null,
    );
    const phB = greensomesTeamHandicap(
      sideB.players[0]?.courseHandicap ?? null,
      sideB.players[1]?.courseHandicap ?? null,
    );
    const [msA, msB] = computeMatchStrokes([phA, phB]);
    const teamNets = (
      teamGross: ReadonlyArray<number | null> | undefined,
      ms: number,
    ): (number | null)[] =>
      holes.map((h, i) => {
        const g = teamGross?.[i] ?? null;
        return g == null ? null : g - getHandicapStrokes(ms, h.strokeIndex);
      });
    return { a: teamNets(sideA.teamGross, msA), b: teamNets(sideB.teamGross, msB) };
  }

  // singles_match + four_ball_match: the UNITS are the individual players, and
  // PH = 100% of course handicap. For four-ball USGA prescribes 90% — the 100%
  // here is a DELIBERATE league departure (Dad's worked example). Singles at
  // 100% is NOT a departure: USGA prescribes full course handicap for singles
  // match play, then strokes off the low player. Do not "fix" singles to 90%.
  const aPlayers = sideA.players;
  const bPlayers = sideB.players;
  const phs = [...aPlayers, ...bPlayers].map((p) => p.courseHandicap ?? 0);
  const ms = computeMatchStrokes(phs);
  const aMs = ms.slice(0, aPlayers.length);
  const bMs = ms.slice(aPlayers.length);

  const aPerPlayer = aPlayers.map((p, i) => lineMatchNets(p.gross, aMs[i], input));
  const bPerPlayer = bPlayers.map((p, i) => lineMatchNets(p.gross, bMs[i], input));

  // A side's hole value = the BEST (lowest) matchNet among its present players;
  // null if none of the side's players has a score on that hole. (Singles has
  // one player, so "best of one" = that player's matchNet.)
  const bestPerHole = (perPlayer: (number | null)[][]): (number | null)[] =>
    holes.map((_, i) => {
      const vals = perPlayer
        .map((arr) => arr[i])
        .filter((v): v is number => v != null);
      return vals.length ? Math.min(...vals) : null;
    });

  // §10: which UNIT's ball produced the winning net, per hole. Four-ball only —
  // singles has one unit (nothing to mark). argmin over PRESENT balls; null when
  // no ball is present (unresolved) OR two balls tie the min (either counts).
  const countingPerHole = (perPlayer: (number | null)[][]): (number | null)[] =>
    holes.map((_, i) => {
      let bestIdx: number | null = null;
      let bestVal = Infinity;
      let tie = false;
      perPlayer.forEach((arr, idx) => {
        const v = arr[i];
        if (v == null) return;
        if (v < bestVal) {
          bestVal = v;
          bestIdx = idx;
          tie = false;
        } else if (v === bestVal) {
          tie = true;
        }
      });
      return bestIdx == null || tie ? null : bestIdx;
    });

  const isFourBall = format === "four_ball_match";
  return {
    a: bestPerHole(aPerPlayer),
    b: bestPerHole(bPerPlayer),
    countingA: isFourBall ? countingPerHole(aPerPlayer) : undefined,
    countingB: isFourBall ? countingPerHole(bPerPlayer) : undefined,
  };
}

// ── Match state (§2.4/§2.5) ─────────────────────────────────────────────────
export function computeMatchState(input: MatchInput): MatchState {
  const total = input.holes.length; // 18
  const { a, b, countingA, countingB } = sideHoleNets(input);

  const holeOutcomes: HoleOutcome[] = input.holes.map((_, i) => {
    const na = a[i];
    const nb = b[i];
    if (na == null || nb == null) return null; // unresolved — never a loss, never par
    if (na < nb) return "side_a";
    if (na > nb) return "side_b";
    return "halved";
  });

  // thru = holes resolved from hole 1 CONSECUTIVELY. A gap stops the count, and
  // everything past the gap is ignored for lead / closeout / result — this is
  // what stops a forgotten hole from silently deciding a match.
  let thru = 0;
  for (let i = 0; i < holeOutcomes.length; i++) {
    if (holeOutcomes[i] == null) break;
    thru++;
  }
  const firstUnresolvedHole = thru >= total ? null : thru + 1;

  // Scan holes 1..thru for the EARLIEST hole at which the closeout condition
  // holds (lead strictly EXCEEDS holes remaining — a lead equal to remaining is
  // dormie, NOT closed), then FREEZE all state at that hole. Every later hole is
  // ignored for lead / points / margin, even if a score was entered — so a match
  // decided 5&4 at 14 with 15-18 also filled in still records 5&4, not "1 UP".
  // The gap rule already bounded `thru` to consecutively-resolved holes, so the
  // scan never crosses a gap.
  let cumA = 0;
  let cumB = 0;
  let cumHalved = 0;
  let closeoutHole: number | null = null; // 1-indexed
  for (let h = 1; h <= thru; h++) {
    const o = holeOutcomes[h - 1];
    if (o === "side_a") cumA++;
    else if (o === "side_b") cumB++;
    else cumHalved++;
    if (Math.abs(cumA - cumB) > total - h) {
      closeoutHole = h;
      break; // freeze — cumA/cumB/cumHalved are now as of the closeout hole
    }
  }
  // With no closeout the loop ran the full `thru`, so the cumulatives already
  // reflect the current standing through `thru`.
  const effectiveThru = closeoutHole ?? thru;

  const pointsA = cumA + cumHalved * 0.5;
  const pointsB = cumB + cumHalved * 0.5;
  const holesUp = cumA - cumB;
  const lead = Math.abs(holesUp);
  const remaining = total - effectiveThru;

  // "Extra scores" = any score present on a hole AFTER an early closeout.
  let scoredBeyondCloseout = false;
  if (closeoutHole !== null && closeoutHole < total) {
    for (let i = closeoutHole; i < total; i++) {
      // hole (i+1) > closeoutHole; a[]/b[] are the per-hole side nets
      if (a[i] != null || b[i] != null) {
        scoredBeyondCloseout = true;
        break;
      }
    }
  }

  const closedEarly = closeoutHole !== null && closeoutHole < total;
  const complete = closeoutHole !== null || thru === total;

  let status: MatchStatus;
  let result: MatchResult;
  let closedOutHole: number | null;
  let margin: string | null;

  if (!complete) {
    status = thru === 0 ? "pending" : "in_progress";
    result = null;
    closedOutHole = null;
    margin = thru === 0 ? null : holesUp === 0 ? "AS" : `${lead} UP`;
  } else {
    status = "complete";
    result = holesUp > 0 ? "side_a" : holesUp < 0 ? "side_b" : "halved";
    closedOutHole = closedEarly ? closeoutHole : null;
    // Closed early → "{lead}&{remaining}". Decided on 18 → "{lead} UP" (or "AS").
    margin = closedEarly
      ? `${lead}&${remaining}`
      : holesUp === 0
        ? "AS"
        : `${lead} UP`;
  }

  return {
    holeOutcomes,
    pointsA,
    pointsB,
    holesUp,
    thru,
    firstUnresolvedHole,
    status,
    result,
    closedOutHole,
    margin,
    scoredBeyondCloseout,
    countingUnitA: countingA,
    countingUnitB: countingB,
  };
}

// ── Country points (§2.6) ───────────────────────────────────────────────────
export function countryPointsForResult(result: MatchResult): SidePoints {
  if (result === "side_a") return { a: 1, b: 0 };
  if (result === "side_b") return { a: 0, b: 1 };
  if (result === "halved") return { a: 0.5, b: 0.5 };
  return { a: 0, b: 0 }; // null → still in play, contributes nothing
}

// ── Admin override precedence (§2.7) ────────────────────────────────────────
// If the row is admin-sourced with a non-null result, that stored result wins
// UNCONDITIONALLY — even against a contradicting engine, even with zero scores.
// The engine's view is always returned alongside as `engineResult`, but the
// engine never overwrites an admin value. This is the path that must work when
// the engine is wrong and nobody is available to fix it.
export function resolveMatchResult(
  engineState: MatchState,
  matchRow: MatchResultRow,
): ResolvedResult {
  const engineResult = engineState.result;
  const adminWins = matchRow.result_source === "admin" && matchRow.result != null;
  const result = adminWins ? matchRow.result : engineResult;
  const source: "engine" | "admin" = adminWins ? "admin" : "engine";
  const pts = countryPointsForResult(result);
  return { source, result, engineResult, pointsA: pts.a, pointsB: pts.b };
}

// ── Tournament standings (§2.8) ─────────────────────────────────────────────
// No stored running total anywhere — always derived. `banked` = decided matches
// + point adjustments. `projected` = banked plus every live match counted as it
// currently stands (a live tie projects 0.5/0.5).
export function computeTournamentStandings(
  matches: ReadonlyArray<StandingsMatchInput>,
  adjustments: ReadonlyArray<PointAdjustment>,
): Standings {
  const banked: SidePoints = { a: 0, b: 0 };
  const projected: SidePoints = { a: 0, b: 0 };
  const inPlay: StandingsInPlayEntry[] = [];

  for (const m of matches) {
    if (m.result != null) {
      const p = countryPointsForResult(m.result);
      banked.a += p.a;
      banked.b += p.b;
      projected.a += p.a;
      projected.b += p.b;
    } else {
      inPlay.push({
        matchId: m.matchId,
        holesUp: m.holesUp,
        thru: m.thru,
        margin: m.margin,
      });
      if (m.holesUp > 0) projected.a += 1;
      else if (m.holesUp < 0) projected.b += 1;
      else {
        projected.a += 0.5;
        projected.b += 0.5;
      }
    }
  }

  for (const adj of adjustments) {
    if (adj.side === "a") {
      banked.a += adj.points;
      projected.a += adj.points;
    } else {
      banked.b += adj.points;
      projected.b += adj.points;
    }
  }

  return { banked, projected, inPlay };
}
