import { supabase } from "@/lib/supabase";

// Phase D.2: admin-initiated finalize for a previously-reopened round.
//
// This is the EditModeBanner's "Finalize Round" handler. It does NOT
// re-run the blind-draw RPC (finalize_round_with_blind_draws) because:
//   - Reopen explicitly preserves the existing blind_draws rows.
//   - Re-running the RPC would attempt to insert duplicate draws and
//     fail on the table's uniqueness constraint, or worse, produce a
//     different draw sequence under the new pool composition.
// If admin needs to recompute draws after a roster change, that is a
// separate, out-of-scope flow (see ROADMAP D.2 "Out of scope").
//
// Effects:
//   1. is_complete → true
//   2. was_finalized → true (automatic via the trigger from migration
//      012; this helper does not need to set it). Already-true on a
//      reopened round, but the trigger is idempotent.
//
// UI concerns belong to the caller.
export async function finalizeRoundAdmin(roundId: number): Promise<void> {
  const { error } = await supabase
    .from("rounds")
    .update({ is_complete: true })
    .eq("id", roundId);

  if (error) throw new Error("finalizeRoundAdmin: " + error.message);
}
