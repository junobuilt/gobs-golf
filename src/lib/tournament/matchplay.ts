// Tournament match-play engine — PURE. No next / Supabase / React.
//
// Single source of truth: this module does NOT reimplement stroke-index
// allocation or net math. It reuses `getHandicapStrokes` (the scorecard "dots"
// allocator, src/lib/scoring/handicap.ts). The greensomes team handicap is the
// GOBS 60/40 rule (see `greensomesTeamHandicap`). The one genuinely new rule is
// MATCH strokes (§2.1): everybody plays off the lowest handicap in the match.
// The derived per-hole quantity is always called `matchNet` (never `net`) — it
// uses MATCH strokes, so it legitimately differs from league net (which uses a
// player's own allowance-adjusted CH).

import { getHandicapStrokes, getPlayingStrokes } from "@/lib/scoring/handicap";
import type {
  HoleOutcome,
  MatchInput,
  MatchResult,
  MatchResultRow,
  MatchState,
  MatchStatus,
  PointAdjustment,
  ResolvedResult,
  SessionFormat,
  SidePoints,
  Standings,
  StandingsInPlayEntry,
  StandingsMatchInput,
} from "./types";

// ── Greensomes team handicap (GOBS 60/40) ───────────────────────────────────
// Q4 (Dad confirmed 2026-07-27): the greensomes team handicap is 60% of the
// LOWER course handicap + 40% of the higher, added, rounded to a whole number
// (Math.round; the CHs we store are non-negative). Order-independent. Note the
// weighted sum (3·low + 2·high)/5 can never land exactly on .5, so the rounding
// direction is unambiguous. This is THE formula — the old "half of combined"
// convention it replaced has been removed. Tournament-only: the LEAGUE
// alternate_shot format uses computeTeamHandicap directly and is unaffected.
export function greensomesTeamHandicap(
  chA: number | null,
  chB: number | null,
): number {
  const a = chA ?? 0;
  const b = chB ?? 0;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return Math.round(0.6 * low + 0.4 * high);
}

// ── Handicap allowance (migration 042, 2026-08-10) ──────────────────────────
// THE two-part single source of truth for scaling a course handicap by an
// allowance percent before §2.1. Extracted so the engine (sideHoleNets) and the
// loader/preview (computeSideStrokes) apply the SAME math from ONE place — doing
// the multiply in both was the exact drift this had to avoid.
//
// `resolveTournamentAllowance` = the per-format POLICY. Reversal recorded
// 2026-08-10 (see the sideHoleNets note): four-ball is now allowance-aware;
// singles and greensomes are not.
//   • singles_match  → always 100 (USGA-correct full course handicap; UNCHANGED).
//   • four_ball_match → the session's `handicap_allowance`, or 100 when unset.
//       Migration 042 is nullable and did NOT backfill, so every pre-042 row —
//       including tournament 5's already-scored session 26 — reads NULL ⇒ 100,
//       leaving scored history byte-identical (Decision A, 2026-08-10). 90% is
//       the value the forthcoming admin control must WRITE at four-ball session
//       creation; it is NOT a reader default, so a newly-created NULL session
//       still reads 100 until that UI ships (carry-forward item in STATUS.md).
//   • greensomes     → this path is never taken: greensomes collapses to the
//       60/40 `greensomesTeamHandicap` on raw CH and ignores the allowance
//       entirely. Returns 100 (the identity) purely so the function is total.
export function resolveTournamentAllowance(
  format: SessionFormat,
  sessionAllowance: number | null | undefined,
): number {
  if (format === "four_ball_match") return sessionAllowance ?? 100;
  return 100; // singles_match (USGA full CH) and greensomes (60/40, allowance-free)
}

// `tournamentPlayingHandicap` = the MATH. Delegates to the league allocator's
// getPlayingStrokes so tournament rounding is identical to league net
// (Math.round(CH × allowance / 100)); null CH stays null. The 100% case is the
// identity on the stored (already-rounded) course handicap.
export function tournamentPlayingHandicap(
  courseHandicap: number | null,
  allowance: number,
): number | null {
  return getPlayingStrokes(courseHandicap, allowance);
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

// ── Shotgun play order (migration 039) ──────────────────────────────────────
// The order holes are PLAYED for a match teeing off on `startHole`, wrapping
// 18→1 (e.g. start 7 → 7,8,…,18,1,…,6). Returns 1-indexed hole numbers.
// startHole=1 → the identity [1..total], so every ordinary round is unchanged.
// SINGLE SOURCE OF TRUTH for the rotation — the engine walks it for thru /
// walk-off / margin, the scorecard nav rail renders it, and the scorecard's
// initial hole reads it. An out-of-range startHole is normalised into 1..total.
export function holePlayOrder(startHole: number, total = 18): number[] {
  const s = (((Math.trunc(startHole) - 1) % total) + total) % total;
  return Array.from({ length: total }, (_, k) => ((s + k) % total) + 1);
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

  // singles_match + four_ball_match: the UNITS are the individual players. PH =
  // course handicap × the format's allowance (resolveTournamentAllowance), then
  // §2.1 strokes off the low unit.
  //   • singles_match  → 100% (USGA-correct full course handicap; UNCHANGED).
  //   • four_ball_match → the session allowance, defaulting to 100% when unset.
  // REVERSAL (2026-08-10): four-ball was previously pinned to 100% as a
  // deliberate league departure from USGA's 90%. The league admin reversed that:
  // four-ball is now a configurable allowance (target 90%, written per session),
  // so this branch scales CH by it. Singles stays 100% — do NOT "fix" it to 90%.
  // Greensomes is handled above (60/40 team handicap) and ignores the allowance.
  const aPlayers = sideA.players;
  const bPlayers = sideB.players;
  const allowance = resolveTournamentAllowance(format, input.handicapAllowance);
  const phs = [...aPlayers, ...bPlayers].map(
    (p) => tournamentPlayingHandicap(p.courseHandicap, allowance) ?? 0,
  );
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

  // ── Play order (shotgun) + order-agnostic completion (migration 039) ──────
  // seq0 = 0-BASED indices into holeOutcomes/a/b, in the order the group PLAYS
  // them (rotated from startHole, wrapping 18→1). startHole=1 → [0..total-1], so
  // everything below is byte-identical to the old consecutive-from-1 engine when
  // there are no gaps.
  const startHole = input.startHole ?? 1;
  const seq0 = holePlayOrder(startHole, total).map((h) => h - 1);

  // resolvedCount is order-INDEPENDENT — a hole counts wherever it sits.
  const resolvedCount = holeOutcomes.reduce((n, o) => (o != null ? n + 1 : n), 0);

  // thru (DISPLAY) = holes resolved CONSECUTIVELY along the play order from the
  // start hole (a gap stops the count). firstUnresolvedHole = the first gap's
  // hole number in play order (a nav hint; NO LONGER an amber "skipped" nag —
  // completion is order-agnostic), null when there is no gap.
  let thru = 0;
  for (const idx of seq0) {
    if (holeOutcomes[idx] == null) break;
    thru++;
  }
  const firstGapPos = seq0.findIndex((idx) => holeOutcomes[idx] == null);
  const firstUnresolvedHole = firstGapPos === -1 ? null : seq0[firstGapPos] + 1;

  // Walk the play order, SKIPPING unresolved holes (a data-entry gap no longer
  // blocks the count — completion is ORDER-AGNOSTIC). Tally resolved holes; the
  // EARLIEST play-order hole whose running lead strictly EXCEEDS the holes still
  // unplayed closes the match (a lead == remaining is dormie, NOT closed), then
  // FREEZE state there. Because an unplayed hole counts toward "remaining", a
  // walk-off can only fire when the result is genuinely locked — a forgotten
  // hole that could still swing it keeps the match open. Strictly safer than —
  // and, for startHole=1 with no gaps, byte-identical to — the old rule.
  let cumA = 0;
  let cumB = 0;
  let cumHalved = 0;
  let played = 0; // resolved holes processed along seq0 so far
  let closeoutHole: number | null = null; // 1-indexed HOLE NUMBER
  let closeoutPlayed = 0; // `played` at the closeout (for `remaining`)
  let closeoutPos = -1; // seq0 position of the closeout (for scoredBeyondCloseout)
  for (let p = 0; p < seq0.length; p++) {
    const idx = seq0[p];
    const o = holeOutcomes[idx];
    if (o == null) continue; // gap — skip, do not block
    played++;
    if (o === "side_a") cumA++;
    else if (o === "side_b") cumB++;
    else cumHalved++;
    if (Math.abs(cumA - cumB) > total - played) {
      closeoutHole = idx + 1;
      closeoutPlayed = played;
      closeoutPos = p;
      break; // freeze — cum*/played are as of the closeout hole
    }
  }
  // No closeout → cum*/played already reflect ALL resolved holes (gaps skipped).
  const effectivePlayed = closeoutHole != null ? closeoutPlayed : played;

  const pointsA = cumA + cumHalved * 0.5;
  const pointsB = cumB + cumHalved * 0.5;
  const holesUp = cumA - cumB;
  const lead = Math.abs(holesUp);
  const remaining = total - effectivePlayed;

  // "Extra scores" = any score present on a hole played AFTER an early closeout.
  let scoredBeyondCloseout = false;
  if (closeoutHole != null && closeoutPos >= 0 && remaining > 0) {
    for (let p = closeoutPos + 1; p < seq0.length; p++) {
      const idx = seq0[p];
      if (a[idx] != null || b[idx] != null) {
        scoredBeyondCloseout = true;
        break;
      }
    }
  }

  const closedEarly = closeoutHole != null && remaining > 0;
  const complete = closeoutHole != null || resolvedCount === total;

  let status: MatchStatus;
  let result: MatchResult;
  let closedOutHole: number | null;
  let margin: string | null;

  if (!complete) {
    status = resolvedCount === 0 ? "pending" : "in_progress";
    result = null;
    closedOutHole = null;
    margin = resolvedCount === 0 ? null : holesUp === 0 ? "AS" : `${lead} UP`;
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
