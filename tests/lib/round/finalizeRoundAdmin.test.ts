import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

import { finalizeRoundAdmin } from "@/lib/round/finalizeRoundAdmin";

interface CapturedWrite {
  payload: any;
  filterCol: string | null;
  filterVal: any;
}

function makeWriteChain(captured: CapturedWrite, result: { error: any }) {
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

describe("finalizeRoundAdmin", () => {
  it("flips is_complete to true on the named round", async () => {
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });
    fromMock.mockReturnValueOnce(writeChain);

    await finalizeRoundAdmin(42);

    expect(captured.payload).toEqual({ is_complete: true });
    expect(captured.filterCol).toBe("id");
    expect(captured.filterVal).toBe(42);
  });

  it("does NOT touch was_finalized in the payload (trigger handles it)", async () => {
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: null });
    fromMock.mockReturnValueOnce(writeChain);

    await finalizeRoundAdmin(7);

    expect("was_finalized" in captured.payload).toBe(false);
  });

  it("only writes to the rounds table", async () => {
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    fromMock.mockReturnValueOnce(makeWriteChain(captured, { error: null }));

    await finalizeRoundAdmin(1);

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("rounds");
  });

  it("throws on Supabase error", async () => {
    const captured: CapturedWrite = { payload: null, filterCol: null, filterVal: null };
    const writeChain = makeWriteChain(captured, { error: { message: "rls denied" } });
    fromMock.mockReturnValueOnce(writeChain);

    await expect(finalizeRoundAdmin(1)).rejects.toThrow(/rls denied/);
  });
});
