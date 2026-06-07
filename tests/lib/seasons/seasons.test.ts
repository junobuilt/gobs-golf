// Unit + integration tests for the seasons module (Phase H3): queries,
// mutations, the end-of-season gate, and the reopen toggle. Runs against the
// in-memory FakeSupabase (the `seasons` table is passed via the seed).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeSupabase } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

// Mutations stamp started_on / ended_on with todayLocal() — pin it.
vi.mock("@/lib/date", () => ({
  todayLocal: () => "2026-06-06",
  yesterdayLocal: () => "2026-06-05",
}));

import {
  getActiveSeason,
  listPastSeasons,
  getRoundCountForSeason,
  getInProgressRoundsForSeason,
  createSeason,
  endSeason,
  reopenSeason,
  SeasonHasInProgressRounds,
} from "@/lib/seasons";

function season(id: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `Season ${id}`,
    started_on: "2026-01-01",
    ended_on: null,
    is_active: false,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function makeFake(seed: { seasons?: any[]; rounds?: any[] } = {}) {
  return new FakeSupabase({
    seasons: seed.seasons ?? [],
    rounds: seed.rounds ?? [],
    tees: [],
    holes: [],
    round_players: [],
    players: [],
    scores: [],
  } as any);
}

beforeEach(() => {
  fakeRef.current = null;
});

describe("seasons — queries", () => {
  it("getActiveSeason returns the active row, or null when none", async () => {
    fakeRef.current = makeFake({ seasons: [season(1, { is_active: true }), season(2)] });
    expect((await getActiveSeason())?.id).toBe(1);

    fakeRef.current = makeFake({ seasons: [season(1), season(2)] });
    expect(await getActiveSeason()).toBeNull();
  });

  it("listPastSeasons returns only inactive seasons", async () => {
    fakeRef.current = makeFake({
      seasons: [season(1, { is_active: true }), season(2), season(3)],
    });
    const past = await listPastSeasons();
    expect(past.map((s) => s.id).sort()).toEqual([2, 3]);
    expect(past.every((s) => !s.is_active)).toBe(true);
  });

  it("getRoundCountForSeason counts only rounds in that season", async () => {
    // Negative control: a round in season 2 must NOT be counted for season 1.
    fakeRef.current = makeFake({
      seasons: [season(1, { is_active: true }), season(2)],
      rounds: [
        { id: 10, season_id: 1, is_complete: true },
        { id: 11, season_id: 1, is_complete: true },
        { id: 12, season_id: 2, is_complete: true },
      ],
    });
    expect(await getRoundCountForSeason(1)).toBe(2);
    expect(await getRoundCountForSeason(2)).toBe(1);
  });

  it("getInProgressRoundsForSeason returns only unfinalized rounds in the season", async () => {
    fakeRef.current = makeFake({
      seasons: [season(1, { is_active: true })],
      rounds: [
        { id: 10, season_id: 1, is_complete: true, played_on: "2026-05-01" },
        { id: 11, season_id: 1, is_complete: false, played_on: "2026-05-08" },
        { id: 12, season_id: 2, is_complete: false, played_on: "2026-05-08" }, // other season
      ],
    });
    const rows = await getInProgressRoundsForSeason(1);
    expect(rows.map((r) => r.id)).toEqual([11]);
  });
});

describe("seasons — mutations", () => {
  it("createSeason inserts an active season started today", async () => {
    fakeRef.current = makeFake({ seasons: [] });
    const s = await createSeason("2027 Season");
    expect(s.name).toBe("2027 Season");
    expect(s.is_active).toBe(true);
    expect(s.started_on).toBe("2026-06-06");
    expect(fakeRef.current.data.seasons).toHaveLength(1);
  });

  it("endSeason stamps ended_on + clears is_active when no rounds are in progress", async () => {
    fakeRef.current = makeFake({
      seasons: [season(1, { is_active: true })],
      rounds: [{ id: 10, season_id: 1, is_complete: true, played_on: "2026-05-01" }],
    });
    await endSeason(1);
    const row = fakeRef.current.data.seasons.find((s: any) => s.id === 1);
    expect(row.is_active).toBe(false);
    expect(row.ended_on).toBe("2026-06-06");
  });

  it("endSeason throws SeasonHasInProgressRounds and does not mutate when a round is unfinalized", async () => {
    fakeRef.current = makeFake({
      seasons: [season(1, { is_active: true })],
      rounds: [{ id: 11, season_id: 1, is_complete: false, played_on: "2026-05-08" }],
    });
    await expect(endSeason(1)).rejects.toBeInstanceOf(SeasonHasInProgressRounds);
    const row = fakeRef.current.data.seasons.find((s: any) => s.id === 1);
    // Untouched — still active, no ended_on.
    expect(row.is_active).toBe(true);
    expect(row.ended_on).toBeNull();
  });

  it("reopenSeason pauses the current active season and activates the target (clearing ended_on)", async () => {
    fakeRef.current = makeFake({
      seasons: [
        season(1, { is_active: true }),
        season(2, { is_active: false, ended_on: "2025-12-31" }),
      ],
    });
    await reopenSeason(2);
    const s1 = fakeRef.current.data.seasons.find((s: any) => s.id === 1);
    const s2 = fakeRef.current.data.seasons.find((s: any) => s.id === 2);
    expect(s1.is_active).toBe(false);
    expect(s2.is_active).toBe(true);
    expect(s2.ended_on).toBeNull();
  });
});

describe("seasons — integration flows", () => {
  it("end-of-season: create → finalize round → end succeeds; unfinalized round blocks", async () => {
    fakeRef.current = makeFake({ seasons: [] });
    const s = await createSeason("2026 Season");

    // A round is created and left in progress → end is blocked.
    fakeRef.current.data.rounds.push({
      id: 50, season_id: s.id, is_complete: false, played_on: "2026-06-01",
    });
    await expect(endSeason(s.id)).rejects.toBeInstanceOf(SeasonHasInProgressRounds);

    // Finalize it → end now succeeds.
    fakeRef.current.data.rounds[0].is_complete = true;
    await endSeason(s.id);
    const row = fakeRef.current.data.seasons.find((x: any) => x.id === s.id);
    expect(row.is_active).toBe(false);
    expect(row.ended_on).toBe("2026-06-06");
  });

  it("reopen toggle: reopening swaps which season is active (one-active invariant)", async () => {
    fakeRef.current = makeFake({
      seasons: [
        season(1, { is_active: true }),
        season(2, { is_active: false, ended_on: "2025-12-31" }),
      ],
    });

    // Reopen the past season → it becomes active, the prior pauses.
    await reopenSeason(2);
    expect((await getActiveSeason())?.id).toBe(2);

    // Reopen the first again → toggles back. Exactly one active throughout.
    await reopenSeason(1);
    expect((await getActiveSeason())?.id).toBe(1);
    const active = fakeRef.current.data.seasons.filter((s: any) => s.is_active);
    expect(active).toHaveLength(1);
  });
});
