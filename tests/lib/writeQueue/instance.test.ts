// @vitest-environment jsdom
/**
 * Table-routing tests for the two queue singletons. The individual score queue
 * writes `scores`; the greensomes team queue writes `team_scores` with the
 * team UNIQUE onConflict. Proves getTeamWriteQueue() is wired to the right
 * table (the §1.5 offline-durability extension), not just that a queue drains.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getWriteQueue,
  getTeamWriteQueue,
  resetWriteQueueForTesting,
} from "@/lib/writeQueue";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; row: Record<string, unknown>; onConflict?: string }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, opts?: { onConflict?: string }) {
          state.calls.push({ table, row, onConflict: opts?.onConflict });
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const display = { player_name: "P", hole_label: "Hole" };

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  state.calls.length = 0;
  globalThis.localStorage.clear();
  resetWriteQueueForTesting();
});

describe("writeQueue instance — table routing", () => {
  it("individual score routes to the scores table", async () => {
    getWriteQueue().enqueue(
      { round_id: 1, round_player_id: 101, hole_number: 5, strokes: 4 },
      display,
    );
    await flush();
    const c = state.calls.find((x) => x.table === "scores");
    expect(c).toBeTruthy();
    expect(c?.onConflict).toBe("round_player_id,hole_number");
    expect(c?.row).toEqual({ round_player_id: 101, hole_number: 5, strokes: 4 });
    // never touches team_scores
    expect(state.calls.some((x) => x.table === "team_scores")).toBe(false);
  });

  it("greensomes team score routes to team_scores with the team onConflict", async () => {
    getTeamWriteQueue().enqueue(
      { round_id: 1, team_number: 3, hole_number: 5, ball_index: 1, strokes: 4 },
      display,
    );
    await flush();
    const c = state.calls.find((x) => x.table === "team_scores");
    expect(c).toBeTruthy();
    expect(c?.onConflict).toBe("round_id,team_number,hole_number,ball_index");
    expect(c?.row).toEqual({
      round_id: 1,
      team_number: 3,
      hole_number: 5,
      ball_index: 1,
      strokes: 4,
    });
    // never touches the individual scores table
    expect(state.calls.some((x) => x.table === "scores")).toBe(false);
  });
});
