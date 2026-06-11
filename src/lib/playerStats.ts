import { supabase } from "@/lib/supabase";
import { excludedFromIndividualStats } from "@/lib/format/helpers";
import { getPrimaryFlightByRound } from "@/lib/flights/resolve";

export type PlayerStatsFilter = {
  startDate?: string;
  endDate?: string;
};

export type PlayerStats = {
  roundsPlayed: number;
  avgGross: number | null;
  avgNet: number | null;
  best: number | null;
  worst: number | null;
  /** Last 5 round totals, newest-first. */
  recent5: number[];
  recent5AvgGross: number | null;
  /** All round totals, oldest-first (chronological — sparkline reads left-to-right). */
  allTotals: number[];
  lastRound: { playedOn: string; totalStrokes: number } | null;
};

const EMPTY_STATS: PlayerStats = {
  roundsPlayed: 0,
  avgGross: null,
  avgNet: null,
  best: null,
  worst: null,
  recent5: [],
  recent5AvgGross: null,
  allTotals: [],
  lastRound: null,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function fetchPlayerStats(
  playerId: number,
  filter: PlayerStatsFilter = {},
): Promise<PlayerStats> {
  let query = supabase
    .from("round_players")
    .select(
      `
        round_id,
        course_handicap,
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
    course_handicap: number | null;
    rounds: RoundRow | RoundRow[] | null;
    scores: ScoreRow[] | null;
  };

  const rows = data as unknown as Row[];

  // Format now lives on each round's primary flight (Session 1); batch-resolve
  // so the season-stats exclusion reads off the flight, not rounds.format.
  // Session 3 must revisit for true multi-flight rounds.
  const flightByRound = await getPrimaryFlightByRound(
    rows.map((rp) => rp.round_id),
  );

  const rounds = rows
    .map((rp) => {
      const roundsRel = Array.isArray(rp.rounds) ? rp.rounds[0] : rp.rounds;
      const playedOn = roundsRel?.played_on ?? "";
      const scores = Array.isArray(rp.scores) ? rp.scores : [];
      const totalStrokes = scores.reduce(
        (sum, s) => sum + (s?.strokes ?? 0),
        0,
      );
      return {
        playedOn,
        totalStrokes,
        scoreCount: scores.length,
        courseHandicap: rp.course_handicap,
        excludedFromStats: excludedFromIndividualStats(flightByRound.get(rp.round_id)?.format ?? null),
      };
    })
    // Wave 1B follow-up: exclude rounds that don't feed per-player season stats.
    // Team-card formats have no individual `scores` rows; Shambles DOES carry
    // per-player scores (it's individual best-ball net) but they aren't
    // authoritative (picked-up balls, relaxed close), so the format filter — NOT
    // the scoreCount guard — is what now keeps Shambles out of season averages.
    .filter((r) => r.scoreCount > 0 && r.playedOn !== "" && !r.excludedFromStats);

  if (rounds.length === 0) return EMPTY_STATS;

  const sortedAsc = [...rounds].sort((a, b) =>
    a.playedOn.localeCompare(b.playedOn),
  );
  const sortedDesc = [...rounds].sort((a, b) =>
    b.playedOn.localeCompare(a.playedOn),
  );

  const allTotals = sortedAsc.map((r) => r.totalStrokes);

  const totalSum = allTotals.reduce((s, n) => s + n, 0);
  const avgGross = round1(totalSum / allTotals.length);
  const best = Math.min(...allTotals);
  const worst = Math.max(...allTotals);

  const withCH = rounds.filter((r) => r.courseHandicap != null);
  const avgNet =
    withCH.length > 0
      ? round1(
          withCH.reduce(
            (sum, r) => sum + (r.totalStrokes - (r.courseHandicap as number)),
            0,
          ) / withCH.length,
        )
      : null;

  const recent5Rounds = sortedDesc.slice(0, 5);
  const recent5 = recent5Rounds.map((r) => r.totalStrokes);
  const recent5AvgGross =
    recent5.length > 0
      ? round1(recent5.reduce((s, n) => s + n, 0) / recent5.length)
      : null;

  const lastRound = {
    playedOn: sortedDesc[0].playedOn,
    totalStrokes: sortedDesc[0].totalStrokes,
  };

  return {
    roundsPlayed: rounds.length,
    avgGross,
    avgNet,
    best,
    worst,
    recent5,
    recent5AvgGross,
    allTotals,
    lastRound,
  };
}
