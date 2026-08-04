// Pure tests for the match-play scorecard SEAM (src/lib/tournament/matchScorecard).
// The surface performs no score arithmetic: it re-runs the same pure engine the
// loader calls over an optimistic score map. These tests anchor that contract —
// recompute over the loader's own grosses reproduces loaded.state exactly — and
// exercise the label derivations (counting marks, missing-hole, finish banner)
// against the engine's own values, per the cross-surface agreement rule.

import { describe, it, expect } from "vitest";
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
import {
  initOptimisticScores,
  overlayPending,
  buildMatchInput,
  recomputeState,
  countingMarks,
  missingHoleGap,
  finishBanner,
  marginWithSide,
  thruDisplay,
  unitNet,
  deriveGroupLabel,
  groupLabelFor,
} from "@/lib/tournament/matchScorecard";

function holes(): HoleMeta[] {
  return Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));
}
function grossArr(scored: Record<number, number>): (number | null)[] {
  return Array.from({ length: 18 }, (_, i) => scored[i + 1] ?? null);
}

interface UnitSpec {
  playerId: number;
  ch: number | null;
  scored: Record<number, number>;
}

// Build a LoadedMatch whose `state` is a genuine computeMatchState over the same
// inputs — mirroring what the loader assembles — so parity tests are meaningful.
function makeLoaded(opts: {
  id?: number;
  format: SessionFormat;
  a: UnitSpec[];
  b: UnitSpec[];
  teamA?: Record<number, number>;
  teamB?: Record<number, number>;
  groupNumber?: number | null;
}): LoadedMatch {
  const H = holes();
  const { format } = opts;

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
    teamNumber: 1,
    players: opts.a.map((u, i) => mkPlayer(u, aStrokes[i] ?? 0)),
    collapsedHandicap: aCollapsed,
    sideMatchStrokes: aSide,
    teamGross: format === "greensomes" ? grossArr(opts.teamA ?? {}) : null,
  };
  const sideB: LoadedMatchSide = {
    side: "b",
    displayName: "CANADA",
    teamNumber: 2,
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
  };
  const state = computeMatchState(input);

  return {
    match: {
      id: opts.id ?? 500,
      tournament_id: 1,
      session_id: 9,
      match_number: 1,
      group_number: opts.groupNumber ?? null,
      side_a_team_number: 1,
      side_b_team_number: 2,
      status: "pending",
      result: null,
      result_source: "engine",
      closed_out_hole: null,
      scorer_label: null,
      flagged_holes: [],
      admin_note: null,
      is_voided: false,
    },
    session: { id: 9, format, name: "Day 1", dayNumber: 1, playedOn: "2026-08-01", roundId: 50 },
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

// ── Cross-surface parity: recompute over the loader's own grosses == loaded.state
describe("matchScorecard — recompute reproduces the loader's state (single source)", () => {
  const cases: { name: string; loaded: LoadedMatch }[] = [
    {
      name: "singles",
      loaded: makeLoaded({
        format: "singles_match",
        a: [{ playerId: 1, ch: 4, scored: { 1: 4, 2: 5, 3: 4 } }],
        b: [{ playerId: 2, ch: 0, scored: { 1: 5, 2: 4, 3: 5 } }],
      }),
    },
    {
      name: "four-ball",
      loaded: makeLoaded({
        format: "four_ball_match",
        a: [
          { playerId: 1, ch: 10, scored: { 1: 4, 2: 5 } },
          { playerId: 2, ch: 0, scored: { 1: 6, 2: 4 } },
        ],
        b: [
          { playerId: 3, ch: 0, scored: { 1: 4, 2: 5 } },
          { playerId: 4, ch: 0, scored: { 1: 5, 2: 5 } },
        ],
      }),
    },
    {
      name: "greensomes",
      loaded: makeLoaded({
        format: "greensomes",
        a: [{ playerId: 1, ch: 5, scored: {} }, { playerId: 2, ch: 15, scored: {} }],
        b: [{ playerId: 3, ch: 10, scored: {} }, { playerId: 4, ch: 20, scored: {} }],
        teamA: { 1: 4, 2: 5 },
        teamB: { 1: 5, 2: 4 },
      }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: seed recompute deep-equals loaded.state`, () => {
      const seed = initOptimisticScores(c.loaded);
      expect(recomputeState(c.loaded, seed)).toEqual(c.loaded.state);
    });

    it(`${c.name}: buildMatchInput round-trips to an independent engine call`, () => {
      const seed = initOptimisticScores(c.loaded);
      const viaSurface = recomputeState(c.loaded, seed);
      const viaEngine = computeMatchState(buildMatchInput(c.loaded, seed));
      expect(viaSurface).toEqual(viaEngine);
    });
  }
});

// ── Offline recompute: entering a score updates status locally, no reload ─────
describe("matchScorecard — optimistic edit updates status locally", () => {
  it("adding a winning hole moves the margin without any network", () => {
    const loaded = makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: {} }],
      b: [{ playerId: 2, ch: 0, scored: {} }],
    });
    const s0 = initOptimisticScores(loaded);
    expect(recomputeState(loaded, s0).thru).toBe(0);

    // Enter hole 1: A 4, B 5 → A wins, 1 UP thru 1 — computed locally.
    const s1: typeof s0 = {
      byPlayer: { 1: { 1: 4 }, 2: { 1: 5 } },
      teamGross: { a: {}, b: {} },
    };
    const st = recomputeState(loaded, s1);
    expect(st.thru).toBe(1);
    expect(st.holeOutcomes[0]).toBe("side_a");
    expect(marginWithSide(st, loaded)).toBe("USA 1 UP");
    expect(thruDisplay(st)).toBe(1);
  });

  // A4 — the engine still produces the canonical "AS" margin, but the display
  // helper renders the plainer "Tied" for the 60–80 audience.
  it("renders an all-square margin as 'Tied' (display), engine still 'AS'", () => {
    const loaded = makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: {} }],
      b: [{ playerId: 2, ch: 0, scored: {} }],
    });
    // Hole 1 halved → all square thru 1.
    const s1 = {
      byPlayer: { 1: { 1: 4 }, 2: { 1: 4 } },
      teamGross: { a: {}, b: {} },
    };
    const st = recomputeState(loaded, s1);
    expect(st.margin).toBe("AS"); // engine output unchanged (goldens hold)
    expect(marginWithSide(st, loaded)).toBe("Tied"); // display
  });
});

// ── Counting-ball marks (Decision C) against engine values ────────────────────
describe("matchScorecard — counting marks", () => {
  it("marks the winning ball; a tie marks both present; a lone ball marks itself", () => {
    // Stroke-flip: A1 (index 1) wins via its stroke.
    const flip = makeLoaded({
      format: "four_ball_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }, { playerId: 2, ch: 20, scored: { 1: 5 } }],
      b: [{ playerId: 3, ch: 0, scored: { 1: 6 } }, { playerId: 4, ch: 0, scored: { 1: 7 } }],
    });
    const st = flip.state;
    expect(countingMarks(st.countingUnitA, 1, [true, true])).toEqual([false, true]);

    // Tie: both A net equal → both present marked.
    const tie = makeLoaded({
      format: "four_ball_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }, { playerId: 2, ch: 0, scored: { 1: 4 } }],
      b: [{ playerId: 3, ch: 0, scored: { 1: 5 } }, { playerId: 4, ch: 0, scored: { 1: 6 } }],
    });
    expect(countingMarks(tie.state.countingUnitA, 1, [true, true])).toEqual([true, true]);

    // Lone ball (pickup): only P1 present → its ball marked, and A still wins.
    const lone = makeLoaded({
      format: "four_ball_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }, { playerId: 2, ch: 0, scored: {} }],
      b: [{ playerId: 3, ch: 0, scored: { 1: 5 } }, { playerId: 4, ch: 0, scored: { 1: 5 } }],
    });
    expect(countingMarks(lone.state.countingUnitA, 1, [true, false])).toEqual([true, false]);
    expect(lone.state.holeOutcomes[0]).toBe("side_a"); // one-ball side wins the hole
  });

  it("non-four-ball marks nothing (undefined counting unit)", () => {
    const singles = makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }],
      b: [{ playerId: 2, ch: 0, scored: { 1: 5 } }],
    });
    expect(countingMarks(singles.state.countingUnitA, 1, [true])).toEqual([false]);
  });
});

// ── Missing-hole gap RETIRED (migration 039) ──────────────────────────────────
// Order-agnostic completion means a hole entered out of 1→18 order is normal,
// not a "skipped hole" to nag about — so missingHoleGap() is now a no-op that
// always returns null (the amber prompt it drove was removed from the card).
// firstUnresolvedHole / thru remain as nav hints; the resolved holes still count.
describe("matchScorecard — missing-hole gap retired (039)", () => {
  const base = makeLoaded({
    format: "singles_match",
    a: [{ playerId: 1, ch: 0, scored: {} }],
    b: [{ playerId: 2, ch: 0, scored: {} }],
  });

  it("missingHoleGap is always null now, even with a genuine out-of-order gap", () => {
    // Holes 1,2 scored; 3 blank; 4 scored → a gap at 3, but NO nag anymore.
    const withGap = {
      byPlayer: { 1: { 1: 4, 2: 4, 4: 4 }, 2: { 1: 5, 2: 5, 4: 5 } },
      teamGross: { a: {}, b: {} },
    };
    const stGap = recomputeState(base, withGap);
    expect(missingHoleGap(stGap)).toBeNull();
    // Nav hints still populated: firstUnresolvedHole = the gap, thru = consecutive.
    expect(stGap.firstUnresolvedHole).toBe(3);
    expect(stGap.thru).toBe(2);
    // Order-agnostic: hole 4 STILL counts (it's a halve → holesUp unchanged here),
    // resolved wherever it sits. The match is not decided (plenty remaining).
    expect(stGap.status).toBe("in_progress");
  });

  it("scoring in order also yields no gap nag", () => {
    const s = { byPlayer: { 1: { 1: 4, 2: 4 }, 2: { 1: 5, 2: 5 } }, teamGross: { a: {}, b: {} } };
    expect(missingHoleGap(recomputeState(base, s))).toBeNull();
  });
});

// ── Finish banner (Decision F): three shapes off MatchState ────────────────────
describe("matchScorecard — finish banner", () => {
  function singlesFrom(aWins: number[], bWins: number[], halves: number[]): LoadedMatch {
    const aScored: Record<number, number> = {};
    const bScored: Record<number, number> = {};
    for (const h of aWins) { aScored[h] = 4; bScored[h] = 5; }
    for (const h of bWins) { aScored[h] = 5; bScored[h] = 4; }
    for (const h of halves) { aScored[h] = 4; bScored[h] = 4; }
    return makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: aScored }],
      b: [{ playerId: 2, ch: 0, scored: bScored }],
    });
  }
  const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  it("early closeout → won with N&M", () => {
    const m = singlesFrom([1, 2, 3, 4, 5], [], range(6, 14)); // 5 up with 4 to play → 5&4 at 14
    const b = finishBanner(m.state, m);
    expect(m.state.status).toBe("complete");
    expect(b).toEqual({ kind: "won", sideName: "USA", marginText: "5&4" });
  });

  it("decided on 18 → won with 'n up', closedOutHole null (thru falls back to 18)", () => {
    // A wins hole 1, holes 2..18 halved → 1 up, decided on the last hole.
    const m = singlesFrom([1], [], range(2, 18));
    expect(m.state.status).toBe("complete");
    expect(m.state.closedOutHole).toBeNull(); // 18th-hole finish → null, NOT 18
    expect(thruDisplay(m.state)).toBe(18); // closedOutHole ?? thru
    expect(finishBanner(m.state, m)).toEqual({ kind: "won", sideName: "USA", marginText: "1 up" });
  });

  it("all square after 18 → halved", () => {
    const m = singlesFrom([], [], range(1, 18));
    const b = finishBanner(m.state, m);
    expect(m.state.status).toBe("complete");
    expect(b).toEqual({ kind: "halved" });
  });
});

// ── overlayPending reconcile (server truth base + pending queue items) ────────
describe("matchScorecard — overlayPending", () => {
  it("overlays a pending score onto server truth, keyed round_player_id → playerId", () => {
    const loaded = makeLoaded({
      format: "four_ball_match",
      a: [{ playerId: 1, ch: 0, scored: { 1: 4 } }, { playerId: 2, ch: 0, scored: {} }],
      b: [{ playerId: 3, ch: 0, scored: { 1: 5 } }, { playerId: 4, ch: 0, scored: {} }],
    });
    const base = initOptimisticScores(loaded); // server: P1 hole1 = 4
    // roundId 50 (fixture), roundPlayerId = 1000 + playerId. Pending = P2 hole1 = 6.
    const out = overlayPending(loaded, base, [{ round_id: 50, round_player_id: 1002, hole_number: 1, strokes: 6 }], []);
    expect(out.byPlayer[1][1]).toBe(4); // server truth kept
    expect(out.byPlayer[2][1]).toBe(6); // pending applied (un-synced local edit survives)
  });

  it("ignores pending items for another round or an unknown player", () => {
    const loaded = makeLoaded({
      format: "singles_match",
      a: [{ playerId: 1, ch: 0, scored: {} }],
      b: [{ playerId: 2, ch: 0, scored: {} }],
    });
    const base = initOptimisticScores(loaded);
    const out = overlayPending(
      loaded,
      base,
      [
        { round_id: 999, round_player_id: 1001, hole_number: 1, strokes: 3 }, // wrong round
        { round_id: 50, round_player_id: 8888, hole_number: 1, strokes: 3 }, // unknown player
      ],
      [],
    );
    expect(out.byPlayer[1][1]).toBeUndefined();
  });

  it("greensomes: overlays team gross by team_number → side", () => {
    const loaded = makeLoaded({
      format: "greensomes",
      a: [{ playerId: 1, ch: 5, scored: {} }, { playerId: 2, ch: 15, scored: {} }],
      b: [{ playerId: 3, ch: 10, scored: {} }, { playerId: 4, ch: 20, scored: {} }],
      teamA: { 1: 4 },
      teamB: {},
    });
    const base = initOptimisticScores(loaded); // server: side a hole1 = 4
    const out = overlayPending(loaded, base, [], [{ round_id: 50, team_number: 2, hole_number: 1, strokes: 5 }]);
    expect(out.teamGross.a[1]).toBe(4); // server kept
    expect(out.teamGross.b[1]).toBe(5); // pending team applied (team 2 → side b)
  });
});

// ── net label uses the engine's allocator ─────────────────────────────────────
describe("matchScorecard — unitNet display", () => {
  it("net = gross − strokes-on-hole via getHandicapStrokes; null when no gross", () => {
    expect(unitNet(20, 1, 5)).toBe(3); // 20 strokes → 2 on SI 1 → 5−2
    expect(unitNet(0, 1, 4)).toBe(4);
    expect(unitNet(18, 1, null)).toBeNull();
  });
});

describe("matchScorecard — group label capped at A/B (S3 Change 4)", () => {
  it("deriveGroupLabel is odd→A / even→B and NEVER yields C or beyond", () => {
    expect(deriveGroupLabel(1)).toBe("A");
    expect(deriveGroupLabel(2)).toBe("B");
    // The 3rd+ foursome reuses A/B (tee-off order at its start hole), never "C".
    expect(deriveGroupLabel(3)).toBe("A");
    expect(deriveGroupLabel(4)).toBe("B");
    expect(deriveGroupLabel(8)).toBe("B");
    for (let n = 1; n <= 30; n++) {
      expect(["A", "B"]).toContain(deriveGroupLabel(n));
    }
  });

  it("deriveGroupLabel is empty for null / non-positive group numbers", () => {
    expect(deriveGroupLabel(null)).toBe("");
    expect(deriveGroupLabel(undefined)).toBe("");
    expect(deriveGroupLabel(0)).toBe("");
  });

  it("groupLabelFor honors an explicit A/B override, else falls back to the capped derived letter", () => {
    expect(groupLabelFor(3, "B")).toBe("B"); // override wins over derived "A"
    expect(groupLabelFor(4, "A")).toBe("A"); // override wins over derived "B"
    expect(groupLabelFor(3, null)).toBe("A"); // fallback = capped derive
    expect(groupLabelFor(4, "")).toBe("B"); // blank override → derive
    expect(groupLabelFor(4, "  ")).toBe("B"); // whitespace-only → derive
  });
});
