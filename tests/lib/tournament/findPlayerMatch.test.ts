import { describe, it, expect } from "vitest";
import { findMatchForPlayer, tournamentPlayersFromDays } from "@/lib/tournament/findPlayerMatch";
import { makeLoaded } from "../../support/matchFixture";

describe("findMatchForPlayer", () => {
  it("resolves a player to their match on either side; undefined when absent", () => {
    const m1 = makeLoaded({ id: 500, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] });
    const m2 = makeLoaded({ id: 501, format: "singles_match", teamA_number: 3, teamB_number: 4, a: [{ playerId: 3, ch: 0, scored: {} }], b: [{ playerId: 4, ch: 0, scored: {} }] });
    expect(findMatchForPlayer([m1, m2], 1)?.match.id).toBe(500); // side A
    expect(findMatchForPlayer([m1, m2], 4)?.match.id).toBe(501); // side B
    expect(findMatchForPlayer([m1, m2], 99)).toBeUndefined();
  });

  it("stores identity, not a match id — a player on different teams across two days resolves to different matches", () => {
    // Day 1: player 1 is in match 500. Day 2: player 1 is in match 601 (repaired).
    const day1 = [makeLoaded({ id: 500, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 2, ch: 0, scored: {} }] })];
    const day2 = [
      makeLoaded({ id: 600, format: "singles_match", a: [{ playerId: 2, ch: 0, scored: {} }], b: [{ playerId: 3, ch: 0, scored: {} }] }),
      makeLoaded({ id: 601, format: "singles_match", teamA_number: 3, teamB_number: 4, a: [{ playerId: 4, ch: 0, scored: {} }], b: [{ playerId: 1, ch: 0, scored: {} }] }),
    ];
    expect(findMatchForPlayer(day1, 1)?.match.id).toBe(500);
    expect(findMatchForPlayer(day2, 1)?.match.id).toBe(601);
  });
});

describe("tournamentPlayersFromDays", () => {
  it("dedups players across days and sorts by display name", () => {
    const day1 = [makeLoaded({ id: 500, format: "singles_match", a: [{ playerId: 2, ch: 0, scored: {} }], b: [{ playerId: 1, ch: 0, scored: {} }] })];
    const day2 = [makeLoaded({ id: 600, format: "singles_match", a: [{ playerId: 1, ch: 0, scored: {} }], b: [{ playerId: 3, ch: 0, scored: {} }] })];
    const roster = tournamentPlayersFromDays([day1, day2]);
    // playerIds 1,2,3 (P1/P2/P3 display names) — unique, sorted.
    expect(roster.map((p) => p.playerId)).toEqual([1, 2, 3]);
    expect(roster.map((p) => p.displayName)).toEqual(["P1", "P2", "P3"]);
  });
});
