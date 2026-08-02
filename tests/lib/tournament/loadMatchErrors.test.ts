// F2 #2 — loadMatch must distinguish a transient read failure (Supabase returned
// an `error`) from a genuine empty result (query succeeded, zero rows). A dead
// network is NOT a missing match: network → MatchLoadError; null-rows →
// MatchNotFoundError. Uses a direct supabase mock so we can inject an `error`.

import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "in", "gt", "is"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve(state.result);
    c.then = (onF: (v: unknown) => unknown) => Promise.resolve(state.result).then(onF);
    return c;
  };
  return { supabase: { from: () => chain() } };
});

import { loadMatch, MatchLoadError, MatchNotFoundError } from "@/lib/tournament/loadMatch";

beforeEach(() => {
  state.result = { data: null, error: null };
});

describe("loadMatch — network vs missing classification", () => {
  it("a Supabase error on the primary read → MatchLoadError (transient), NOT MatchNotFoundError", async () => {
    state.result = { data: null, error: { message: "TypeError: Failed to fetch" } };
    await expect(loadMatch(1)).rejects.toBeInstanceOf(MatchLoadError);
    await expect(loadMatch(1)).rejects.not.toBeInstanceOf(MatchNotFoundError);
  });

  it("a successful query that returns no rows → MatchNotFoundError", async () => {
    state.result = { data: null, error: null };
    await expect(loadMatch(999)).rejects.toBeInstanceOf(MatchNotFoundError);
  });
});
