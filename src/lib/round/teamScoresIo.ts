import { supabase } from "@/lib/supabase";
import type { TeamScoreRow } from "./teamScores";

// Wave 1B — Supabase IO for the team-card `team_scores` table. Kept separate
// from the pure aggregation in `teamScores.ts` so that module stays free of the
// supabase client (unit-testable without a mock, per CLAUDE.md principle #3).
//
// Writes are direct per-box upserts (last-write-wins on the table's 4-column
// UNIQUE key) — the durable WriteQueue is hardcoded to the individual `scores`
// table and is deliberately NOT reused here. Two team members editing the same
// card is acceptable by spec (no conflict UI in v1); the last upsert per box
// wins.

// All team-card scores for a round. Consumed by the team-card entry surface
// (hydration on mount) and, in Commit 3, by the results layer.
export async function loadTeamScores(roundId: number): Promise<TeamScoreRow[]> {
  const { data, error } = await supabase
    .from("team_scores")
    .select("team_number, hole_number, ball_index, strokes")
    .eq("round_id", roundId);
  if (error) throw new Error("loadTeamScores: " + error.message);
  return (data ?? []) as TeamScoreRow[];
}

export type TeamScoreUpsert = {
  round_id: number;
  team_number: number;
  hole_number: number;
  ball_index: number;
  strokes: number;
};

// Upsert one counting ball for one hole. onConflict matches the table's UNIQUE
// (round_id, team_number, hole_number, ball_index) so re-entering a box
// overwrites in place (last-write-wins).
export async function upsertTeamScore(row: TeamScoreUpsert): Promise<void> {
  const { error } = await supabase
    .from("team_scores")
    .upsert(row, { onConflict: "round_id,team_number,hole_number,ball_index" });
  if (error) throw new Error("upsertTeamScore: " + error.message);
}
