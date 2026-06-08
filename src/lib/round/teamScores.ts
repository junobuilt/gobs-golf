// Wave 1B — read layer for the team-card scoring spine.
//
// Team-card formats (Shambles, and the future Texas Scramble / 1 Score Only /
// Alternate Shot) store ONE team-level score per counting ball per hole in the
// `team_scores` table — keyed by (round_id, team_number, hole_number,
// ball_index) — and have NO per-player `scores` rows. Count-1 formats write one
// ball per hole (ball_index 1); count-2 (Shambles best-2) write two balls whose
// SUM is the hole's team score.
//
// This module keeps pure aggregation (testable without a Supabase mock — see
// CLAUDE.md engineering principle #3) separate from the single IO read.

export type TeamScoreRow = {
  team_number: number;
  hole_number: number;
  ball_index: number;
  strokes: number;
};

// One hole's worth of a team's score: the raw balls entered (1 or 2 of them)
// and their derived total (the hole's team score = sum of the balls present).
export type TeamHoleScore = {
  balls: number[]; // ordered by ball_index
  total: number; // sum of `balls`
};

// team_number → hole_number → TeamHoleScore
export type TeamScoreMap = Map<number, Map<number, TeamHoleScore>>;

// Build the nested team→hole aggregation from raw rows. Sums the per-ball
// strokes into each hole's team total (count-2 → ball1 + ball2). Rows are
// already unique per (team, hole, ball_index) at the DB layer (the table's
// UNIQUE constraint enforces last-write-wins per box), but this is defensive
// against duplicates: a later row for the same ball_index overwrites an earlier.
export function buildTeamScoreMap(rows: TeamScoreRow[]): TeamScoreMap {
  // Intermediate: team → hole → (ball_index → strokes), so re-aggregation is
  // order-independent and a repeated ball_index is overwritten, not double-counted.
  const byBall = new Map<number, Map<number, Map<number, number>>>();
  for (const r of rows) {
    let holes = byBall.get(r.team_number);
    if (!holes) {
      holes = new Map();
      byBall.set(r.team_number, holes);
    }
    let balls = holes.get(r.hole_number);
    if (!balls) {
      balls = new Map();
      holes.set(r.hole_number, balls);
    }
    balls.set(r.ball_index, r.strokes);
  }

  const out: TeamScoreMap = new Map();
  for (const [team, holes] of byBall) {
    const holeMap = new Map<number, TeamHoleScore>();
    for (const [hole, balls] of holes) {
      const ordered = [...balls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, strokes]) => strokes);
      const total = ordered.reduce((sum, s) => sum + s, 0);
      holeMap.set(hole, { balls: ordered, total });
    }
    out.set(team, holeMap);
  }
  return out;
}

// The team's score for one hole = sum of the balls present, or null if the team
// has entered nothing on that hole yet.
export function getTeamHoleTotal(
  map: TeamScoreMap,
  teamNumber: number,
  holeNumber: number,
): number | null {
  const hole = map.get(teamNumber)?.get(holeNumber);
  return hole ? hole.total : null;
}

// The raw balls a team entered on a hole (length 0, 1, or 2), ordered by ball_index.
export function getTeamHoleBalls(
  map: TeamScoreMap,
  teamNumber: number,
  holeNumber: number,
): number[] {
  return map.get(teamNumber)?.get(holeNumber)?.balls ?? [];
}

// "thru N" — the number of holes on which the team has entered any score.
// Uses ≥1 ball so a partially-entered count-2 hole still counts as started;
// finalize completeness (every required ball present) is a Commit 4 concern.
export function holesScoredForTeam(map: TeamScoreMap, teamNumber: number): number {
  return map.get(teamNumber)?.size ?? 0;
}

// The team's gross total across every hole it has scored (sum of hole totals).
export function getTeamTotal(map: TeamScoreMap, teamNumber: number): number {
  const holes = map.get(teamNumber);
  if (!holes) return 0;
  let total = 0;
  for (const { total: holeTotal } of holes.values()) total += holeTotal;
  return total;
}

// NOTE: the Supabase read of `team_scores` (loadTeamScores) lands in Commit 3,
// inside the results-layer branch that consumes it — keeping this module pure
// (no client import) so the aggregation above is unit-tested without a mock.
