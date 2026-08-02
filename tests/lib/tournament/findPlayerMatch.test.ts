import { describe, it, expect } from "vitest";
import { findMatchForPlayer, findNearestMatchForPlayer, tournamentPlayersFromDays } from "@/lib/tournament/findPlayerMatch";
import { makeLoaded } from "../../support/matchFixture";

function day(dayNumber: number, playedOn: string | null, matches: ReturnType<typeof makeLoaded>[]) {
  return { session: { day_number: dayNumber, played_on: playedOn }, matches };
}
function singlesMatch(id: number, aId: number, bId: number) {
  return makeLoaded({ id, format: "singles_match", teamA_number: aId, teamB_number: bId, a: [{ playerId: aId, ch: 0, scored: {} }], b: [{ playerId: bId, ch: 0, scored: {} }] });
}

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

describe("findNearestMatchForPlayer", () => {
  const TODAY = "2026-07-15";

  it("picks the soonest today-or-later day the player is matched on", () => {
    const days = [
      day(1, "2026-07-10", [singlesMatch(900, 1, 2)]), // past
      day(2, "2026-07-20", [singlesMatch(1000, 1, 3)]), // soonest upcoming
      day(3, "2026-07-25", [singlesMatch(1100, 1, 4)]), // later
    ];
    const r = findNearestMatchForPlayer(days, 1, TODAY);
    expect(r?.match.match.id).toBe(1000);
    expect(r?.day.session.day_number).toBe(2);
  });

  it("counts today as upcoming", () => {
    const days = [day(1, "2026-07-15", [singlesMatch(700, 1, 2)])];
    expect(findNearestMatchForPlayer(days, 1, TODAY)?.match.match.id).toBe(700);
  });

  it("falls back to the most recent when all the player's days are past", () => {
    const days = [
      day(1, "2026-07-01", [singlesMatch(900, 1, 2)]),
      day(2, "2026-07-05", [singlesMatch(1000, 1, 3)]), // most recent
    ];
    expect(findNearestMatchForPlayer(days, 1, TODAY)?.match.match.id).toBe(1000);
  });

  it("returns null when the player has no match on any day", () => {
    const days = [day(1, "2026-07-20", [singlesMatch(900, 2, 3)])];
    expect(findNearestMatchForPlayer(days, 1, TODAY)).toBeNull();
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
