import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

import { reopenRound } from "@/lib/round/reopenRound";

// Fluent chain helper. Each method returns the chain unless it's a
// terminal one (.maybeSingle / .single), which resolves to a fixed
// result. For .update().eq() we want to capture the payload on .update
// and resolve the chain when awaited.
function makeReadChain(result: { data: any; error: any }) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "maybeSingle"];
  methods.forEach(m => {
    chain[m] = vi.fn(() => {
      if (m === "maybeSingle") return Promise.resolve(result);
      return chain;
    });
  });
  return chain;
}

interface CapturedWrite {
  payload: any;
  filterCol: string | null;
  filterVal: any;
}

function makeWriteChain(captured: CapturedWrite, result: { error: any }) {
  // Postgres update().eq() is thenable; resolve on the final eq.
  const chain: any = {
    update: vi.fn((p: any) => {
      captured.payload = p;
      return chain;
    }),
    eq: vi.fn((col: string, val: any) => {
      captured.filterCol = col;
      captured.filterVal = val;
      return Promise.resolve(result);
    }),
  };
  return chain;
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("reopenRound", () => {
  it("clears format_config.submitted_teams (negative control: prefilled array)", async () => {
    // Negative control: the fixture seeds submitted_teams = [1, 2, 3].
    // If reopenRound were a no-op on this field, the captured payload
    // would still show those values — assertion would fail.
    const readChain = makeReadChain({
      data: {
        format_config: {
          basis: "net",
          best_n: 2,
          override_holes: [4, 13],
          submitted_teams: [1, 2, 3],
        },
      },
      error: null,
    });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await reopenRound(42);

    expect(captured.payload.format_config.submitted_teams).toEqual([]);
    // Preserves other fields in the existing format_config.
    expect(captured.payload.format_config.basis).toBe("net");
    expect(captured.payload.format_config.best_n).toBe(2);
    expect(captured.payload.format_config.override_holes).toEqual([4, 13]);
    expect(captured.filterCol).toBe("id");
    expect(captured.filterVal).toBe(42);
  });

  it("flips is_complete to false", async () => {
    const readChain = makeReadChain({
      data: { format_config: { submitted_teams: [1] } },
      error: null,
    });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await reopenRound(7);

    expect(captured.payload.is_complete).toBe(false);
  });

  it("does NOT touch was_finalized (latch is preserved by trigger)", async () => {
    const readChain = makeReadChain({
      data: { format_config: { submitted_teams: [1] } },
      error: null,
    });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await reopenRound(7);

    expect("was_finalized" in captured.payload).toBe(false);
  });

  it("does NOT touch blind_draws or scores or round_players (no calls to those tables)", async () => {
    const readChain = makeReadChain({
      data: { format_config: {} },
      error: null,
    });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await reopenRound(7);

    const calledTables = fromMock.mock.calls.map(c => c[0]);
    expect(calledTables).toEqual(["rounds", "rounds"]);
  });

  it("handles missing format_config gracefully (treats as empty object)", async () => {
    const readChain = makeReadChain({ data: { format_config: null }, error: null });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await reopenRound(8);

    expect(captured.payload.format_config).toEqual({ submitted_teams: [] });
  });

  it("throws when the round does not exist", async () => {
    const readChain = makeReadChain({ data: null, error: null });
    fromMock.mockReturnValueOnce(readChain);

    await expect(reopenRound(999)).rejects.toThrow(/not found/);
  });

  it("throws on read error", async () => {
    const readChain = makeReadChain({ data: null, error: { message: "rls denied" } });
    fromMock.mockReturnValueOnce(readChain);

    await expect(reopenRound(1)).rejects.toThrow(/rls denied/);
  });

  it("throws on write error", async () => {
    const readChain = makeReadChain({ data: { format_config: {} }, error: null });
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: { message: "conflict" } });

    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(writeChain);

    await expect(reopenRound(1)).rejects.toThrow(/conflict/);
  });
});
