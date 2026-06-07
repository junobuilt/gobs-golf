import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/date";
import { ensureRoundShell } from "./ensureRoundShell";
import { getActiveSeason, createSeason } from "@/lib/seasons";

// H3.4 — season-aware wrapper around ensureRoundShell. Run at round-creation
// entry points (homepage "Form a Team", admin Round Setup) so every new round
// belongs to a season.
//
// Flow:
//   - If an active season exists: create/find the round shell, attach it to
//     that season, return { ok, roundId }.
//   - If NO active season exists and no seasonName was supplied: return
//     { needs_season_name } so the UI can prompt for a name (a pure lib can't
//     render a modal). The caller re-invokes with { seasonName } on confirm.
//   - If NO active season but a seasonName was supplied: start that season,
//     then proceed as above.
//
// ensureRoundShell itself is unchanged; this wrapper sets rounds.season_id via
// a follow-up UPDATE (only when it's still NULL, so an existing round keeps its
// original season).
export type EnsureSeasonResult =
  | { status: "ok"; roundId: number; seasonId: number }
  | { status: "needs_season_name" };

export async function ensureSeasonAndRoundShell(
  date: string,
  opts?: { seasonName?: string },
): Promise<EnsureSeasonResult> {
  let season = await getActiveSeason();
  if (!season) {
    if (!opts?.seasonName) return { status: "needs_season_name" };
    season = await createSeason(opts.seasonName);
  }

  const roundId = await ensureRoundShell(date);

  await supabase
    .from("rounds")
    .update({ season_id: season.id })
    .eq("id", roundId)
    .is("season_id", null);

  return { status: "ok", roundId, seasonId: season.id };
}

// Default season name for the auto-start prompt: "<current year> Season".
// Year comes from todayLocal() (local PT) to match the rest of the app's date
// handling rather than UTC.
export function defaultSeasonName(): string {
  return `${todayLocal().slice(0, 4)} Season`;
}
