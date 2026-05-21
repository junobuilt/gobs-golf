import { describe, it, expect } from "vitest";
import { resolveSmartJoin } from "@/lib/teamFormation/smartJoin";
import type { RoundPlayer } from "@/lib/teamFormation/smartJoin";

function rp(id: number, player_id: number, team_number: number): RoundPlayer {
  return { id, player_id, team_number, players: { full_name: `Player ${player_id}`, display_name: `P${player_id}` } };
}

describe("resolveSmartJoin", () => {
  it("empty roundPlayers, 1 selected → create_new with nextTeamNumber: 1", () => {
    const result = resolveSmartJoin([1], []);
    expect(result).toEqual({ kind: "create_new", playerIds: [1], nextTeamNumber: 1 });
  });

  it("empty roundPlayers, 4 selected → create_new with nextTeamNumber: 1", () => {
    const result = resolveSmartJoin([1, 2, 3, 4], []);
    expect(result).toEqual({ kind: "create_new", playerIds: [1, 2, 3, 4], nextTeamNumber: 1 });
  });

  it("existing team 1, 4 selected unassigned → create_new with nextTeamNumber: 2", () => {
    const existing = [rp(10, 10, 1), rp(11, 11, 1), rp(12, 12, 1), rp(13, 13, 1)];
    const result = resolveSmartJoin([1, 2, 3, 4], existing);
    expect(result).toEqual({ kind: "create_new", playerIds: [1, 2, 3, 4], nextTeamNumber: 2 });
  });

  it("1 selected, already on team 1 → silent_join", () => {
    const existing = [rp(1, 1, 1)];
    const result = resolveSmartJoin([1], existing);
    expect(result).toEqual({ kind: "silent_join", teamNumber: 1 });
  });

  it("all 4 selected already on team 1 → silent_join", () => {
    const existing = [rp(1, 1, 1), rp(2, 2, 1), rp(3, 3, 1), rp(4, 4, 1)];
    const result = resolveSmartJoin([1, 2, 3, 4], existing);
    expect(result).toEqual({ kind: "silent_join", teamNumber: 1 });
  });

  it("2 selected: one on team 1, one unassigned → confirm_join", () => {
    const teammate = rp(1, 1, 1);
    const unassigned = rp(2, 2, 0);
    const existing = [teammate, unassigned, rp(3, 3, 1)];
    const result = resolveSmartJoin([1, 2], existing);
    expect(result.kind).toBe("confirm_join");
    if (result.kind !== "confirm_join") return;
    expect(result.teamNumber).toBe(1);
    expect(result.existingRoster).toEqual([teammate, rp(3, 3, 1)]);
    expect(result.playerIdsToAdd).toEqual([2]);
  });

  it("2 selected: one on team 1, one on team 2 → mixed_teams_error", () => {
    const p1 = rp(1, 1, 1);
    const p2 = rp(2, 2, 2);
    const result = resolveSmartJoin([1, 2], [p1, p2]);
    expect(result.kind).toBe("mixed_teams_error");
    if (result.kind !== "mixed_teams_error") return;
    expect(result.teamA).toBe(1);
    expect(result.teamB).toBe(2);
    expect(result.playersA).toEqual([p1]);
    expect(result.playersB).toEqual([p2]);
  });

  it("3 selected spanning team 1, team 2, unassigned → mixed_teams_error (teams 1 and 2 surfaced)", () => {
    const p1 = rp(1, 1, 1);
    const p2 = rp(2, 2, 2);
    const p3 = rp(3, 3, 0);
    const result = resolveSmartJoin([1, 2, 3], [p1, p2, p3]);
    expect(result.kind).toBe("mixed_teams_error");
    if (result.kind !== "mixed_teams_error") return;
    expect(result.teamA).toBe(1);
    expect(result.teamB).toBe(2);
    expect(result.playersA).toEqual([p1]);
    expect(result.playersB).toEqual([p2]);
  });

  it("selection with duplicate ids → dedupe, treat as one", () => {
    const result = resolveSmartJoin([5, 5, 5], []);
    expect(result).toEqual({ kind: "create_new", playerIds: [5], nextTeamNumber: 1 });
  });
});
