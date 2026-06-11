import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";

// Must be hoisted so the vi.mock factory can reference it.
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

import { ensureRoundShell } from "@/lib/round/ensureRoundShell";

// Builds a chainable Supabase query builder that resolves to `result` at
// the end of any method chain. Every fluent method returns `this`.
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "limit", "maybeSingle", "insert", "single", "upsert"];
  methods.forEach(m => {
    chain[m] = vi.fn(() => {
      if (m === "maybeSingle" || m === "single") return Promise.resolve(result);
      // ensurePrimaryFlight awaits the upsert directly and reads { error }.
      if (m === "upsert") return Promise.resolve({ error: null });
      return chain;
    });
  });
  return chain;
}

// Flights (Session 1): each success path ends with a from("flights").upsert to
// ensure the round's primary Flight A exists. Tests that reach a return append
// this chain to their from() sequence.
function makeFlightChain() {
  return makeChain({ data: null, error: null });
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("ensureRoundShell", () => {
  it("returns existing round id without inserting when a round already exists", async () => {
    const selectChain = makeChain({ data: { id: 42 }, error: null });
    fromMock.mockReturnValue(selectChain);

    const id = await ensureRoundShell("2026-05-20");

    expect(id).toBe(42);
    // insert should never have been called
    expect(selectChain.insert).not.toHaveBeenCalled();
  });

  it("inserts and returns new id when no round exists", async () => {
    // First call: SELECT returns nothing; second: INSERT returns new id; third:
    // flights upsert (ensurePrimaryFlight).
    const selectChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: { id: 99 }, error: null });

    fromMock
      .mockReturnValueOnce(selectChain) // SELECT
      .mockReturnValueOnce(insertChain) // INSERT
      .mockReturnValueOnce(makeFlightChain()); // flights upsert

    const id = await ensureRoundShell("2026-05-21");

    expect(id).toBe(99);
  });

  it("ensures a primary Flight A for the round (idempotent upsert on round_id,sort_order)", async () => {
    // Existing round → returns its id, then upserts Flight A. Capture the
    // flights upsert payload + onConflict to assert the invariant write.
    const selectChain = makeChain({ data: { id: 42 }, error: null });

    let upsertPayload: any = null;
    let upsertOpts: any = null;
    const flightChain: Record<string, unknown> = {
      upsert: vi.fn((row: unknown, opts: unknown) => {
        upsertPayload = row;
        upsertOpts = opts;
        return Promise.resolve({ error: null });
      }),
    };

    fromMock
      .mockReturnValueOnce(selectChain) // SELECT rounds
      .mockReturnValueOnce(flightChain); // flights upsert

    const id = await ensureRoundShell("2026-05-25");

    expect(id).toBe(42);
    expect(upsertPayload).toMatchObject({
      round_id: 42,
      name: "Flight A",
      sort_order: 1,
      format: null,
    });
    expect(upsertOpts).toMatchObject({ onConflict: "round_id,sort_order", ignoreDuplicates: true });
  });

  it("insert payload includes format: null and DEFAULT_FORMAT_CONFIG_SHELL", async () => {
    const selectChain = makeChain({ data: null, error: null });

    let capturedPayload: unknown = null;
    const insertChain: Record<string, unknown> = {};
    const insertMethods = ["insert", "select", "single"];
    insertMethods.forEach(m => {
      insertChain[m] = vi.fn((arg?: unknown) => {
        if (m === "insert") capturedPayload = arg;
        if (m === "single") return Promise.resolve({ data: { id: 7 }, error: null });
        return insertChain;
      });
    });

    fromMock
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(makeFlightChain()); // flights upsert

    await ensureRoundShell("2026-05-22");

    expect(capturedPayload).toMatchObject({
      course_id: 1,
      format: null,
      format_config: DEFAULT_FORMAT_CONFIG_SHELL,
    });
  });

  it("handles 23505 unique-violation by re-fetching and returning that id", async () => {
    const selectChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: null, error: { code: "23505", message: "unique violation" } });
    const refetchChain = makeChain({ data: { id: 55 }, error: null });

    fromMock
      .mockReturnValueOnce(selectChain)  // initial SELECT
      .mockReturnValueOnce(insertChain)  // INSERT → 23505
      .mockReturnValueOnce(refetchChain) // re-SELECT after race
      .mockReturnValueOnce(makeFlightChain()); // flights upsert

    const id = await ensureRoundShell("2026-05-23");

    expect(id).toBe(55);
  });

  it("throws on non-23505 insert errors", async () => {
    const selectChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: null, error: { code: "42P01", message: "table missing" } });

    fromMock
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(insertChain);

    await expect(ensureRoundShell("2026-05-24")).rejects.toThrow("table missing");
  });
});
