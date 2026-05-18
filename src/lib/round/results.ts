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
  // D.1: NULL = played all 18 (or hasn't dropped). 1..17 = walked off after
  // that hole. Drives the "Left after hole N" badge and the mid-round
  // dropout merge with a blind_draws fill in PlayerHoleGrid.
  droppedAfterHole: number | null;
};

// D.1: one blind-draw fill on a short team. Display layer (RoundResultsView,
// read-only scorecard) reads this to render the 🎲 caption, the merged
// PlayerHoleGrid for mid-round dropouts, and the pseudo-player row for
// round-start fills.
export type BlindDrawFill = {
  drawnPlayerId: number;
  drawnPlayerName: string;
  fromTeamNumber: number;
  holeRangeStart: number; // 1 for full-18 fill, N+1 for mid-round dropout
  holeRangeEnd: number;   // always 18
  // 18-length gross-score array for the drawn player. Consumer slices to
  // the fill range when merging with a dropout's partial scores.
  drawnPlayerScores: (number | null)[];
  // D.1 hotfix follow-up: drawn player's aggregate contribution to the
  // short team for the fill range. Format-aware:
  //   - Best-N (net or gross basis): signed delta vs par-in-range using
  //     the drawn player's own engine output. Same convention as
  //     PlayerRow.netValue. Gross basis simply runs the engine with the
  //     player's course_handicap zeroed.
  //   - Stableford: absolute sum of points awarded across the range.
  // View renders via formatPlayerNet(value, format) prefixed with
  // "Net"/"Gross" per the round's scoring_basis (Stableford label is
  // baked into formatPlayerNet's "X pts" output).
  drawnPlayerNetValue: number;
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
  // D.1: empty when this team had no fills. Multiple fills ordered to match
  // the engine's draw order (round-start first, then dropouts by ascending
  // dropout hole). Roster rendering uses this list to lay out 🎲 captions.
  blindDraws: BlindDrawFill[];
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
      id, player_id, team_number, tee_id, course_handicap, dropped_after_hole,
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

  // D.1: load blind-draw fills for this round. Returns [] for any round that
  // either hasn't been finalized yet or had no short teams. Joined with
  // players to display the drawn player's name.
  const { data: blindDrawRows } = await supabase
    .from("blind_draws")
    .select(`
      short_team_number, drawn_player_id, hole_range_start, hole_range_end,
      players ( display_name, full_name )
    `)
    .eq("round_id", roundId)
    .order("id");

  // playerId -> { rpId, teamNumber, displayName }. Used to look up the
  // drawn player's round_players row for their score array and their own
  // team_number ("from Team N" caption).
  const playerLookup: Record<number, {
    rpId: number; teamNumber: number; displayName: string;
  }> = {};
  (rps as any[]).forEach(rp => {
    const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
    playerLookup[rp.player_id as number] = {
      rpId: rp.id as number,
      teamNumber: rp.team_number as number,
      displayName: playerRow?.display_name || playerRow?.full_name || "?",
    };
  });

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

  // D.1 hotfix follow-up: precompute engine + par lookup per team in a
  // first pass so the second pass can do cross-team lookups when
  // computing each blind-draw fill's contribution (the drawn player's
  // engine output lives on their OWN team, not the short team).
  type TeamEngineCache = {
    engine: ReturnType<typeof computeRoundResult>;
    parByHole: Record<number, number>;
  };
  const enginePerTeam: Record<number, TeamEngineCache> = {};
  Object.entries(teamMap).forEach(([teamNumStr, teamPlayers]) => {
    const teamNum = parseInt(teamNumStr);
    const firstTeeId = (teamPlayers as any[])[0]?.tee_id as number;
    const teamHoles = holesByTee[firstTeeId] || [];
    const parByHole: Record<number, number> = {};
    teamHoles.forEach(h => { parByHole[h.holeNumber] = h.par; });
    const playersForEngine = (teamPlayers as any[]).map((rp: any) => ({
      playerId: String(rp.id),
      courseHandicap: useGross ? 0 : rp.course_handicap,
      grossScores: scoresByRpId[rp.id] || {},
    }));
    enginePerTeam[teamNum] = {
      engine: computeRoundResult({
        format,
        formatConfig: { ...formatConfig, basis: useGross ? "gross" : "net" },
        holes: teamHoles,
        players: playersForEngine,
      }),
      parByHole,
    };
  });

  const teamRows: TeamRow[] = Object.entries(teamMap).map(([teamNumStr, teamPlayers]) => {
    const teamNum = parseInt(teamNumStr);
    const firstTeeId = teamPlayers[0]?.tee_id as number;
    const teamHoles = holesByTee[firstTeeId] || [];
    const { engine: result, parByHole } = enginePerTeam[teamNum];

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
        droppedAfterHole: rp.dropped_after_hole ?? null,
      };
    });

    // D.1: fills for this team (matched by short_team_number). Drawn player's
    // 18-score array comes from the same scoresByRpId map already built —
    // looked up via player_id → round_players.id.
    const blindDraws: BlindDrawFill[] = (blindDrawRows ?? [])
      .filter((bd: any) => bd.short_team_number === teamNum)
      .map((bd: any) => {
        const drawnPlayerId = bd.drawn_player_id as number;
        const lookup = playerLookup[drawnPlayerId];
        const drawnPlayerRow = Array.isArray(bd.players) ? bd.players[0] : bd.players;
        const drawnPlayerName =
          drawnPlayerRow?.display_name ||
          drawnPlayerRow?.full_name ||
          lookup?.displayName ||
          "?";
        const drawnScoresMap = lookup ? (scoresByRpId[lookup.rpId] || {}) : {};
        const drawnPlayerScores: (number | null)[] = Array.from(
          { length: 18 },
          (_, i) => drawnScoresMap[i + 1] ?? null,
        );
        const holeRangeStart = bd.hole_range_start as number;
        const holeRangeEnd = bd.hole_range_end as number;

        // D.1 hotfix follow-up: aggregate the drawn player's contribution
        // to the short team over the fill range. Engine output lives on
        // the drawn player's OWN team (where their handicap was applied
        // during the engine call); we look up via fromTeamNumber.
        let drawnPlayerNetValue = 0;
        const drawnCache = lookup ? enginePerTeam[lookup.teamNumber] : undefined;
        if (lookup && drawnCache) {
          const drawnRpIdStr = String(lookup.rpId);
          let scoreSum = 0;
          let parSum = 0;
          for (let h = holeRangeStart; h <= holeRangeEnd; h++) {
            const holeEngine = drawnCache.engine.perHole.find(p => p.holeNumber === h);
            if (!holeEngine) continue;
            const pp = holeEngine.result.perPlayer.find(p => p.playerId === drawnRpIdStr);
            if (!pp) continue;
            if (isStableford) {
              if (pp.points != null) scoreSum += pp.points;
            } else if (pp.netScore != null) {
              scoreSum += pp.netScore;
              parSum += drawnCache.parByHole[h] ?? 0;
            }
          }
          drawnPlayerNetValue = isStableford ? scoreSum : scoreSum - parSum;
        }

        return {
          drawnPlayerId,
          drawnPlayerName,
          fromTeamNumber: lookup?.teamNumber ?? 0,
          holeRangeStart,
          holeRangeEnd,
          drawnPlayerScores,
          drawnPlayerNetValue,
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
      blindDraws,
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
