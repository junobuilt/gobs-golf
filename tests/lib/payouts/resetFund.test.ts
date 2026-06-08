// Phase G2 S4b — resetFund orchestration unit tests. Verifies the RPC call
// shape (name + args, reason trimmed, created_by='admin'), client-side empty-
// reason rejection (no RPC fired), and error propagation.

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

import { resetFund } from "@/lib/payouts/resetFund";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("resetFund", () => {
  it("calls reset_fund with fund, trimmed reason, and created_by='admin'", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await resetFund("bfb", "  Donated to food bank  ");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("reset_fund", {
      p_fund: "bfb",
      p_reason: "Donated to food bank",
      p_created_by: "admin",
    });
  });

  it("passes the hio fund through", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await resetFund("hio", "Ace on 12");
    expect(rpcMock).toHaveBeenCalledWith(
      "reset_fund",
      expect.objectContaining({ p_fund: "hio", p_reason: "Ace on 12" }),
    );
  });

  it("rejects a blank reason WITHOUT calling the RPC (client-side guard)", async () => {
    await expect(resetFund("bfb", "   ")).rejects.toThrow(/reason is required/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(resetFund("bfb", "valid reason")).rejects.toThrow(/reset_fund: boom/);
  });
});
