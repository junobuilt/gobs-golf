"use client";

// C PR 3 — round summary rebuild (C4/C5/C6).
// All teams ranked via shared rankTeams helper, two-level drill-down:
// chevron on team → player rows, chevron on player → PlayerHoleGrid.
// Multi-expand at both levels.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";
import { computeRoundResult } from "@/lib/scoring";
import type { HoleInfo, Format, FormatConfig } from "@/lib/scoring";
import { getScoringBasis } from "@/lib/format/helpers";
import { formatTeamTotal } from "@/lib/format/copy";
import {
  rankTeams,
  holesCompleteForTeam,
  isStablefordFormat,
  type RankedTeam,
} from "@/lib/leaderboard/rank";
import FormatChip from "@/components/format/FormatChip";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";

const COURSE_NAME = "Semiahmoo Golf & Country Club";

const C = {
  navy: "#042C53",
  bgWarm: "#f5f4f0",
  bgEmphasis: "#faf8f0", // var(--cream) — 1st-place card header tint
  cardBg: "#ffffff",
  cardBorder: "#e2e0db",
  divider: "#e2e8f0",
  textPrimary: "#1a1a1a",
  textSecondary: "#6b6b6b",
  textMuted: "#9a9a9a",
  accentBlue: "#2563eb",
  scoreUnder: "#15803d",
  scoreOver: "#b91c1c",
  scoreEven: "#1a1a1a",
  goldFirst: "#d4a017",
  statusFinal: "#15803d",
  statusFinalBg: "#dcfce7",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

const F9 = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const B9 = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

type PlayerRow = {
  rpId: number;
  displayName: string;
  grossTotal: number;
  // For best-N: net delta vs par-of-played (signed). For Stableford: absolute points.
  netValue: number;
  holesPlayed: number;
  // 18-length arrays. scores: strokes or null. par: hole par (uses player tee).
  scores: (number | null)[];
  par: number[];
};

type TeamRow = {
  id: number; // team_number
  name: string;
  rosterDisplay: string;
  // For best-N: team delta vs teamPar (signed). For Stableford: absolute points.
  total: number;
  rawTeamScore: number;
  teamPar: number;
  thru: number;
  f9Total: number | null; // delta or absolute pts; null if no F9 hole has team score
  b9Total: number | null;
  players: PlayerRow[];
};

type LoadedState =
  | { kind: "loading" }
  | { kind: "missing_round" }
  | { kind: "missing_format" }
  | {
      kind: "ready";
      playedOn: string;
      isComplete: boolean;
      roundId: number;
      format: Format;
      formatConfig: FormatConfig;
      formatLocked: boolean;
      teams: Array<RankedTeam<TeamRow>>;
      maxThru: number;
    };

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHeaderDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const md = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${weekday} · ${md}`;
}

function bestNDeltaColor(delta: number): string {
  if (delta === 0) return C.scoreEven;
  return delta < 0 ? C.scoreUnder : C.scoreOver;
}

function scoreColor(value: number, isStableford: boolean): string {
  if (isStableford) return C.accentBlue;
  return bestNDeltaColor(value);
}

// Format the F9 / B9 cell label given current format. Best-N: signed delta
// ("+3" / "−2" / "E"). Stableford: absolute pts ("18 pts").
function formatLegValue(value: number | null, format: Format): string {
  if (value == null) return "—";
  return formatTeamTotal(value, format);
}

// Best-N player Net display: signed delta vs par-of-played. Stableford: pts.
function formatPlayerNet(value: number, format: Format): string {
  const isStableford = isStablefordFormat(format);
  if (isStableford) {
    if (value < 0) return `−${-value} pts`;
    return `${value} pts`;
  }
  if (value === 0) return "E";
  if (value > 0) return `+${value}`;
  return `−${-value}`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RoundSummaryPage() {
  const params = useParams();
  const roundIdParam = params.id as string;
  const roundIdNum = Number(roundIdParam);

  const [state, setState] = useState<LoadedState>({ kind: "loading" });
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [expandedPlayers, setExpandedPlayers] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: round } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete, format, format_config, format_locked_at")
        .eq("id", roundIdNum)
        .single();

      if (cancelled) return;

      if (!round) {
        setState({ kind: "missing_round" });
        return;
      }

      const format = (round.format ?? null) as Format | null;
      const formatConfig = (round.format_config ?? null) as FormatConfig | null;
      if (!format || !formatConfig) {
        setState({ kind: "missing_format" });
        return;
      }

      const { data: rps } = await supabase
        .from("round_players")
        .select(`
          id, team_number, tee_id, course_handicap,
          players ( display_name, full_name )
        `)
        .eq("round_id", roundIdNum)
        .gt("team_number", 0)
        .order("team_number");

      if (cancelled) return;

      if (!rps || rps.length === 0) {
        setState({
          kind: "ready",
          playedOn: round.played_on,
          isComplete: round.is_complete,
          roundId: roundIdNum,
          format,
          formatConfig,
          formatLocked: round.format_locked_at != null,
          teams: [],
          maxThru: 0,
        });
        return;
      }

      const rpIds = (rps as any[]).map(r => r.id as number);
      const { data: allScores } = await supabase
        .from("scores")
        .select("round_player_id, hole_number, strokes")
        .in("round_player_id", rpIds);

      if (cancelled) return;

      const scoresByRpId: Record<number, Record<number, number>> = {};
      allScores?.forEach((s: any) => {
        if (!scoresByRpId[s.round_player_id]) scoresByRpId[s.round_player_id] = {};
        scoresByRpId[s.round_player_id][s.hole_number] = s.strokes;
      });

      // Hole metadata per tee
      const teeIds = [...new Set((rps as any[]).map(r => r.tee_id).filter(Boolean))] as number[];
      const holesByTee: Record<number, HoleInfo[]> = {};
      for (const teeId of teeIds) {
        const { data: h } = await supabase
          .from("holes")
          .select("hole_number, par, stroke_index")
          .eq("tee_id", teeId)
          .order("hole_number");
        if (cancelled) return;
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
        // Best-N: total is delta. Stableford: teamPar is 0, so total collapses
        // to absolute team points. Same convention as leaderboard PR 2.
        const total = rawTeamScore - teamPar;

        // F9 / B9 split from perHole. For best-N: legTotal = legScore - legPar.
        // For Stableford: legPar is always 0 so legTotal == legPoints.
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
            // Sum this player's per-hole Stableford points across the round.
            let pts = 0;
            for (const hole of result.perHole) {
              const pp = hole.result.perPlayer.find(p => p.playerId === String(rp.id));
              if (pp?.points != null) pts += pp.points;
            }
            netValue = pts;
          } else {
            // Best-N: signed delta vs par-of-played holes.
            let parOfPlayed = 0;
            for (let i = 0; i < 18; i++) {
              if (scores[i] != null) parOfPlayed += par[i];
            }
            netValue = netTotalStrokes - parOfPlayed;
          }

          const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
          const displayName =
            playerRow?.display_name || playerRow?.full_name || "?";

          return {
            rpId: rp.id as number,
            displayName,
            grossTotal,
            netValue,
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

      setState({
        kind: "ready",
        playedOn: round.played_on,
        isComplete: round.is_complete,
        roundId: roundIdNum,
        format,
        formatConfig,
        formatLocked: round.format_locked_at != null,
        teams: ranked,
        maxThru,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [roundIdNum]);

  function toggleTeam(teamNum: number) {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamNum)) next.delete(teamNum);
      else next.add(teamNum);
      return next;
    });
  }

  function togglePlayer(rpId: number) {
    setExpandedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(rpId)) next.delete(rpId);
      else next.add(rpId);
      return next;
    });
  }

  if (state.kind === "loading") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textSecondary, fontFamily: C.font }}>
        Loading…
      </div>
    );
  }

  if (state.kind === "missing_round") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textSecondary, fontFamily: C.font }}>
        Round not found.
      </div>
    );
  }

  if (state.kind === "missing_format") {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textSecondary, fontFamily: C.font }}>
        Format not yet picked for this round.
      </div>
    );
  }

  return (
    <SummaryView
      state={state}
      expandedTeams={expandedTeams}
      expandedPlayers={expandedPlayers}
      onToggleTeam={toggleTeam}
      onTogglePlayer={togglePlayer}
    />
  );
}

// ─── View ───────────────────────────────────────────────────────────────────

function SummaryView({
  state,
  expandedTeams,
  expandedPlayers,
  onToggleTeam,
  onTogglePlayer,
}: {
  state: Extract<LoadedState, { kind: "ready" }>;
  expandedTeams: Set<number>;
  expandedPlayers: Set<number>;
  onToggleTeam: (teamNum: number) => void;
  onTogglePlayer: (rpId: number) => void;
}) {
  return (
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: C.font, paddingBottom: 140 }}>
      <Header state={state} />
      <div style={{ background: C.bgWarm, padding: "16px 12px", minHeight: 200 }}>
        {state.teams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: C.textMuted }}>
            No team scores yet.
          </div>
        ) : (
          state.teams.map(team => (
            <TeamCard
              key={team.id}
              team={team}
              format={state.format}
              isFirst={team.rank === 1}
              isTeamExpanded={expandedTeams.has(team.id)}
              expandedPlayers={expandedPlayers}
              onToggleTeam={onToggleTeam}
              onTogglePlayer={onTogglePlayer}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Header({ state }: { state: Extract<LoadedState, { kind: "ready" }> }) {
  const dateLabel = formatHeaderDate(state.playedOn);
  return (
    <div style={{
      background: "white",
      borderBottom: `1px solid ${C.cardBorder}`,
      padding: "16px",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
            <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>← Back</Link>
          </div>
          <div style={{
            fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6,
          }}>
            {dateLabel}
          </div>
          <div style={{ marginBottom: 8 }}>
            <FormatChip
              roundId={state.roundId}
              currentFormat={state.format}
              currentConfig={state.formatConfig}
              formatLocked={state.formatLocked}
            />
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {COURSE_NAME}
          </div>
        </div>
        <StatusTag isComplete={state.isComplete} maxThru={state.maxThru} />
      </div>
    </div>
  );
}

function StatusTag({ isComplete, maxThru }: { isComplete: boolean; maxThru: number }) {
  if (isComplete) {
    return (
      <span style={{
        background: C.statusFinalBg,
        color: C.statusFinal,
        fontSize: 11, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.4px",
        padding: "4px 10px", borderRadius: 999,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}>
        Final
      </span>
    );
  }
  return (
    <span style={{
      color: C.textSecondary,
      fontSize: 11, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.4px",
      padding: "4px 0",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      In progress · thru {maxThru}
    </span>
  );
}

function TeamCard({
  team,
  format,
  isFirst,
  isTeamExpanded,
  expandedPlayers,
  onToggleTeam,
  onTogglePlayer,
}: {
  team: RankedTeam<TeamRow>;
  format: Format;
  isFirst: boolean;
  isTeamExpanded: boolean;
  expandedPlayers: Set<number>;
  onToggleTeam: (teamNum: number) => void;
  onTogglePlayer: (rpId: number) => void;
}) {
  const isStableford = isStablefordFormat(format);
  const totalColor = scoreColor(team.total, isStableford);

  return (
    <div style={{
      background: "white",
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 12,
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => onToggleTeam(team.id)}
        aria-expanded={isTeamExpanded}
        aria-label={isTeamExpanded ? `Collapse ${team.name}` : `Expand ${team.name}`}
        style={{
          width: "100%",
          background: isFirst ? C.bgEmphasis : "white",
          border: "none",
          padding: "14px 14px 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <RankBadge rank={team.rank} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: C.textPrimary,
            marginBottom: 3,
          }}>
            {team.name}
          </div>
          <div style={{
            fontSize: 12, color: C.textSecondary,
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", lineHeight: 1.3,
            marginBottom: 4,
          }}>
            {team.rosterDisplay}
          </div>
          <div style={{
            fontSize: 11, color: C.textMuted,
            letterSpacing: "0.3px",
          }}>
            <span style={{ fontWeight: 600, color: C.textSecondary }}>F9</span>{" "}
            {formatLegValue(team.f9Total, format)}
            <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
            <span style={{ fontWeight: 600, color: C.textSecondary }}>B9</span>{" "}
            {formatLegValue(team.b9Total, format)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 64 }}>
          <div style={{
            fontSize: 24, fontWeight: 700, lineHeight: 1,
            color: totalColor,
          }}>
            {formatTeamTotal(team.total, format)}
          </div>
          <div style={{
            fontSize: 10, color: C.textMuted,
            textTransform: "uppercase", letterSpacing: "0.3px",
            marginTop: 4, fontWeight: 600,
          }}>
            {isStableford ? "Net pts" : "Net"}
          </div>
        </div>
        <Chevron expanded={isTeamExpanded} />
      </button>

      {isTeamExpanded && (
        <div style={{ borderTop: `1px solid ${C.divider}`, background: "white" }}>
          {team.players.map((player, idx) => (
            <PlayerSection
              key={player.rpId}
              player={player}
              format={format}
              expanded={expandedPlayers.has(player.rpId)}
              isLast={idx === team.players.length - 1}
              onToggle={() => onTogglePlayer(player.rpId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerSection({
  player,
  format,
  expanded,
  isLast,
  onToggle,
}: {
  player: PlayerRow;
  format: Format;
  expanded: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const isStableford = isStablefordFormat(format);
  const netColor = scoreColor(player.netValue, isStableford);

  return (
    <div style={{ borderBottom: isLast ? "none" : `1px solid ${C.divider}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${player.displayName}` : `Expand ${player.displayName}`}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {player.displayName}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: 10, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
            }}>
              Gross
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, color: C.textPrimary, lineHeight: 1.1,
            }}>
              {player.holesPlayed === 0 ? "—" : player.grossTotal}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 56 }}>
            <div style={{
              fontSize: 10, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: "0.3px", fontWeight: 600,
            }}>
              Net
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, color: netColor, lineHeight: 1.1,
            }}>
              {player.holesPlayed === 0 ? "—" : formatPlayerNet(player.netValue, format)}
            </div>
          </div>
        </div>
        <Chevron expanded={expanded} small />
      </button>

      {expanded && (
        <div style={{ padding: "0 14px 12px" }}>
          <PlayerHoleGrid
            scores={player.scores}
            par={player.par}
            showRunningTotal={false}
          />
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const isFirst = rank === 1;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: "50%",
      background: isFirst ? C.goldFirst : C.navy,
      color: "white",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: 17,
      flexShrink: 0,
    }}>
      {rank}
    </div>
  );
}

function Chevron({ expanded, small }: { expanded: boolean; small?: boolean }) {
  const size = small ? 14 : 16;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={C.textMuted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transform: expanded ? "rotate(180deg)" : "none",
        transition: "transform 0.15s",
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
