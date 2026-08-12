// Shared LoadedMatch fixture builder for match-play scorecard tests. Builds a
// LoadedMatch whose `state` is a genuine computeMatchState over the same inputs
// (mirroring loadMatch's assembly), so tests exercise real engine behaviour.
// Not a test file (won't match the *.test.* glob).

import {
  computeMatchState,
  computeMatchStrokes,
  greensomesTeamHandicap,
} from "@/lib/tournament/matchplay";
import type {
  HoleMeta,
  LoadedMatch,
  LoadedMatchPlayer,
  LoadedMatchSide,
  MatchInput,
  SessionFormat,
} from "@/lib/tournament/types";

export function holes(): HoleMeta[] {
  return Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
    yardage: 300 + i * 10,
  }));
}
export function grossArr(scored: Record<number, number>): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => scored[i + 1] ?? null);
}

export interface UnitSpec {
  playerId: number;
  ch: number | null;
  scored: Record<number, number>;
}

export function makeLoaded(opts: {
  id?: number;
  matchNumber?: number;
  format: SessionFormat;
  a: UnitSpec[];
  b: UnitSpec[];
  teamA?: Record<number, number>;
  teamB?: Record<number, number>;
  groupNumber?: number | null;
  teamA_number?: number;
  teamB_number?: number;
  scorerLabel?: string | null;
  flaggedHoles?: number[];
  startHole?: number; // shotgun (039): the play order rotates from here
  groupLabel?: string | null;
  isVoided?: boolean; // migration 040 — drops out of the decidable pool
  isVoidedSession?: boolean; // migration 041 — the day is voided (all its matches drop out)
  isLockedSession?: boolean; // the day/round is locked (finalised) — disables admin Clear
}): LoadedMatch {
  const H = holes();
  const { format } = opts;
  const teamANo = opts.teamA_number ?? 1;
  const teamBNo = opts.teamB_number ?? 2;

  let aStrokes: number[] = [];
  let bStrokes: number[] = [];
  let aCollapsed: number | null = null;
  let bCollapsed: number | null = null;
  let aSide: number | null = null;
  let bSide: number | null = null;

  if (format === "greensomes") {
    aCollapsed = greensomesTeamHandicap(opts.a[0]?.ch ?? null, opts.a[1]?.ch ?? null);
    bCollapsed = greensomesTeamHandicap(opts.b[0]?.ch ?? null, opts.b[1]?.ch ?? null);
    const [msA, msB] = computeMatchStrokes([aCollapsed, bCollapsed]);
    aSide = msA;
    bSide = msB;
  } else {
    const ms = computeMatchStrokes([...opts.a, ...opts.b].map((u) => u.ch ?? 0));
    aStrokes = ms.slice(0, opts.a.length);
    bStrokes = ms.slice(opts.a.length);
  }

  const mkPlayer = (u: UnitSpec, strokes: number): LoadedMatchPlayer => ({
    playerId: u.playerId,
    roundPlayerId: 1000 + u.playerId,
    displayName: `P${u.playerId}`,
    handicapIndexSnapshot: u.ch,
    courseHandicap: u.ch,
    matchStrokes: strokes,
    gross: grossArr(u.scored),
  });

  const sideA: LoadedMatchSide = {
    side: "a",
    displayName: "USA",
    teamNumber: teamANo,
    players: opts.a.map((u, i) => mkPlayer(u, aStrokes[i] ?? 0)),
    collapsedHandicap: aCollapsed,
    sideMatchStrokes: aSide,
    teamGross: format === "greensomes" ? grossArr(opts.teamA ?? {}) : null,
  };
  const sideB: LoadedMatchSide = {
    side: "b",
    displayName: "CANADA",
    teamNumber: teamBNo,
    players: opts.b.map((u, i) => mkPlayer(u, bStrokes[i] ?? 0)),
    collapsedHandicap: bCollapsed,
    sideMatchStrokes: bSide,
    teamGross: format === "greensomes" ? grossArr(opts.teamB ?? {}) : null,
  };

  const input: MatchInput = {
    format,
    holes: H,
    sideA: {
      side: "a",
      players: sideA.players.map((p) => ({ playerId: p.playerId, courseHandicap: p.courseHandicap, gross: p.gross })),
      teamGross: sideA.teamGross ?? undefined,
    },
    sideB: {
      side: "b",
      players: sideB.players.map((p) => ({ playerId: p.playerId, courseHandicap: p.courseHandicap, gross: p.gross })),
      teamGross: sideB.teamGross ?? undefined,
    },
    startHole: opts.startHole ?? 1,
  };
  const state = computeMatchState(input);

  return {
    match: {
      id: opts.id ?? 500,
      tournament_id: 1,
      session_id: 9,
      match_number: opts.matchNumber ?? 1,
      group_number: opts.groupNumber ?? null,
      side_a_team_number: teamANo,
      side_b_team_number: teamBNo,
      status: "pending",
      result: null,
      result_source: "engine",
      closed_out_hole: null,
      scorer_label: opts.scorerLabel ?? null,
      flagged_holes: opts.flaggedHoles ?? [],
      admin_note: null,
      start_hole: opts.startHole ?? null,
      group_label: opts.groupLabel ?? null,
      is_voided: opts.isVoided ?? false,
    },
    session: { id: 9, format, name: "Day 1", dayNumber: 1, playedOn: "2026-08-01", roundId: 50, isVoided: opts.isVoidedSession ?? false, isLocked: opts.isLockedSession ?? false },
    tournament: { id: 1, sideAName: "USA", sideBName: "CANADA" },
    sideA,
    sideB,
    teeId: 1,
    holes: H,
    state,
    resolved: { source: "engine", result: state.result, engineResult: state.result, pointsA: 0, pointsB: 0 },
    isIncomplete: false,
  };
}
