// Pure helpers for the Phase 3.1 match-play scorecard surface. NO score
// arithmetic lives here — only (a) shape assembly that feeds the canonical
// engine (computeMatchState) over an optimistic local score map, and (b) label
// derivations that READ MatchState fields. The surface re-runs the same pure
// engine the loader calls, over newer inputs, so status updates immediately
// offline — that is the single source of truth, not a second implementation.
//
// No next / Supabase / React — safe to unit-test directly.

import { getHandicapStrokes } from "@/lib/scoring/handicap";
import { computeMatchState } from "./matchplay";
import type {
  LoadedMatch,
  MatchInput,
  MatchSideInput,
  MatchState,
  Side,
} from "./types";

// Editable per-match score state, seeded from the loader's surfaced grosses.
export interface OptimisticScores {
  // playerId -> (hole 1..18 -> strokes). Four-ball / singles.
  byPlayer: Record<number, Record<number, number>>;
  // greensomes team gross per side. hole 1..18 -> strokes.
  teamGross: Record<Side, Record<number, number>>;
}

function seedFromArray(gross: (number | null)[] | null): Record<number, number> {
  const o: Record<number, number> = {};
  (gross ?? []).forEach((v, i) => {
    if (v != null) o[i + 1] = v;
  });
  return o;
}

// Seed the editable state from exactly what loadMatch assembled — so
// recomputeState() over this seed reproduces loaded.state byte-for-byte.
export function initOptimisticScores(loaded: LoadedMatch): OptimisticScores {
  const byPlayer: Record<number, Record<number, number>> = {};
  for (const p of [...loaded.sideA.players, ...loaded.sideB.players]) {
    byPlayer[p.playerId] = seedFromArray(p.gross);
  }
  return {
    byPlayer,
    teamGross: {
      a: seedFromArray(loaded.sideA.teamGross),
      b: seedFromArray(loaded.sideB.teamGross),
    },
  };
}

function grossArray(byHole: Record<number, number> | undefined): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => byHole?.[i + 1] ?? null);
}

// Minimal shapes of the pending write-queue payloads (kept structural so this
// pure module doesn't depend on the writeQueue types).
export interface PendingScore {
  round_id: number;
  round_player_id: number;
  hole_number: number;
  strokes: number;
}
export interface PendingTeamScore {
  round_id: number;
  team_number: number;
  hole_number: number;
  strokes: number;
}

// Reconcile = load-then-overlay (the league card's pattern): server truth as the
// base, then overlay this match's still-pending (un-synced) queue entries on top
// so a refresh picks up OTHER scorers' server writes without clobbering the local
// scorer's optimistic entries. Only items for THIS match's round + its own
// players/teams are applied. Pure; caller passes non-terminal queue items.
export function overlayPending(
  loaded: LoadedMatch,
  base: OptimisticScores,
  pendingScores: ReadonlyArray<PendingScore>,
  pendingTeam: ReadonlyArray<PendingTeamScore>,
): OptimisticScores {
  const roundId = loaded.session.roundId;
  // round_player_id -> playerId for this match's players.
  const rpToPlayer = new Map<number, number>();
  for (const p of [...loaded.sideA.players, ...loaded.sideB.players]) {
    rpToPlayer.set(p.roundPlayerId, p.playerId);
  }

  const byPlayer: Record<number, Record<number, number>> = {};
  for (const pid of Object.keys(base.byPlayer)) {
    byPlayer[Number(pid)] = { ...base.byPlayer[Number(pid)] };
  }
  const teamGross: Record<Side, Record<number, number>> = {
    a: { ...base.teamGross.a },
    b: { ...base.teamGross.b },
  };

  for (const it of pendingScores) {
    if (roundId == null || it.round_id !== roundId) continue;
    const playerId = rpToPlayer.get(it.round_player_id);
    if (playerId == null) continue;
    if (it.hole_number < 1 || it.hole_number > 18) continue;
    (byPlayer[playerId] ??= {})[it.hole_number] = it.strokes;
  }
  for (const it of pendingTeam) {
    if (roundId == null || it.round_id !== roundId) continue;
    const side: Side | null =
      it.team_number === loaded.sideA.teamNumber
        ? "a"
        : it.team_number === loaded.sideB.teamNumber
          ? "b"
          : null;
    if (side == null) continue;
    if (it.hole_number < 1 || it.hole_number > 18) continue;
    teamGross[side][it.hole_number] = it.strokes;
  }

  return { byPlayer, teamGross };
}

// Rebuild the engine input from the loader's fixed metadata (holes, handicaps,
// format) + the live optimistic scores. Player order is preserved from the
// loaded match, so the engine sees the same units in the same order.
export function buildMatchInput(loaded: LoadedMatch, s: OptimisticScores): MatchInput {
  const toSide = (side: Side): MatchSideInput => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    return {
      side,
      players: ls.players.map((p) => ({
        playerId: p.playerId,
        courseHandicap: p.courseHandicap,
        gross: grossArray(s.byPlayer[p.playerId]),
      })),
      teamGross:
        loaded.session.format === "greensomes" ? grossArray(s.teamGross[side]) : undefined,
    };
  };
  return {
    format: loaded.session.format,
    holes: loaded.holes,
    sideA: toSide("a"),
    sideB: toSide("b"),
  };
}

// The one call the surface makes on every score entry. Same engine, newer input.
export function recomputeState(loaded: LoadedMatch, s: OptimisticScores): MatchState {
  return computeMatchState(buildMatchInput(loaded, s));
}

// ── Label derivations (read MatchState; no math) ─────────────────────────────

// Points may be .5 (halves). Show integers plainly, halves to one decimal.
export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Right-side "thru": on a decided match read closedOutHole (an early closeout
// shows its hole; an on-18/halved finish has closedOutHole = null so this falls
// back to thru = 18 — never blank/"null"). In progress: thru. (F-addendum)
export function thruDisplay(state: MatchState): number {
  return state.closedOutHole ?? state.thru;
}

// Header right-side margin WITH the leading side's name ("USA 1 UP", "5&4", "AS").
// Leader read from holesUp (engine); "AS"/empty carry no side. No math.
export function marginWithSide(state: MatchState, loaded: LoadedMatch): string {
  if (!state.margin) return "";
  if (state.margin === "AS") return "AS";
  const leader = state.holesUp > 0 ? loaded.sideA.displayName : loaded.sideB.displayName;
  return `${leader} ${state.margin}`;
}

export type FinishBanner =
  | { kind: "won"; sideName: string; marginText: string }
  | { kind: "halved" };

// Three shapes, driven off result + closedOutHole + margin — no surface math.
// Early closeout & on-18 wins both read "wins {margin}" (margin is "5&4" or
// "1 UP", lower-cased for display); all-square complete → halved. (Decision F)
export function finishBanner(state: MatchState, loaded: LoadedMatch): FinishBanner | null {
  if (state.status !== "complete") return null;
  if (state.result === "halved") return { kind: "halved" };
  const sideName =
    state.result === "side_a" ? loaded.sideA.displayName : loaded.sideB.displayName;
  return { kind: "won", sideName, marginText: (state.margin ?? "").toLowerCase() };
}

// The gap hole to nag about, or null. Only a GENUINE out-of-order gap qualifies:
// firstUnresolvedHole is non-null AND some later hole is already resolved — so a
// card simply being scored in order (nothing past the current hole) never nags.
// Reads holeOutcomes only. (§6)
export function missingHoleGap(state: MatchState): number | null {
  const gap = state.firstUnresolvedHole;
  if (gap == null) return null;
  return state.holeOutcomes.slice(gap).some((o) => o != null) ? gap : null;
}

// DISPLAY labels for the per-box "net N" and stroke dots. These reuse the
// engine's OWN allocator (getHandicapStrokes, the same primitive matchplay.ts
// uses) + the loader-provided match strokes — NOT a reimplementation of net
// selection or status. The canonical outcome/status/margin/points/counting-ball
// still come only from MatchState. Match strokes: per-player for four-ball /
// singles, the side's collapsed strokes for greensomes (Decision B).
export function unitNet(
  matchStrokes: number,
  strokeIndex: number,
  gross: number | null,
): number | null {
  return gross == null ? null : gross - getHandicapStrokes(matchStrokes, strokeIndex);
}

export function strokeDots(matchStrokes: number, strokeIndex: number): number {
  return getHandicapStrokes(matchStrokes, strokeIndex);
}

// Which player indices (0/1) show the ← counting-ball mark for a four-ball side
// on a hole. presentByUnit[i] = does unit i have a score entered here (presence
// check the caller does from its own map — not math). Rules (Decision C):
//  - non-four-ball (no countingUnit array) → none.
//  - no ball present (unresolved) → none.
//  - a resolved side whose countingUnit is null → TIE → mark every present ball.
//  - otherwise → mark exactly the winning unit index.
export function countingMarks(
  countingUnit: (number | null)[] | undefined,
  hole: number,
  presentByUnit: boolean[],
): boolean[] {
  if (!countingUnit) return presentByUnit.map(() => false);
  const anyPresent = presentByUnit.some(Boolean);
  if (!anyPresent) return presentByUnit.map(() => false);
  const idx = countingUnit[hole - 1];
  if (idx == null) return presentByUnit.map((p) => p); // tie → both present balls
  return presentByUnit.map((_, i) => i === idx);
}
