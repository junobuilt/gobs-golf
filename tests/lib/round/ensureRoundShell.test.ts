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
  const methods = ["select", "eq", "order", "limit", "maybeSingle", "insert", "single"];
  methods.forEach(m => {
    chain[m] = vi.fn(() => {
      if (m === "maybeSingle" || m === "single") return Promise.resolve(result);
      return chain;
    });
  });
  return chain;
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
    // First call: SELECT returns nothing; second call: INSERT returns new id.
    const selectChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: { id: 99 }, error: null });

    fromMock
      .mockReturnValueOnce(selectChain) // SELECT
      .mockReturnValueOnce(insertChain); // INSERT

    const id = await ensureRoundShell("2026-05-21");

    expect(id).toBe(99);
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
      .mockReturnValueOnce(insertChain);

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
      .mockReturnValueOnce(refetchChain); // re-SELECT after race

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
