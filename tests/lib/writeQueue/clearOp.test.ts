// @vitest-environment jsdom
//
// The explicit CLEAR op (admin Clear hole). op:"clear" must route to a DELETE on
// the right table with the right key filters — NEVER an upsert of 0 (a 0 is a
// real score; row-absence is what "hole not played" keys off). Destructive
// intent is explicit via `op`, never a missing/zero value.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getWriteQueue,
  getTeamWriteQueue,
  resetWriteQueueForTesting,
} from "@/lib/writeQueue";

const state = vi.hoisted(() => ({
  calls: [] as Array<{
    op: "upsert" | "delete";
    table: string;
    row?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          state.calls.push({ op: "upsert", table, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            then(res: (v: { error: null }) => unknown, rej?: (e: unknown) => unknown) {
              state.calls.push({ op: "delete", table, filters });
              return Promise.resolve({ error: null }).then(res, rej);
            },
          };
          return builder;
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

describe("writeQueue — explicit clear op", () => {
  it("individual clear → DELETE scores by (round_player_id, hole_number), no upsert", async () => {
    getWriteQueue().enqueue(
      { round_id: 1, round_player_id: 101, hole_number: 5, strokes: 0, op: "clear" },
      display,
    );
    await flush();
    const del = state.calls.find((c) => c.op === "delete");
    expect(del).toBeTruthy();
    expect(del?.table).toBe("scores");
    expect(del?.filters).toEqual({ round_player_id: 101, hole_number: 5 });
    expect(state.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("greensomes clear → DELETE team_scores by the 4-col key, no upsert", async () => {
    getTeamWriteQueue().enqueue(
      { round_id: 1, team_number: 3, hole_number: 5, ball_index: 1, strokes: 0, op: "clear" },
      display,
    );
    await flush();
    const del = state.calls.find((c) => c.op === "delete");
    expect(del).toBeTruthy();
    expect(del?.table).toBe("team_scores");
    expect(del?.filters).toEqual({ round_id: 1, team_number: 3, hole_number: 5, ball_index: 1 });
    expect(state.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("a normal enqueue (no op) still UPSERTS — clear is opt-in only", async () => {
    getWriteQueue().enqueue(
      { round_id: 1, round_player_id: 101, hole_number: 5, strokes: 4 },
      display,
    );
    await flush();
    expect(state.calls.some((c) => c.op === "upsert" && c.table === "scores")).toBe(true);
    expect(state.calls.some((c) => c.op === "delete")).toBe(false);
  });
});
