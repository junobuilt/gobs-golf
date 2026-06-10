// Shared per-team TOTAL math for the round-results surfaces. Extracted from
// loadRoundResults (src/lib/round/results.ts) so the History list loader
// (src/lib/round/loadRoundsList.ts) computes each team's headline `total`
// through the EXACT same path. List rows and the RoundResultsView detail can
// therefore never silently diverge on the number behind the "−4" / "12 pts"
// string — the formatting is shared (formatTeamTotal via rankAndFormatTeams)
// and now the underlying total is shared too.
//
// Pure: operates on already-fetched in-memory data. Each loader does its own
// fetching (loadRoundResults per single round; loadRoundsList in batched
// queries across every finalized round) and hands the rows in here.

import { computeRoundResult, computeTeamHandicap } from "@/lib/scoring";
import type { HoleInfo, Format, FormatConfig, BlindDrawInput } from "@/lib/scoring";
import { getScoringBasis, getPlayingCourseHandicap } from "@/lib/format/helpers";
import {
  getTeamHoleTotal,
  getTeamTotal,
  holesScoredForTeam,
  type TeamScoreMap,
} from "@/lib/round/teamScores";

export type TeamEngineCache = {
  engine: ReturnType<typeof computeRoundResult>;
  parByHole: Record<number, number>;
};

// playerId -> the drawn player's own round_players row, used when building a
// short team's blind-draw engine inputs (their CH/scores live on their team).
export type PlayerLookup = Record<
  number,
  { rpId: number; teamNumber: number; teeId: number; displayName: string }
>;

// Builds the per-team engine cache for INDIVIDUAL (non-team-card) formats.
// Verbatim port of loadRoundResults' first pass — kept as the single
// definition so the list loader scores identically (incl. blind draws).
export function buildEnginePerTeam(args: {
  format: Format;
  formatConfig: FormatConfig;
  teamMap: Record<number, any[]>;
  holesByTee: Record<number, HoleInfo[]>;
  scoresByRpId: Record<number, Record<number, number>>;
  blindDrawRows: any[] | null;
  rps: any[];
  playerLookup: PlayerLookup;
}): Record<number, TeamEngineCache> {
  const {
    format, formatConfig, teamMap, holesByTee, scoresByRpId, blindDrawRows, rps, playerLookup,
  } = args;
  const useGross = getScoringBasis(formatConfig) === "gross";
  const enginePerTeam: Record<number, TeamEngineCache> = {};

  Object.entries(teamMap).forEach(([teamNumStr, teamPlayers]) => {
    const teamNum = parseInt(teamNumStr);
    const firstTeeId = (teamPlayers as any[])[0]?.tee_id as number;
    const teamHoles = holesByTee[firstTeeId] || [];
    const parByHole: Record<number, number> = {};
    teamHoles.forEach(h => { parByHole[h.holeNumber] = h.par; });

    const playersForEngine = (teamPlayers as any[]).map((rp: any) => ({
      playerId: String(rp.id),
      courseHandicap: useGross ? 0 : getPlayingCourseHandicap(rp.course_handicap, formatConfig),
      grossScores: scoresByRpId[rp.id] || {},
    }));

    const blindDrawInputs: BlindDrawInput[] = (blindDrawRows ?? [])
      .filter((bd: any) => bd.short_team_number === teamNum)
      .map((bd: any) => {
        const drawnPlayerId = bd.drawn_player_id as number;
        const lookup = playerLookup[drawnPlayerId];
        const drawnRpId = lookup?.rpId;
        const drawnHoles = lookup ? (holesByTee[lookup.teeId] || []) : [];
        const drawnRp = (rps as any[]).find(r => r.id === drawnRpId);
        const drawnCH = useGross
          ? 0
          : getPlayingCourseHandicap(drawnRp?.course_handicap ?? null, formatConfig);
        return {
          drawnPlayerId: String(drawnRpId ?? drawnPlayerId),
          drawnPlayerCourseHandicap: drawnCH,
          drawnPlayerScores: drawnRpId ? (scoresByRpId[drawnRpId] || {}) : {},
          drawnPlayerHoles: drawnHoles,
          holeRangeStart: bd.hole_range_start as number,
          holeRangeEnd: bd.hole_range_end as number,
        };
      });

    enginePerTeam[teamNum] = {
      engine: computeRoundResult({
        format,
        formatConfig: { ...formatConfig, basis: useGross ? "gross" : "net" },
        holes: teamHoles,
        players: playersForEngine,
        blindDraws: blindDrawInputs,
      }),
      parByHole,
    };
  });

  return enginePerTeam;
}

// THE single definition of an individual team's headline total.
//   Best-N: blindDrawTotal stays 0 → total = rawTeamScore − teamPar (delta).
//   Stableford: teamPar is 0 → total = rawTeamScore + blindDrawTotal (points).
export function individualTeamTotal(cache: TeamEngineCache): {
  rawTeamScore: number;
  teamPar: number;
  total: number;
} {
  const rawTeamScore = cache.engine.teamScore ?? 0;
  const teamPar = cache.engine.teamParAtScored;
  const total = rawTeamScore + cache.engine.blindDrawTotal - teamPar;
  return { rawTeamScore, teamPar, total };
}

// THE single definition of a TEAM-CARD team's headline total + the scalars the
// summary expand reuses (Texas Scramble / Alternate Shot, and Shambles team
// rows). Net = team gross − single team-handicap deduction (members' FULL CHs);
// the per-format weighting IS the allowance, so the Wave 1A % is not applied.
export function teamCardScalars(args: {
  format: Format;
  teamNum: number;
  teamPlayers: any[];
  teamHoles: HoleInfo[];
  tsMap: TeamScoreMap;
}): {
  rawTeamScore: number;
  teamPar: number;
  total: number;
  thru: number;
  teamHandicap: number;
  teamNet: number;
  gridScores: (number | null)[];
  gridPar: number[];
} {
  const { format, teamNum, teamPlayers, teamHoles, tsMap } = args;
  const parByHole: Record<number, number> = {};
  teamHoles.forEach(h => { parByHole[h.holeNumber] = h.par; });

  const gridScores: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
    getTeamHoleTotal(tsMap, teamNum, i + 1),
  );
  const gridPar: number[] = Array.from({ length: 18 }, (_, i) => parByHole[i + 1] ?? 0);

  const rawTeamScore = getTeamTotal(tsMap, teamNum);
  let teamPar = 0;
  for (let i = 0; i < 18; i++) if (gridScores[i] != null) teamPar += gridPar[i];

  const teamHandicap = computeTeamHandicap(
    format,
    (teamPlayers as any[]).map((rp: any) => rp.course_handicap ?? null),
  ) ?? 0;
  const teamNet = rawTeamScore - teamHandicap;
  const total = teamNet - teamPar; // signed NET delta vs par (lower = better)
  const thru = holesScoredForTeam(tsMap, teamNum);

  return { rawTeamScore, teamPar, total, thru, teamHandicap, teamNet, gridScores, gridPar };
}
