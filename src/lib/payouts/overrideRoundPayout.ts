// Phase G2 (Session 4b) — payout override write surface (orchestration).
//
// Mirrors src/lib/payouts/resetFund.ts: client-side validation (belt-and-
// suspenders with the server) then a SINGLE SECURITY DEFINER RPC call. The
// migration-019 RPCs are the ONLY write path to round_payouts — RLS blocks
// direct client writes. No actor is recorded (shared PIN gate; the app has no
// per-user identity, so every override is the implicit 'admin').
//
// override_round_payout / revert_round_payout each target exactly one row via
// the round_payouts(round_id, team_number) UNIQUE index. There is NO auto-
// rebalance: changing one team's payout moves only that row.

import { supabase } from "@/lib/supabase";

/** Override one team's per-player payout on a finalized round. */
export async function overrideRoundPayout(
  roundId: number,
  teamNumber: number,
  newPerPlayer: number,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new Error("A reason is required to override a payout.");
  }
  if (!Number.isInteger(newPerPlayer) || newPerPlayer < 0) {
    throw new Error("Payout must be a whole dollar amount of $0 or more.");
  }
  const { error } = await supabase.rpc("override_round_payout", {
    p_round_id: roundId,
    p_team_number: teamNumber,
    p_new_per_player: newPerPlayer,
    p_reason: trimmed,
  });
  if (error) {
    throw new Error("override_round_payout: " + error.message);
  }
}

/** Revert one team's payout back to the engine's original value. */
export async function revertRoundPayout(
  roundId: number,
  teamNumber: number,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new Error("A reason is required to revert a payout.");
  }
  const { error } = await supabase.rpc("revert_round_payout", {
    p_round_id: roundId,
    p_team_number: teamNumber,
    p_reason: trimmed,
  });
  if (error) {
    throw new Error("revert_round_payout: " + error.message);
  }
}
