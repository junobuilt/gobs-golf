import { supabase } from "@/lib/supabase";

// Phase D.2: reopen a finalized round so the admin can add scorecards or
// correct scores.
//
// Effects:
//   1. is_complete → false
//   2. format_config.submitted_teams → [] (clears the D.1 hotfix gate so
//      admin re-finalize via /round/[id] flows isn't blocked)
// Explicitly preserved:
//   - was_finalized stays true (the latch from migration 012). Banner
//     uses this to know it must show "Finalize Round" instead of "Done".
//   - blind_draws rows are NOT touched. Per spec: existing draws stay
//     locked; admin is responsible for not adding players to teams that
//     already had draws applied (UI warns in DangerModal copy).
//   - scores are NOT touched.
//   - round_players rows are NOT touched.
//
// Implementation note: format_config is jsonb NOT NULL with a default
// shell. The submit_team_and_friends write path at scorecard/page.tsx
// uses a read-modify-write pattern; we match that here. Race window
// (admin reopen vs. concurrent submit) is acceptable per league usage
// (in-person, essentially serial — same rationale documented at
// scorecard/page.tsx:597). Worst case: a stale submitted_teams entry
// is lost; admin retries.
//
// G2: reopening also reverses the round's persisted payouts — deletes its
// round_payouts rows and appends balancing (negative) entries to the
// fund ledger so the round's HiO/BFB net returns to zero. Idempotent
// (reverse_round_payouts is a no-op when there's nothing to reverse, e.g.
// a round finalized before G2 shipped). Re-finalize recreates the payouts.
//
// UI concerns (modal, navigation, state refresh) belong to the caller.
export async function reopenRound(roundId: number): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from("rounds")
    .select("format_config")
    .eq("id", roundId)
    .maybeSingle();

  if (readErr) throw new Error("reopenRound (read): " + readErr.message);
  if (!row) throw new Error("reopenRound: round " + roundId + " not found");

  // Reverse payouts/funds before clearing is_complete. If this fails we abort
  // rather than leave a finalized-but-reopened round with stale payout rows.
  const { error: reverseErr } = await supabase.rpc("reverse_round_payouts", {
    p_round_id: roundId,
  });
  if (reverseErr) {
    throw new Error("reopenRound (reverse payouts): " + reverseErr.message);
  }

  const currentCfg = (row.format_config ?? {}) as Record<string, unknown>;
  const nextCfg = { ...currentCfg, submitted_teams: [] };

  const { error: writeErr } = await supabase
    .from("rounds")
    .update({
      is_complete: false,
      format_config: nextCfg,
    })
    .eq("id", roundId);

  if (writeErr) throw new Error("reopenRound (write): " + writeErr.message);
}
