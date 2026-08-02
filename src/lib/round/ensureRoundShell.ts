import { supabase } from "@/lib/supabase";
import { DEFAULT_FORMAT_CONFIG_SHELL } from "@/lib/format/copy";
import { ensurePrimaryFlight } from "@/lib/flights/resolve";
import { resolveBuyIn } from "@/lib/payouts/winningsMoney";

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
//
// Tournament interaction (031): `rounds_played_on_unique` is deliberately left
// intact — a tournament day is ONE round per date (each group a team inside
// it), and no league rounds are played during tournament week. So a
// tournament round can legitimately own a date. The find-or-create flow is
// league-scoped: every lookup filters `tournament_id IS NULL`, so it never
// binds to a tournament round. When the INSERT then hard-fails 23505 because a
// tournament round already owns the date, the league-scoped re-fetch comes
// back empty and we throw the typed `TournamentOwnsDateError` (a distinct,
// named sentinel) instead of the raw "concurrent insert race" string, so a
// caller can special-case it later. No UI for it this session.
export class TournamentOwnsDateError extends Error {
  readonly code = "tournament_owns_date";
  constructor(public readonly date: string) {
    super(`ensureRoundShell: a tournament round owns ${date}; no league round can be created`);
    this.name = "TournamentOwnsDateError";
  }
}

export async function ensureRoundShell(date: string): Promise<number> {
  const { data: existing } = await supabase
    .from("rounds")
    .select("id")
    .eq("played_on", date)
    .is("tournament_id", null)
    .order("played_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await ensurePrimaryFlight(existing.id);
    return existing.id;
  }

  // F2.5: snapshot the buy-in that is in effect right now onto the round so
  // money for this round is derived from its own amount, not the live global
  // (rounds.buy_in defaults to 10 in the DB; this captures a changed global at
  // creation time). Read the setting on the insert branch only.
  const { data: buyInSetting } = await supabase
    .from("league_settings")
    .select("value")
    .eq("key", "buy_in_amount")
    .maybeSingle();
  const buyIn = resolveBuyIn(buyInSetting?.value);

  const { data: round, error } = await supabase
    .from("rounds")
    .insert({
      played_on: date,
      course_id: 1,
      format: null,
      format_config: DEFAULT_FORMAT_CONFIG_SHELL,
      buy_in: buyIn,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: refetched } = await supabase
        .from("rounds")
        .select("id")
        .eq("played_on", date)
        .is("tournament_id", null)
        .order("played_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (refetched) {
        await ensurePrimaryFlight(refetched.id);
        return refetched.id;
      }
      // League-scoped re-fetch is empty even though the date is taken → the
      // owner is a tournament round (filtered out above), not a racing league
      // insert. Surface a typed sentinel rather than the raw race string.
      throw new TournamentOwnsDateError(date);
    }
    throw new Error("ensureRoundShell: " + error.message);
  }

  if (!round) throw new Error("ensureRoundShell: no row returned");
  await ensurePrimaryFlight(round.id);
  return round.id;
}
