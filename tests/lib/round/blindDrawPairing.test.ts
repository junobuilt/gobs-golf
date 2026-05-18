// D.1 — unit tests for the pure blind-draw pairing helper. Exercises the
// branches the spec calls out: round-start fills, dropout-with-fill,
// dropout-without-fill (round not finalized), multiple dropouts on the
// same team, multiple fills, range-copy formatting.

import { describe, it, expect } from "vitest";
import {
  pairBlindDraws,
  rangeCopy,
} from "@/lib/round/blindDrawPairing";
import type {
  BlindDrawFill,
  PlayerRow,
  TeamRow,
} from "@/lib/round/results";

function player(
  rpId: number,
  displayName: string,
  droppedAfterHole: number | null = null,
): PlayerRow {
  return {
    rpId,
    displayName,
    grossTotal: 0,
    netValue: 0,
    netTotal: 0,
    holesPlayed: droppedAfterHole ?? 18,
    scores: Array.from({ length: 18 }, () => null),
    par: Array.from({ length: 18 }, () => 4),
    droppedAfterHole,
  };
}

function fill(
  drawnPlayerName: string,
  holeRangeStart: number,
  fromTeamNumber: number = 99,
): BlindDrawFill {
  return {
    drawnPlayerId: 9999,
    drawnPlayerName,
    fromTeamNumber,
    holeRangeStart,
    holeRangeEnd: 18,
    drawnPlayerScores: Array.from({ length: 18 }, () => 4),
    drawnPlayerNetValue: 0,
  };
}

function team(players: PlayerRow[], fills: BlindDrawFill[]): TeamRow {
  return {
    id: 1,
    name: "Team 1",
    rosterDisplay: players.map(p => p.displayName).join(" · "),
    total: 0,
    rawTeamScore: 0,
    teamPar: 0,
    thru: 18,
    f9Total: null,
    b9Total: null,
    players,
    blindDraws: fills,
  };
}

describe("rangeCopy", () => {
  it("formats round-start (full-18) as 'all 18 holes'", () => {
    expect(rangeCopy(fill("X", 1))).toBe("all 18 holes");
  });

  it("formats a mid-round dropout range as 'holes N–18'", () => {
    expect(rangeCopy(fill("X", 8))).toBe("holes 8–18");
    expect(rangeCopy(fill("X", 12))).toBe("holes 12–18");
  });
});

describe("pairBlindDraws", () => {
  it("returns empty buckets for a team with no fills", () => {
    const t = team([player(1, "Alice"), player(2, "Bob")], []);
    const r = pairBlindDraws(t);
    expect(r.dropoutPairings).toHaveLength(0);
    expect(r.roundStartFills).toHaveLength(0);
    expect(r.unmatchedPlayers).toHaveLength(0);
  });

  it("classifies a single round-start fill (holeRangeStart=1)", () => {
    const t = team([player(1, "Alice"), player(2, "Bob")], [fill("Carol", 1)]);
    const r = pairBlindDraws(t);
    expect(r.roundStartFills).toHaveLength(1);
    expect(r.roundStartFills[0].drawnPlayerName).toBe("Carol");
    expect(r.dropoutPairings).toHaveLength(0);
  });

  it("pairs a dropout fill with the matching player by dropped_after_hole", () => {
    const dropped = player(2, "Bob", 8);
    const t = team(
      [player(1, "Alice"), dropped, player(3, "Charlie")],
      [fill("Dave", 9)], // hole_range_start=9 ⇒ dropped_after_hole=8
    );
    const r = pairBlindDraws(t);
    expect(r.dropoutPairings).toHaveLength(1);
    expect(r.dropoutPairings[0].player.rpId).toBe(2);
    expect(r.dropoutPairings[0].fill.drawnPlayerName).toBe("Dave");
    expect(r.unmatchedPlayers).toHaveLength(0);
  });

  it("leaves a dropped player unmatched when no fill exists", () => {
    const dropped = player(2, "Bob", 8);
    const t = team([player(1, "Alice"), dropped], []);
    const r = pairBlindDraws(t);
    expect(r.dropoutPairings).toHaveLength(0);
    expect(r.unmatchedPlayers).toHaveLength(1);
    expect(r.unmatchedPlayers[0].rpId).toBe(2);
  });

  it("handles round-start + dropout fills on the same team", () => {
    const dropped = player(2, "Bob", 12);
    const t = team(
      [player(1, "Alice"), dropped],
      [fill("Carol", 1), fill("Dave", 13)],
    );
    const r = pairBlindDraws(t);
    expect(r.roundStartFills).toHaveLength(1);
    expect(r.roundStartFills[0].drawnPlayerName).toBe("Carol");
    expect(r.dropoutPairings).toHaveLength(1);
    expect(r.dropoutPairings[0].player.rpId).toBe(2);
    expect(r.dropoutPairings[0].fill.drawnPlayerName).toBe("Dave");
  });

  it("pairs multiple dropouts with same hole greedily in roster order", () => {
    const a = player(2, "Bob", 8);
    const b = player(3, "Charlie", 8);
    const t = team(
      [player(1, "Alice"), a, b],
      [fill("Dave", 9), fill("Eve", 9)],
    );
    const r = pairBlindDraws(t);
    expect(r.dropoutPairings).toHaveLength(2);
    // Greedy: first fill takes first matching dropped player.
    expect(r.dropoutPairings[0].player.rpId).toBe(2);
    expect(r.dropoutPairings[0].fill.drawnPlayerName).toBe("Dave");
    expect(r.dropoutPairings[1].player.rpId).toBe(3);
    expect(r.dropoutPairings[1].fill.drawnPlayerName).toBe("Eve");
  });

  it("does not consume a non-dropped player even if hole math aligns", () => {
    // Edge case: a player has droppedAfterHole=null. Fill with
    // holeRangeStart=9 should NOT pair to anyone if no one dropped after 8.
    const t = team(
      [player(1, "Alice"), player(2, "Bob")],
      [fill("Dave", 9)],
    );
    const r = pairBlindDraws(t);
    expect(r.dropoutPairings).toHaveLength(0);
    expect(r.unmatchedPlayers).toHaveLength(0);
  });
});
