// Phase G2 S4b — payout override/revert orchestration unit tests. Verifies the
// RPC call shape (name + args, reason trimmed), client-side guards that fire
// BEFORE any RPC (empty reason; negative / non-integer amount), and error
// propagation. Mirrors resetFund.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  overrideRoundPayout,
  revertRoundPayout,
} from "@/lib/payouts/overrideRoundPayout";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("overrideRoundPayout", () => {
  it("calls override_round_payout with round/team/amount and trimmed reason", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await overrideRoundPayout(501, 3, 25, "  side-pot correction  ");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("override_round_payout", {
      p_round_id: 501,
      p_team_number: 3,
      p_new_per_player: 25,
      p_reason: "side-pot correction",
    });
  });

  it("rejects a blank reason WITHOUT calling the RPC (client-side guard)", async () => {
    await expect(overrideRoundPayout(501, 3, 25, "   ")).rejects.toThrow(
      /reason is required/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a negative amount WITHOUT calling the RPC", async () => {
    await expect(overrideRoundPayout(501, 3, -5, "valid")).rejects.toThrow(
      /whole dollar amount/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer amount WITHOUT calling the RPC", async () => {
    await expect(overrideRoundPayout(501, 3, 25.5, "valid")).rejects.toThrow(
      /whole dollar amount/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("propagates the RPC error", async () => {
    rpcMock.mockResolvedValue({ error: { message: "no row for round 501 team 3" } });
    await expect(overrideRoundPayout(501, 3, 25, "valid")).rejects.toThrow(
      /override_round_payout: no row for round 501 team 3/,
    );
  });
});

describe("revertRoundPayout", () => {
  it("calls revert_round_payout with round/team and trimmed reason", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await revertRoundPayout(501, 3, "  entered in error  ");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("revert_round_payout", {
      p_round_id: 501,
      p_team_number: 3,
      p_reason: "entered in error",
    });
  });

  it("rejects a blank reason WITHOUT calling the RPC", async () => {
    await expect(revertRoundPayout(501, 3, "")).rejects.toThrow(
      /reason is required/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("propagates the RPC error", async () => {
    rpcMock.mockResolvedValue({ error: { message: "row is not overridden" } });
    await expect(revertRoundPayout(501, 3, "valid")).rejects.toThrow(
      /revert_round_payout: row is not overridden/,
    );
  });
});
