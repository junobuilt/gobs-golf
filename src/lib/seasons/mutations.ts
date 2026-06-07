// Season write operations (Phase H3). Pure async over the Supabase client.
//
// Dates of record (started_on / ended_on) use todayLocal() — the league's
// local PT date — to stay consistent with rounds.played_on and the locked
// May-10 UTC-bug fix (Supabase NOW() is UTC and rolls over after ~5pm PT).

import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/date";
import type { Season } from "./types";
import { SeasonHasInProgressRounds } from "./types";
import { getActiveSeason, getInProgressRoundsForSeason } from "./queries";

const SEASON_COLS = "id, name, started_on, ended_on, is_active, created_at";

// Start a new active season (started today). The DB partial unique index
// (seasons_only_one_active) rejects this if another season is already active,
// so callers must ensure none is active first (the auto-start wrapper checks).
export async function createSeason(name: string): Promise<Season> {
  const { data, error } = await supabase
    .from("seasons")
    .insert({ name, started_on: todayLocal(), is_active: true })
    .select(SEASON_COLS)
    .single();
  if (error) throw new Error("createSeason: " + error.message);
  if (!data) throw new Error("createSeason: no row returned");
  return data as Season;
}

// End a season: stamp ended_on = today and clear is_active. Throws
// SeasonHasInProgressRounds (with the offending rounds) if any round in the
// season is still unfinalized — the caller surfaces the block modal.
export async function endSeason(seasonId: number): Promise<void> {
  const inProgress = await getInProgressRoundsForSeason(seasonId);
  if (inProgress.length > 0) throw new SeasonHasInProgressRounds(inProgress);

  const { error } = await supabase
    .from("seasons")
    .update({ ended_on: todayLocal(), is_active: false })
    .eq("id", seasonId);
  if (error) throw new Error("endSeason: " + error.message);
}

// Reopen a past season, making it active again (and clearing its ended_on).
// Any currently-active season is paused first. Done as two sequential UPDATEs
// rather than an RPC: league play is in-person and essentially serial, and the
// partial unique index is the safety net — if two admins reopen at once, the
// second activation hits the index and throws, and the UI shows a retry.
export async function reopenSeason(targetId: number): Promise<void> {
  const active = await getActiveSeason();
  if (active && active.id !== targetId) {
    const { error: pauseErr } = await supabase
      .from("seasons")
      .update({ is_active: false })
      .eq("id", active.id);
    if (pauseErr) throw new Error("reopenSeason: " + pauseErr.message);
  }

  const { error } = await supabase
    .from("seasons")
    .update({ is_active: true, ended_on: null })
    .eq("id", targetId);
  if (error) throw new Error("reopenSeason: " + error.message);
}
