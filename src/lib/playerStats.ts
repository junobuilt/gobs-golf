import { supabase } from "@/lib/supabase";

export type PlayerStatsFilter = {
  startDate?: string;
  endDate?: string;
};

export type PlayerStats = {
  roundsPlayed: number;
  avgScore: number | null;
  bestScore: number | null;
  lastRound: { playedOn: string; totalStrokes: number } | null;
};

const EMPTY_STATS: PlayerStats = {
  roundsPlayed: 0,
  avgScore: null,
  bestScore: null,
  lastRound: null,
};

export async function fetchPlayerStats(
  playerId: number,
  filter: PlayerStatsFilter = {},
): Promise<PlayerStats> {
  let query = supabase
    .from("round_players")
    .select(
      `
        round_id,
        rounds!inner ( played_on, is_complete ),
        scores ( strokes )
      `,
    )
    .eq("player_id", playerId)
    .eq("rounds.is_complete", true);

  if (filter.startDate) {
    query = query.gte("rounds.played_on", filter.startDate);
  }
  if (filter.endDate) {
    query = query.lte("rounds.played_on", filter.endDate);
  }

  const { data, error } = await query;
  if (error || !data) return EMPTY_STATS;

  type ScoreRow = { strokes: number | null };
  type RoundRow = { played_on: string | null; is_complete: boolean | null };
  type Row = {
    round_id: number;
    rounds: RoundRow | RoundRow[] | null;
    scores: ScoreRow[] | null;
  };

  const rounds = (data as unknown as Row[])
    .map((rp) => {
      const roundsRel = Array.isArray(rp.rounds) ? rp.rounds[0] : rp.rounds;
      const playedOn = roundsRel?.played_on ?? "";
      const scores = Array.isArray(rp.scores) ? rp.scores : [];
      const totalStrokes = scores.reduce(
        (sum, s) => sum + (s?.strokes ?? 0),
        0,
      );
      return { playedOn, totalStrokes, scoreCount: scores.length };
    })
    .filter((r) => r.scoreCount > 0 && r.playedOn !== "");

  if (rounds.length === 0) return EMPTY_STATS;

  const totalStrokesSum = rounds.reduce((sum, r) => sum + r.totalStrokes, 0);
  const avgScore = Math.round((totalStrokesSum / rounds.length) * 10) / 10;
  const bestScore = Math.min(...rounds.map((r) => r.totalStrokes));

  const sorted = [...rounds].sort((a, b) => b.playedOn.localeCompare(a.playedOn));
  const lastRound = {
    playedOn: sorted[0].playedOn,
    totalStrokes: sorted[0].totalStrokes,
  };

  return {
    roundsPlayed: rounds.length,
    avgScore,
    bestScore,
    lastRound,
  };
}
