import { supabase } from "@/lib/supabase";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";
import { ensurePrimaryFlight } from "@/lib/flights/resolve";

// Find-or-create a round shell for the given date. Returns the round id.
//
// Flow:
//   1. SELECT for an existing round on `date`. Return its id if found.
//   2. INSERT a new shell with format: null and the shared format_config
//      placeholder (rounds.format_config is NOT NULL in the DB).
//   3. If INSERT fails with 23505 (unique violation — a concurrent caller
//      inserted between our SELECT and INSERT), re-fetch and return that id.
//   4. Any other error throws.
//
// Flights (Session 1): every round must have exactly one flight (NO format
// qualifier), so each return path ensures the round's primary "Flight A" shell
// exists (idempotent). Format ownership lives on the flight; this keeps the
// invariant total for rounds created after migration 022.
//
// UI concerns (setSaving, loadRoundForDate, alert) belong to callers.
export async function ensureRoundShell(date: string): Promise<number> {
  const { data: existing } = await supabase
    .from("rounds")
    .select("id")
    .eq("played_on", date)
    .order("played_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await ensurePrimaryFlight(existing.id);
    return existing.id;
  }

  const { data: round, error } = await supabase
    .from("rounds")
    .insert({
      played_on: date,
      course_id: 1,
      format: null,
      format_config: DEFAULT_FORMAT_CONFIG_SHELL,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: refetched } = await supabase
        .from("rounds")
        .select("id")
        .eq("played_on", date)
        .order("played_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (refetched) {
        await ensurePrimaryFlight(refetched.id);
        return refetched.id;
      }
      throw new Error("ensureRoundShell: concurrent insert race could not be resolved");
    }
    throw new Error("ensureRoundShell: " + error.message);
  }

  if (!round) throw new Error("ensureRoundShell: no row returned");
  await ensurePrimaryFlight(round.id);
  return round.id;
}
