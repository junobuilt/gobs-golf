// Shared data layer for the round-results surface (round summary page +
// /leaderboard live/complete view). Owns the engine call, F9/B9 split, player
// roll-up (including Stableford points), and team ranking. Pure async — no
// React imports. Consumers wrap the call in their own useEffect.
//
// Flights Track, Session 3: rankings are computed PER FLIGHT. Output carries an
// ordered `flightSections` array (each flight's format + ranked TeamRows) plus a
// round-wide `individualRankings` list (the canonical, displayed order — never
// re-sorted in the view). Single-flight rounds resolve to exactly one section
// whose teams are byte-identical to the pre-flights flat list, and every
// additive field collapses to today's behavior.

import { supabase } from "@/lib/supabase";
import { getHandicapStrokes, computeAdjustedHoleScores } from "@/lib/scoring";
import type { HoleInfo, Format, FormatConfig } from "@/lib/scoring";
import { getPlayingCourseHandicap, isTeamCardFormat } from "@/lib/format/helpers";
import { getFlightsForRound, getTeamFlightMap } from "@/lib/flights/resolve";
import {
  holesCompleteForTeam,
  isStablefordFormat,
} from "@/lib/leaderboard/rank";
import {
  rankAndFormatTeams,
  type RankedFormattedTeam,
} from "@/lib/leaderboard/rankAndFormat";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import { loadTeamScores } from "@/lib/round/teamScoresIo";
import { buildTeamScoreMap } from "@/lib/round/teamScores";
import {
  buildEnginePerTeam,
  individualTeamTotal,
  teamCardScalars,
} from "@/lib/round/teamTotals";

const F9 = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const B9 = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

export type PlayerRow = {
  rpId: number;
  // F.1 fix: players.id (NOT round_players.id) — lets the History list, which is
  // now a projection of loadRoundResults, map teams → player ids for its filter.
  playerId: number;
  displayName: string;
  grossTotal: number;
  // Best-N: signed net delta vs par-of-played. Stableford: absolute points sum.
  // Used by the in-team-expanded player row for the colored performance display.
  netValue: number;
  // Best-N: absolute net stroke total (engine `perPlayer.netTotal`). Stableford:
  // equals `netValue` (points sum). Used by the cross-team Individual Rankings
  // section for sort + display.
  netTotal: number;
  // Flights S3: ALWAYS the allowance-adjusted absolute net STROKE total (engine
  // `perPlayer.netTotal`, format-agnostic) — even for Stableford, where
  // `netTotal` above carries points instead. The mixed-format round-wide
  // Individual Rankings ranks by this. 0 for team-card roster rows.
  netStrokes: number;
  holesPlayed: number;
  // 18-length arrays. scores: strokes or null. par: hole par (uses player tee).
  scores: (number | null)[];
  par: number[];
  // Wave 1A: GHIN Adjusted (Net Double Bogey-capped) per-hole scores, 18-length.
  // ALWAYS computed at 100% handicap (raw course_handicap), ignoring the round's
  // handicap allowance by design. Read-only / display-only — never feeds
  // competition net, ranking, or payouts.
  adjScores: (number | null)[];
  // 2026-06-09: per-hole handicap stroke allocation (0/1/2…), 18-length, from
  // the allowance-ADJUSTED playing CH + each hole's stroke index — the SAME
  // source the net engine scores on. Display-only: feeds PlayerHoleGrid's dot
  // row on summary/leaderboard. All-zeros for team-card roster rows.
  strokeAllocation: number[];
  // D.1: NULL = played all 18 (or hasn't dropped). 1..17 = walked off after
  // that hole. Drives the "Left after hole N" badge and the mid-round
  // dropout merge with a blind_draws fill in PlayerHoleGrid.
  droppedAfterHole: number | null;
  // F.1 Part 5: the round's STORED (raw, 100%) course handicap from
  // round_players.course_handicap. Display-only — the expanded player row on
  // RoundResultsView renders the allowance-adjusted PLAYING CH via
  // getPlayingCourseHandicap(courseHandicap, formatConfig) so the number
  // matches the scorecard on allowance rounds. NULL for players missing a CH.
  // (Carried on team-card roster rows too, though those never expand per-player.)
  courseHandicap: number | null;
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
  // 18-length per-hole par array for the drawn player's tee. Used by
  // BlindDrawPseudoPlayerSection to pass real pars to PlayerHoleGrid.
  drawnPlayerPar: number[];
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
  // Flights S3 (additive): the flight this team plays in. Single-flight rounds
  // carry the primary flight here; existing consumers ignore both fields.
  flightId: number;
  flightName: string;
  // Wave 1B: present ONLY for team-card rounds (Shambles). The team's 18-hole
  // row — `scores[i]` is the hole's summed team total (or null), `par[i]` the
  // course par — for the summary/leaderboard expand, which shows ONE team row
  // instead of per-player rows. Undefined for individual formats. Additive:
  // existing consumers ignore it. For team-card rounds `players` is still
  // populated (the roster) but score-less (holesPlayed 0), so payout headcount
  // and the per-player surfaces behave correctly without reading this field.
  teamGrid?: { scores: (number | null)[]; par: number[] };
  // Phase 1C: present ONLY for NET team-card formats (Texas Scramble /
  // Alternate Shot). `teamHandicap` is the single deduction off the team gross
  // (computeTeamHandicap on members' raw CHs); `teamNet` = rawTeamScore −
  // teamHandicap (the absolute net stroke total). The ranked headline `total`
  // is the net delta vs par. Additive: existing consumers (incl. the payout
  // track, which reads `rank` + `players.length`) ignore both fields.
  teamHandicap?: number;
  teamNet?: number;
};

// Flights S3: one ordered flight section. `teams` are ranked WITHIN the flight
// under the flight's own format. Single-flight rounds produce exactly one
// section whose `teams` equal the pre-flights flat ranked list.
export type FlightSection = {
  flightId: number;
  flightName: string;
  format: Format;
  formatConfig: FormatConfig;
  formatLocked: boolean;
  teams: Array<RankedFormattedTeam<TeamRow>>;
};

// Flights S3: how the round-wide Individual Rankings list is displayed + ordered.
//   best_n      — one non-team-card flight, best-N: Gross/Net(strokes), net asc.
//   stableford  — one non-team-card flight, Stableford: "N pts", points desc.
//   net_strokes — 2+ non-team-card flights with DIFFERING formats: rank every
//                 individual-format player by net STROKES (each under their own
//                 flight's allowance), Gross/Net(strokes) display, strokes asc.
export type IndividualRankingsMode = "best_n" | "stableford" | "net_strokes";

// Flights S3: one row of the canonical round-wide Individual Rankings, already
// ordered + skip-tie ranked in results.ts. The view renders these verbatim.
export type IndividualRankingRow = {
  rpId: number;
  playerId: number;
  displayName: string;
  teamName: string;
  flightId: number;
  grossTotal: number;
  netStrokes: number;
  // Stableford points sum for this player; meaningful only in "stableford"
  // mode (0 otherwise). Display-only.
  points: number;
  rank: number;
};

export type LoadedRoundResults = {
  playedOn: string;
  isComplete: boolean;
  roundId: number;
  // Back-compat: the PRIMARY flight's format / config / lock. Multi-flight
  // rounds read per-section format from `flightSections`; this stays the
  // primary so single-flight consumers (FormatChip header, single-flight
  // payout) are unchanged.
  format: Format;
  formatConfig: FormatConfig;
  formatLocked: boolean;
  // Flat ranked team list = every section's teams concatenated in flight
  // sort_order. For multi-flight rounds team `rank` is PER FLIGHT (rank 1
  // repeats per flight); there is no synthetic round-wide team rank.
  teams: Array<RankedFormattedTeam<TeamRow>>;
  // Flights S3 (additive): ordered flight sections. Length 1 for single-flight.
  flightSections: FlightSection[];
  // Flights S3 (additive): canonical round-wide Individual Rankings order.
  individualRankings: IndividualRankingRow[];
  individualRankingsMode: IndividualRankingsMode;
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
    .select("id, played_on, is_complete")
    .eq("id", roundId)
    .single();

  if (!round) return { status: "missing_round" };

  // Format ownership lives on flights (Session 1). The PRIMARY flight (lowest
  // sort_order) drives the back-compat top-level format / config / lock and the
  // missing_format guard; per-flight rankings read each flight's own format
  // below. Session 3 makes this surface flight-aware.
  const flights = await getFlightsForRound(roundId); // sort_order ascending
  const primary = flights[0] ?? null;
  const format = (primary?.format ?? null) as Format | null;
  const formatConfig = (primary?.format_config ?? null) as FormatConfig | null;
  const formatLockedAt = primary?.format_locked_at ?? null;
  if (!format || !formatConfig) return { status: "missing_format" };

  const emptyResult = (teams: Array<RankedFormattedTeam<TeamRow>>): LoadedRoundResults => ({
    playedOn: round.played_on,
    isComplete: round.is_complete,
    roundId,
    format,
    formatConfig,
    formatLocked: formatLockedAt != null,
    teams,
    flightSections: [],
    individualRankings: [],
    individualRankingsMode: "best_n",
    maxThru: 0,
  });

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
    return { status: "ok", data: emptyResult([]) };
  }
  // Stable non-null binding so the per-flight builder closures (called later)
  // keep the narrowing TS drops across closure boundaries.
  const rpsRows = rps as any[];

  // Render-time disambiguating names ("Wayne H" / "Wayne V"). The universe is
  // ALL active players, not just this round's roster, so a player's short name
  // is identical here and on every other surface. Derived from full_name only
  // (display_name is intentionally ignored, per the locked naming convention).
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

  // playerId -> { rpId, teamNumber, teeId, displayName }. Used to look up
  // the drawn player's round_players row for their score array, par array,
  // and own team_number ("from Team N" caption).
  const playerLookup: Record<number, {
    rpId: number; teamNumber: number; teeId: number; displayName: string;
  }> = {};
  (rps as any[]).forEach(rp => {
    const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
    playerLookup[rp.player_id as number] = {
      rpId: rp.id as number,
      teamNumber: rp.team_number as number,
      teeId: rp.tee_id as number,
      displayName: nameFor(rp.player_id as number, playerRow?.full_name),
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

  // Flights S3: resolve every assigned team to its flight (canonical default
  // rule lives in getTeamFlightMap). Single-flight rounds map every team to the
  // primary flight, so the grouping below produces one section identical to the
  // old flat output.
  const teamFlightMap = await getTeamFlightMap(roundId);

  // Team-card team scores are scored at the TEAM level in `team_scores`. Load
  // once iff any flight is a team-card format (matches the old single-branch
  // cost — individual-only rounds make no extra query).
  const anyTeamCard = flights.some(f => f.format && isTeamCardFormat(f.format as Format));
  const tsMap = anyTeamCard ? buildTeamScoreMap(await loadTeamScores(roundId)) : null;

  // ── Per-flight team-row builders ────────────────────────────────────────────
  // Each takes a teamMap SUBSET (the teams resolved to one flight) + that
  // flight's format/config. The bodies are verbatim ports of the pre-flights
  // single-branch code, so a subset == the whole teamMap reproduces it exactly.

  function buildTeamCardTeamRows(
    subset: Record<number, any[]>,
    fmt: Format,
    flightId: number,
    flightName: string,
  ): TeamRow[] {
    return Object.entries(subset).map(([teamNumStr, teamPlayers]) => {
      const teamNum = parseInt(teamNumStr);
      const firstTeeId = (teamPlayers as any[])[0]?.tee_id as number;
      const teamHoles = holesByTee[firstTeeId] || [];

      const {
        rawTeamScore, teamPar, total, thru, teamHandicap, teamNet, gridScores, gridPar,
      } = teamCardScalars({ format: fmt, teamNum, teamPlayers, teamHoles, tsMap: tsMap! });

      const legTotal = (holes: ReadonlyArray<number>): number | null => {
        let scoreSum = 0, parSum = 0, any = false;
        for (const h of holes) {
          const t = gridScores[h - 1];
          if (t == null) continue;
          scoreSum += t;
          parSum += gridPar[h - 1];
          any = true;
        }
        return any ? scoreSum - parSum : null;
      };

      const rosterDisplay = (teamPlayers as any[]).map((rp: any) => {
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        return nameFor(rp.player_id as number, playerRow?.full_name);
      }).join(" · ");

      // Roster rows, score-less. holesPlayed 0 → excluded from the cross-team
      // Individual Rankings; players.length still gives payout headcount/teamSize.
      const players: PlayerRow[] = (teamPlayers as any[]).map((rp: any) => {
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        return {
          rpId: rp.id as number,
          playerId: rp.player_id as number,
          displayName: nameFor(rp.player_id as number, playerRow?.full_name),
          grossTotal: 0,
          netValue: 0,
          netTotal: 0,
          netStrokes: 0,
          holesPlayed: 0,
          scores: Array.from({ length: 18 }, () => null),
          par: gridPar.slice(),
          adjScores: Array.from({ length: 18 }, () => null),
          strokeAllocation: Array.from({ length: 18 }, () => 0),
          droppedAfterHole: rp.dropped_after_hole ?? null,
          courseHandicap: rp.course_handicap ?? null,
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
        blindDraws: [],
        flightId,
        flightName,
        teamGrid: { scores: gridScores, par: gridPar },
        teamHandicap,
        teamNet,
      };
    });
  }

  function buildIndividualTeamRows(
    subset: Record<number, any[]>,
    fmt: Format,
    cfg: FormatConfig,
    flightId: number,
    flightName: string,
  ): TeamRow[] {
    const isStableford = isStablefordFormat(fmt);

    // D.1 hotfix follow-up: precompute engine + par lookup per team in a first
    // pass so the second pass can do cross-team lookups when computing each
    // blind-draw fill's contribution (the drawn player's engine output lives on
    // their OWN team). F.1: this pass lives in teamTotals.ts so the History list
    // loader scores every round through the identical path.
    const enginePerTeam = buildEnginePerTeam({
      format: fmt, formatConfig: cfg, teamMap: subset, holesByTee, scoresByRpId,
      blindDrawRows, rps: rpsRows, playerLookup,
    });

    return Object.entries(subset).map(([teamNumStr, teamPlayers]) => {
      const teamNum = parseInt(teamNumStr);
      const firstTeeId = teamPlayers[0]?.tee_id as number;
      const teamHoles = holesByTee[firstTeeId] || [];
      const cache = enginePerTeam[teamNum];
      const result = cache.engine;
      const parByHole = cache.parByHole;
      // Headline total from the shared single definition (see teamTotals.ts).
      // Best-N: delta vs par (blindDrawTotal 0). Stableford: points incl. fills.
      const { rawTeamScore, teamPar, total } = individualTeamTotal(cache);

      // F9 / B9 leg split from engine perHole + blindDrawPerHole. Best-N:
      // legTotal = legScore - legPar accumulated across scored holes (blind-
      // draw contribution is 0 in best-N). Stableford: legPar always 0 →
      // legTotal collapses to absolute leg points = team points on this nine
      // + blind-draw points on this nine.
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
        for (const hn of holes) {
          const bd = result.blindDrawPerHole[hn];
          if (bd == null) continue;
          scoreSum += bd;
          any = true;
        }
        return any ? scoreSum - parSum : null;
      }

      const requiredIds = teamPlayers.map((rp: any) => rp.id as number);
      const thru = holesCompleteForTeam(scoresByRpId, requiredIds);

      const rosterDisplay = teamPlayers.map((rp: any) => {
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        return nameFor(rp.player_id as number, playerRow?.full_name);
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
        // Wave 1A: GHIN adjusted scores at 100% handicap (raw CH). Stroke index
        // is null for any hole missing tee data → the helper passes that hole's
        // actual score through (no fabricated cap).
        const strokeIndexes: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
          playerHoles.find(h => h.holeNumber === i + 1)?.strokeIndex ?? null
        );
        const adjScores = computeAdjustedHoleScores(scores, par, strokeIndexes, rp.course_handicap);

        // 2026-06-09: per-hole stroke dots from the allowance-adjusted playing CH
        // (the engine's scoring input) + each hole's stroke index. Holes missing
        // tee data → 0 dots.
        const playingCH = getPlayingCourseHandicap(rp.course_handicap, cfg);
        const strokeAllocation: number[] = strokeIndexes.map(si =>
          si == null ? 0 : getHandicapStrokes(playingCH, si),
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
        const displayName = nameFor(rp.player_id as number, playerRow?.full_name);

        const netTotal = isStableford ? netValue : netTotalStrokes;

        return {
          rpId: rp.id as number,
          playerId: rp.player_id as number,
          displayName,
          grossTotal,
          netValue,
          netTotal,
          // Flights S3: net STROKES is the engine's format-agnostic netTotal,
          // regardless of the display `netTotal` above.
          netStrokes: netTotalStrokes,
          holesPlayed,
          scores,
          par,
          adjScores,
          strokeAllocation,
          droppedAfterHole: rp.dropped_after_hole ?? null,
          courseHandicap: rp.course_handicap ?? null,
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
          const drawnPlayerName = drawnPlayerRow?.full_name
            ? nameFor(drawnPlayerId, drawnPlayerRow.full_name)
            : (lookup?.displayName ?? "?");
          const drawnScoresMap = lookup ? (scoresByRpId[lookup.rpId] || {}) : {};
          const drawnPlayerScores: (number | null)[] = Array.from(
            { length: 18 },
            (_, i) => drawnScoresMap[i + 1] ?? null,
          );
          const holeRangeStart = bd.hole_range_start as number;
          const holeRangeEnd = bd.hole_range_end as number;

          const drawnPlayerPar: number[] = (() => {
            const drawnHoles = lookup ? (holesByTee[lookup.teeId] || []) : [];
            return Array.from({ length: 18 }, (_, i) =>
              drawnHoles.find(h => h.holeNumber === i + 1)?.par ?? 4
            );
          })();

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
            drawnPlayerPar,
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
        flightId,
        flightName,
      };
    });
  }

  // ── Orchestrate per flight, in sort_order ───────────────────────────────────
  const flightSections: FlightSection[] = [];
  for (const flight of flights) {
    const fFmt = (flight.format ?? null) as Format | null;
    const fCfg = (flight.format_config ?? null) as FormatConfig | null;
    if (!fFmt || !fCfg) continue; // unchosen flight (with or without teams) → no section

    const subset: Record<number, any[]> = {};
    for (const [tnStr, players] of Object.entries(teamMap)) {
      const tn = parseInt(tnStr);
      if (teamFlightMap.get(tn)?.id === flight.id) subset[tn] = players;
    }
    if (Object.keys(subset).length === 0) continue; // empty flight → no section

    const rows = isTeamCardFormat(fFmt)
      ? buildTeamCardTeamRows(subset, fFmt, flight.id, flight.name)
      : buildIndividualTeamRows(subset, fFmt, fCfg, flight.id, flight.name);

    flightSections.push({
      flightId: flight.id,
      flightName: flight.name,
      format: fFmt,
      formatConfig: fCfg,
      formatLocked: flight.format_locked_at != null,
      teams: rankAndFormatTeams(rows, fFmt),
    });
  }

  const teams = flightSections.flatMap(s => s.teams);
  const maxThru = teams.reduce((m, t) => Math.max(m, t.thru), 0);

  // ── Round-wide Individual Rankings (canonical order) ────────────────────────
  // Only non-team-card flights contribute (team-card roster rows have no
  // individual scores). Mode: one format → today's per-format behavior; 2+
  // DIFFERING individual formats → rank everyone by net strokes.
  const indivSections = flightSections.filter(s => !isTeamCardFormat(s.format));
  const distinctIndivFormats = new Set(indivSections.map(s => s.format));
  const individualRankingsMode: IndividualRankingsMode =
    distinctIndivFormats.size >= 2
      ? "net_strokes"
      : distinctIndivFormats.size === 1 && isStablefordFormat([...distinctIndivFormats][0])
        ? "stableford"
        : "best_n";

  // Flatten in section order → ranked-team order → roster order. For single-
  // flight rounds this matches the pre-flights view's `teams.flatMap(...)`
  // exactly, so the order is byte-identical.
  const indivRaw: IndividualRankingRow[] = [];
  for (const section of indivSections) {
    const sectionStableford = isStablefordFormat(section.format);
    for (const team of section.teams) {
      for (const p of team.players) {
        if (p.holesPlayed > 0 && p.droppedAfterHole == null) {
          indivRaw.push({
            rpId: p.rpId,
            playerId: p.playerId,
            displayName: p.displayName,
            teamName: team.name,
            flightId: section.flightId,
            grossTotal: p.grossTotal,
            netStrokes: p.netStrokes,
            points: sectionStableford ? p.netValue : 0,
            rank: 0, // assigned below
          });
        }
      }
    }
  }

  const sortValue = (r: IndividualRankingRow): number =>
    individualRankingsMode === "stableford" ? r.points : r.netStrokes;
  const decorated = indivRaw.map((row, idx) => ({ row, idx }));
  decorated.sort((a, b) => {
    const diff = individualRankingsMode === "stableford"
      ? b.row.points - a.row.points // points: higher wins
      : a.row.netStrokes - b.row.netStrokes; // strokes: lower wins
    if (diff !== 0) return diff;
    return a.idx - b.idx;
  });
  const individualRankings: IndividualRankingRow[] = [];
  for (let i = 0; i < decorated.length; i++) {
    const row = decorated[i].row;
    const prev = i > 0 ? decorated[i - 1].row : null;
    const isTieWithPrev = prev !== null && sortValue(prev) === sortValue(row);
    const rank = isTieWithPrev ? individualRankings[i - 1].rank : i + 1;
    individualRankings.push({ ...row, rank });
  }

  return {
    status: "ok",
    data: {
      playedOn: round.played_on,
      isComplete: round.is_complete,
      roundId,
      format,
      formatConfig,
      formatLocked: formatLockedAt != null,
      teams,
      flightSections,
      individualRankings,
      individualRankingsMode,
      maxThru,
    },
  };
}
