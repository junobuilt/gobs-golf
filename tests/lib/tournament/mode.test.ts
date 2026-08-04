// The "tournament mode is publicly ON" gate: published AND not ended AND active.
// Never throws (a read failure → null, so the homepage/nav never break).
//
// NOTE on ordering: the "never throws" case runs FIRST, in its own describe with
// no beforeEach, on a pristine spy. Vitest 4 has an instrumentation artifact
// where a spy that has been given mockResolvedValue re-surfaces a later throwing
// implementation as a test error even when the code under test catches it
// (reproduced in isolation). Exercising the throw on a never-resolved spy avoids
// the artifact; the four gating cases follow with their own reset.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tournament } from "@/lib/tournament/types";

const mocks = vi.hoisted(() => ({ getActiveTournament: vi.fn() }));
vi.mock("@/lib/tournament/queries", () => ({ getActiveTournament: mocks.getActiveTournament }));

import { getTournamentMode } from "@/lib/tournament/mode";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 1, name: "Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada",
    holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, is_published: true, planned_match_total: null, notes: null,
    ...overrides,
  };
}

// FIRST — pristine spy (never given a resolved value); see the header note.
describe("getTournamentMode — resilience", () => {
  it("returns null (never throws) on a read failure", async () => {
    mocks.getActiveTournament.mockImplementation(() => { throw new Error("network"); });
    await expect(getTournamentMode()).resolves.toBeNull();
  });
});

describe("getTournamentMode — publish/ended gate", () => {
  beforeEach(() => mocks.getActiveTournament.mockReset());

  it("returns the tournament when published + un-ended", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament());
    expect(await getTournamentMode()).not.toBeNull();
  });
  it("null when Test (unpublished)", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament({ is_published: false }));
    expect(await getTournamentMode()).toBeNull();
  });
  it("null when ended", async () => {
    mocks.getActiveTournament.mockResolvedValue(tournament({ ended_on: "2026-08-05" }));
    expect(await getTournamentMode()).toBeNull();
  });
  it("null when no active tournament", async () => {
    mocks.getActiveTournament.mockResolvedValue(null);
    expect(await getTournamentMode()).toBeNull();
  });
});
