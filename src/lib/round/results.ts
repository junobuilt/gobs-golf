// Shared data layer for the round-results surface (round summary page +
// /leaderboard live/complete view). Owns the engine call, F9/B9 split, player
// roll-up (including Stableford points), and team ranking. Pure async — no
// React imports. Consumers wrap the call in their own useEffect.

import { supabase } from "@/lib/supabase";
import { computeRoundResult } from "@/lib/scoring";
import type { HoleInfo, Format, FormatConfig } from "@/lib/scoring";
import { getScoringBasis } from "@/lib/format/helpers";
import {
  rankTeams,
  holesCompleteForTeam,
  isStablefordFormat,
  type RankedTeam,
} from "@/lib/leaderboard/rank";

const F9 = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const B9 = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

export type PlayerRow = {
  rpId: number;
  displayName: string;
  grossTotal: number;
  // Best-N: signed net delta vs par-of-played. Stableford: absolute points sum.
  // Used by the in-team-expanded player row for the colored performance display.
  netValue: number;
  // Best-N: absolute net stroke total (engine `perPlayer.netTotal`). Stableford:
  // equals `netValue` (points sum). Used by the cross-team Individual Rankings
  // section for sort + display.
  netTotal: number;
  holesPlayed: number;
  // 18-length arrays. scores: strokes or null. par: hole par (uses player tee).
  scores: (number | null)[];
  par: number[];
};

export type TeamRow = {
  id: number; // team_number
  name: string;
  rosterDisplay: string;
  // Best-N: team delta vs teamPar (signed). Stableford: absolute points.
  total: number;
  rawTeamScore: number;
  teamPar: number;
  thru: number;
  f9Total: number | null; // delta or absolute pts; null if no F9 hole has team score
  b9Total: number | null;
  players: PlayerRow[];
};

export type LoadedRoundResults = {
  playedOn: string;
  isComplete: boolean;
  roundId: number;
  format: Format;
  formatConfig: FormatConfig;
  formatLocked: boolean;
  teams: Array<RankedTeam<TeamRow>>;
  maxThru: number;
};

export type LoadRoundResultsOutcome =
  | { status: "ok"; data: LoadedRoundResults }
  | { status: "missing_round" }
  | { status: "missing_format" };

export async function loadRoundResults(
  roundId: number,
): Promise<LoadRoundResultsOutcome> {
  const { data: round } = await supabase
    .from("rounds")
    .select("id, played_on, is_complete, format, format_config, format_locked_at")
    .eq("id", roundId)
    .single();

  if (!round) return { status: "missing_round" };

  const format = (round.format ?? null) as Format | null;
  const formatConfig = (round.format_config ?? null) as FormatConfig | null;
  if (!format || !formatConfig) return { status: "missing_format" };

  const { data: rps } = await supabase
    .from("round_players")
    .select(`
      id, team_number, tee_id, course_handicap,
      players ( display_name, full_name )
    `)
    .eq("round_id", roundId)
    .gt("team_number", 0)
    .order("team_number");

  if (!rps || rps.length === 0) {
    return {
      status: "ok",
      data: {
        playedOn: round.played_on,
        isComplete: round.is_complete,
        roundId,
        format,
        formatConfig,
        formatLocked: round.format_locked_at != null,
        teams: [],
        maxThru: 0,
      },
    };
  }

  const rpIds = (rps as any[]).map(r => r.id as number);
  const { data: allScores } = await supabase
    .from("scores")
    .select("round_player_id, hole_number, strokes")
    .in("round_player_id", rpIds);

  const scoresByRpId: Record<number, Record<number, number>> = {};
  allScores?.forEach((s: any) => {
    if (!scoresByRpId[s.round_player_id]) scoresByRpId[s.round_player_id] = {};
    scoresByRpId[s.round_player_id][s.hole_number] = s.strokes;
  });

  const teeIds = [...new Set((rps as any[]).map(r => r.tee_id).filter(Boolean))] as number[];
  const holesByTee: Record<number, HoleInfo[]> = {};
  for (const teeId of teeIds) {
    const { data: h } = await supabase
      .from("holes")
      .select("hole_number, par, stroke_index")
      .eq("tee_id", teeId)
      .order("hole_number");
    holesByTee[teeId] = (h || []).map((row: any) => ({
      holeNumber: row.hole_number,
      par: row.par,
      strokeIndex: row.stroke_index,
    }));
  }

  const teamMap: Record<number, any[]> = {};
  (rps as any[]).forEach(rp => {
    const tn = rp.team_number as number;
    if (!teamMap[tn]) teamMap[tn] = [];
    teamMap[tn].push(rp);
  });

  const useGross = getScoringBasis(formatConfig) === "gross";
  const isStableford = isStablefordFormat(format);

  const teamRows: TeamRow[] = Object.entries(teamMap).map(([teamNumStr, teamPlayers]) => {
    const teamNum = parseInt(teamNumStr);
    const firstTeeId = teamPlayers[0]?.tee_id as number;
    const teamHoles = holesByTee[firstTeeId] || [];
    const parByHole: Record<number, number> = {};
    teamHoles.forEach(h => { parByHole[h.holeNumber] = h.par; });

    const playersForEngine = teamPlayers.map((rp: any) => ({
      playerId: String(rp.id),
      courseHandicap: useGross ? 0 : rp.course_handicap,
      grossScores: scoresByRpId[rp.id] || {},
    }));

    const result = computeRoundResult({
      format,
      formatConfig: { ...formatConfig, basis: useGross ? "gross" : "net" },
      holes: teamHoles,
      players: playersForEngine,
    });

    const rawTeamScore = result.teamScore ?? 0;
    const teamPar = result.teamParAtScored;
    // Best-N: total is delta. Stableford: teamPar is 0, so total collapses to
    // absolute team points. Same convention as leaderboard PR 2.
    const total = rawTeamScore - teamPar;

    // F9 / B9 leg split from engine perHole. Best-N: legTotal = legScore - legPar
    // accumulated across scored holes. Stableford: legPar always 0 → legTotal
    // collapses to absolute leg points (matches A1.6 pill semantics).
    function legTotal(holes: ReadonlyArray<number>): number | null {
      let scoreSum = 0;
      let parSum = 0;
      let any = false;
      for (const hole of result.perHole) {
        if (!holes.includes(hole.holeNumber)) continue;
        if (hole.result.teamScore == null) continue;
        scoreSum += hole.result.teamScore;
        if (!isStableford) {
          parSum += (parByHole[hole.holeNumber] ?? 0) *
            hole.result.contributingPlayerIds.length;
        }
        any = true;
      }
      return any ? scoreSum - parSum : null;
    }

    const requiredIds = teamPlayers.map((rp: any) => rp.id as number);
    const thru = holesCompleteForTeam(scoresByRpId, requiredIds);

    const rosterDisplay = teamPlayers.map((rp: any) => {
      const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
      return playerRow?.display_name || playerRow?.full_name || "?";
    }).join(" · ");

    const players: PlayerRow[] = teamPlayers.map((rp: any) => {
      const rpScores = scoresByRpId[rp.id] || {};
      const playerHoles = holesByTee[rp.tee_id] || teamHoles;
      const par: number[] = Array.from({ length: 18 }, (_, i) =>
        playerHoles.find(h => h.holeNumber === i + 1)?.par ?? 0
      );
      const scores: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
        rpScores[i + 1] ?? null
      );

      const enginePlayer = result.perPlayer.find(p => p.playerId === String(rp.id));
      const grossTotal = enginePlayer?.grossTotal ?? 0;
      const netTotalStrokes = enginePlayer?.netTotal ?? 0;
      const holesPlayed = enginePlayer?.holesPlayed ?? 0;

      let netValue: number;
      if (isStableford) {
        let pts = 0;
        for (const hole of result.perHole) {
          const pp = hole.result.perPlayer.find(p => p.playerId === String(rp.id));
          if (pp?.points != null) pts += pp.points;
        }
        netValue = pts;
      } else {
        let parOfPlayed = 0;
        for (let i = 0; i < 18; i++) {
          if (scores[i] != null) parOfPlayed += par[i];
        }
        netValue = netTotalStrokes - parOfPlayed;
      }

      const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
      const displayName = playerRow?.display_name || playerRow?.full_name || "?";

      const netTotal = isStableford ? netValue : netTotalStrokes;

      return {
        rpId: rp.id as number,
        displayName,
        grossTotal,
        netValue,
        netTotal,
        holesPlayed,
        scores,
        par,
      };
    });

    return {
      id: teamNum,
      name: `Team ${teamNum}`,
      rosterDisplay,
      total,
      rawTeamScore,
      teamPar,
      thru,
      f9Total: legTotal(F9),
      b9Total: legTotal(B9),
      players,
    };
  });

  const ranked = rankTeams(teamRows, format);
  const maxThru = teamRows.reduce((m, t) => Math.max(m, t.thru), 0);

  return {
    status: "ok",
    data: {
      playedOn: round.played_on,
      isComplete: round.is_complete,
      roundId,
      format,
      formatConfig,
      formatLocked: round.format_locked_at != null,
      teams: ranked,
      maxThru,
    },
  };
}
