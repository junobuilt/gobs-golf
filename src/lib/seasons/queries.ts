// Season read queries (Phase H3). Pure async over the Supabase client.

import { supabase } from "@/lib/supabase";
import type { Season, SeasonRound } from "./types";

const SEASON_COLS = "id, name, started_on, ended_on, is_active, created_at";

// The single active season, or null if none is active (the brief window after
// End Season and before the next round auto-starts a new one).
export async function getActiveSeason(): Promise<Season | null> {
  const { data } = await supabase
    .from("seasons")
    .select(SEASON_COLS)
    .eq("is_active", true)
    .maybeSingle();
  return (data as Season | null) ?? null;
}

// All seasons, newest first.
export async function listSeasons(): Promise<Season[]> {
  const { data } = await supabase
    .from("seasons")
    .select(SEASON_COLS)
    .order("started_on", { ascending: false });
  return (data as Season[] | null) ?? [];
}

// Past (non-active) seasons, newest first — drives the "Past Seasons" list.
export async function listPastSeasons(): Promise<Season[]> {
  const { data } = await supabase
    .from("seasons")
    .select(SEASON_COLS)
    .eq("is_active", false)
    .order("started_on", { ascending: false });
  return (data as Season[] | null) ?? [];
}

// Number of rounds attached to a season. Counts by fetching ids (small N;
// ~20-50 rounds) rather than a head:true count so it's straightforward to
// test against the in-memory fake Supabase used in the suite.
export async function getRoundCountForSeason(seasonId: number): Promise<number> {
  const { data } = await supabase
    .from("rounds")
    .select("id")
    .eq("season_id", seasonId);
  return data?.length ?? 0;
}

// Unfinalized rounds in a season — the End-Season gate. Empty array means the
// season is safe to end.
export async function getInProgressRoundsForSeason(seasonId: number): Promise<SeasonRound[]> {
  const { data } = await supabase
    .from("rounds")
    .select("id, played_on, is_complete")
    .eq("season_id", seasonId)
    .eq("is_complete", false)
    .order("played_on", { ascending: false });
  return (data as SeasonRound[] | null) ?? [];
}
