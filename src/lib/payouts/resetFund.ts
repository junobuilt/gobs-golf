// Phase G2 (Session 4b) — fund reset orchestration.
//
// Calls the reset_fund SECURITY DEFINER RPC (migration 017), which appends a
// balancing ledger entry bringing the fund's running total to $0. The client
// NEVER writes fund_transactions directly — the S2 RLS posture (public SELECT,
// no write policies) makes the RPC the only write path.
//
// created_by is the constant 'admin': the app has no per-user identity (a single
// shared PIN gate), so this is the only honest attribution available.

import { supabase } from "@/lib/supabase";

export type FundKind = "bfb" | "hio";

const ADMIN_IDENTITY = "admin";

/**
 * Reset a fund to $0 with a required audit reason. Throws on a blank reason
 * (defensive — the modal also gates this) or an RPC error. The server
 * re-validates the reason and fund, so this is belt-and-suspenders.
 */
export async function resetFund(fund: FundKind, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new Error("A reason is required to reset a fund.");
  }
  const { error } = await supabase.rpc("reset_fund", {
    p_fund: fund,
    p_reason: trimmed,
    p_created_by: ADMIN_IDENTITY,
  });
  if (error) {
    throw new Error("reset_fund: " + error.message);
  }
}
