// F.1 — trimmed list-level loader for the History tab (global nav + admin
// Settings History). Returns every FINALIZED round's per-team rank / names /
// total in a handful of BATCHED queries (independent of round count), reusing
// the shared team-total math (teamTotals.ts) + the shared ranking core
// (rankAndFormatTeams) so each row's "−4" / "12 pts" string and place label are
// IDENTICAL to what RoundResultsView shows on the detail.
//
// Deliberately does NOT call loadRoundResults per round: that runs ~6 queries +
// the full per-player transformation PER round, so 21× on tab-load would lag
// the 60–80 demographic's older phones. This loader fetches no per-hole/
// per-player data — only what the mini-leaderboard rows need.

import { supabase } from "@/lib/supabase";
import type { HoleInfo, Format, FormatConfig } from "@/lib/scoring";
import { isTeamCardFormat } from "@/lib/format/helpers";
import { rankAndFormatTeams } from "@/lib/leaderboard/rankAndFormat";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import { buildTeamScoreMap, type TeamScoreRow } from "@/lib/round/teamScores";
import {
  buildEnginePerTeam,
  individualTeamTotal,
  teamCardScalars,
  type PlayerLookup,
} from "@/lib/round/teamTotals";

// One ranked team line on a History row.
export type HistoryTeamLine = {
  teamNumber: number;
  name: string; // "Team N"
  rosterDisplay: string; // disambiguated short names, " · "-joined
  playerIds: number[]; // round_players.player_id on this team — drives the player filter
  rank: number;
  total: number;
  totalLabel: string; // "−4" / "E" / "12 pts" — same as the detail headline
  placeLabel: string; // "6th of 8" / "T2 of 8"
};

export type RoundListItem = {
  roundId: number;
  playedOn: string; // ISO date (rounds.played_on)
  format: Format;
  hasBlindDraws: boolean;
  teams: HistoryTeamLine[]; // ranked, ascending rank
};

// Loads all finalized rounds, newest-first by played_on, with per-team
// rank/names/total. Rounds with no locked format are skipped (nothing to rank).
export async function loadRoundsList(): Promise<RoundListItem[]> {
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, played_on, format, format_config")
    .eq("is_complete", true)
    .order("played_on", { ascending: false });

  const finalized = (rounds ?? []).filter(
    (r: any) => r.format != null && r.format_config != null,
  );
  if (finalized.length === 0) return [];

  const roundIds = finalized.map((r: any) => r.id as number);

  // Batched: all team members across every finalized round (one query).
  const { data: rpsAll } = await supabase
    .from("round_players")
    .select(`
      id, round_id, player_id, team_number, tee_id, course_handicap, dropped_after_hole,
      players ( full_name )
    `)
    .in("round_id", roundIds)
    .gt("team_number", 0)
    .order("team_number");

  const rpRows = (rpsAll ?? []) as any[];
  const rpIds = rpRows.map(r => r.id as number);

  // Batched: every per-player score (individual formats) in one query.
  const { data: scoresAll } = rpIds.length
    ? await supabase
        .from("scores")
        .select("round_player_id, hole_number, strokes")
        .in("round_player_id", rpIds)
    : { data: [] as any[] };

  // Batched: every blind-draw fill (drives the 🎲 chip + Stableford totals).
  const { data: blindAll } = await supabase
    .from("blind_draws")
    .select("round_id, short_team_number, drawn_player_id, hole_range_start, hole_range_end")
    .in("round_id", roundIds);

  // Batched: hole tables for every tee involved.
  const teeIds = [...new Set(rpRows.map(r => r.tee_id).filter(Boolean))] as number[];
  const { data: holesAll } = teeIds.length
    ? await supabase
        .from("holes")
        .select("tee_id, hole_number, par, stroke_index")
        .in("tee_id", teeIds)
    : { data: [] as any[] };

  // Batched: active roster for render-time name disambiguation ("Wayne H" /
  // "Wayne V") — the SAME universe loadRoundResults uses, so the list and the
  // detail print a player's short name identically.
  const { data: activePlayerRows } = await supabase
    .from("players")
    .select("id, full_name, is_active")
    .eq("is_active", true);
  const activeRoster: PlayerLike[] = (activePlayerRows ?? []) as PlayerLike[];
  const nameFor = (playerId: number, fullName: string | null | undefined): string => {
    const fn = fullName ?? "";
    if (!fn) return "?";
    return getDisplayName({ id: playerId, full_name: fn }, activeRoster);
  };

  // Team-card rounds (Texas Scramble / Alternate Shot) score in team_scores.
  const teamCardRoundIds = finalized
    .filter((r: any) => isTeamCardFormat(r.format as Format))
    .map((r: any) => r.id as number);
  const { data: teamScoresAll } = teamCardRoundIds.length
    ? await supabase
        .from("team_scores")
        .select("round_id, team_number, hole_number, ball_index, strokes")
        .in("round_id", teamCardRoundIds)
    : { data: [] as any[] };

  // ---- index the batched rows by round ----
  const rpsByRound: Record<number, any[]> = {};
  for (const rp of rpRows) {
    (rpsByRound[rp.round_id as number] ??= []).push(rp);
  }

  const scoresByRpId: Record<number, Record<number, number>> = {};
  for (const s of (scoresAll ?? []) as any[]) {
    (scoresByRpId[s.round_player_id] ??= {})[s.hole_number] = s.strokes;
  }

  const blindByRound: Record<number, any[]> = {};
  for (const bd of (blindAll ?? []) as any[]) {
    (blindByRound[bd.round_id as number] ??= []).push(bd);
  }

  const holesByTee: Record<number, HoleInfo[]> = {};
  for (const h of (holesAll ?? []) as any[]) {
    (holesByTee[h.tee_id] ??= []).push({
      holeNumber: h.hole_number,
      par: h.par,
      strokeIndex: h.stroke_index,
    });
  }
  for (const teeId of Object.keys(holesByTee)) {
    holesByTee[Number(teeId)].sort((a, b) => a.holeNumber - b.holeNumber);
  }

  const teamScoreRowsByRound: Record<number, TeamScoreRow[]> = {};
  for (const ts of (teamScoresAll ?? []) as any[]) {
    (teamScoreRowsByRound[ts.round_id as number] ??= []).push({
      team_number: ts.team_number,
      hole_number: ts.hole_number,
      ball_index: ts.ball_index,
      strokes: ts.strokes,
    });
  }

  // ---- per round: compute ranked team totals via the SHARED helpers ----
  const items: RoundListItem[] = [];
  for (const round of finalized) {
    const roundId = round.id as number;
    const format = round.format as Format;
    const formatConfig = round.format_config as FormatConfig;
    const rps = rpsByRound[roundId] ?? [];
    if (rps.length === 0) continue;

    const blindDrawRows = blindByRound[roundId] ?? [];
    const hasBlindDraws = blindDrawRows.length > 0;

    const teamMap: Record<number, any[]> = {};
    for (const rp of rps) {
      (teamMap[rp.team_number as number] ??= []).push(rp);
    }

    // Roster + playerIds per team (shared by both paths).
    const teamMeta = (teamNum: number, teamPlayers: any[]) => {
      const rosterDisplay = teamPlayers
        .map((rp: any) => {
          const pr = Array.isArray(rp.players) ? rp.players[0] : rp.players;
          return nameFor(rp.player_id as number, pr?.full_name);
        })
        .join(" · ");
      return {
        teamNumber: teamNum,
        name: `Team ${teamNum}`,
        rosterDisplay,
        playerIds: teamPlayers.map((rp: any) => rp.player_id as number),
      };
    };

    type Bare = { id: number; total: number } & ReturnType<typeof teamMeta>;
    const bareTeams: Bare[] = [];

    if (isTeamCardFormat(format)) {
      const tsMap = buildTeamScoreMap(teamScoreRowsByRound[roundId] ?? []);
      for (const [teamNumStr, teamPlayers] of Object.entries(teamMap)) {
        const teamNum = parseInt(teamNumStr);
        const firstTeeId = (teamPlayers as any[])[0]?.tee_id as number;
        const teamHoles = holesByTee[firstTeeId] || [];
        const { total } = teamCardScalars({ format, teamNum, teamPlayers, teamHoles, tsMap });
        bareTeams.push({ id: teamNum, total, ...teamMeta(teamNum, teamPlayers) });
      }
    } else {
      // playerLookup: player_id → their own round_players row (for blind-draw inputs).
      const playerLookup: PlayerLookup = {};
      for (const rp of rps) {
        const pr = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        playerLookup[rp.player_id as number] = {
          rpId: rp.id as number,
          teamNumber: rp.team_number as number,
          teeId: rp.tee_id as number,
          displayName: nameFor(rp.player_id as number, pr?.full_name),
        };
      }
      const enginePerTeam = buildEnginePerTeam({
        format, formatConfig, teamMap, holesByTee, scoresByRpId, blindDrawRows, rps, playerLookup,
      });
      for (const [teamNumStr, teamPlayers] of Object.entries(teamMap)) {
        const teamNum = parseInt(teamNumStr);
        const { total } = individualTeamTotal(enginePerTeam[teamNum]);
        bareTeams.push({ id: teamNum, total, ...teamMeta(teamNum, teamPlayers) });
      }
    }

    const ranked = rankAndFormatTeams(bareTeams, format);
    items.push({
      roundId,
      playedOn: round.played_on as string,
      format,
      hasBlindDraws,
      teams: ranked
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map(t => ({
          teamNumber: t.teamNumber,
          name: t.name,
          rosterDisplay: t.rosterDisplay,
          playerIds: t.playerIds,
          rank: t.rank,
          total: t.total,
          totalLabel: t.totalLabel,
          placeLabel: t.placeLabel,
        })),
    });
  }

  return items;
}
