"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { computeRoundResult } from "@/lib/scoring";
import type { HoleInfo, Format, FormatConfig } from "@/lib/scoring";
import { getScoringBasis } from "@/lib/format/helpers";
import { formatTeamTotal, FORMAT_LABELS } from "@/lib/format/copy";
import {
  rankTeams,
  holesCompleteForTeam,
  isStablefordFormat,
  type RankedTeam,
} from "@/lib/leaderboard/rank";

// ─── Types ──────────────────────────────────────────────────────────────────

type RoundRow = {
  id: number;
  played_on: string;
  format: Format | null;
  format_config: FormatConfig | null;
  format_locked_at: string | null;
  is_complete: boolean;
};

type TeamForBoard = {
  id: number; // team_number
  name: string;
  rosterDisplay: string;
  total: number;          // delta vs par for best-N; absolute points for Stableford
  rawTeamScore: number;   // engine teamScore (for color coding decisions)
  teamPar: number;        // engine teamParAtScored
  thru: number;           // count of holes complete for the whole team roster
};

type LeaderboardState =
  | { kind: "loading" }
  | { kind: "no_round"; today: string }
  | { kind: "no_format"; today: string }
  | { kind: "live"; round: RoundRow; teams: Array<RankedTeam<TeamForBoard>> }
  | { kind: "complete"; round: RoundRow; teams: Array<RankedTeam<TeamForBoard>> };

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function prettyDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const C = {
  navy: "#0c3057",
  navyLight: "#0f4a7a",
  bgWarm: "#f5f4f0",
  cardBg: "#ffffff",
  cardBorder: "#e2e0db",
  textPrimary: "#1a1a1a",
  textSecondary: "#6b6b6b",
  textMuted: "#9a9a9a",
  accentBlue: "#2563eb",
  accentBlueBg: "#eef2ff",
  scoreUnder: "#15803d",
  scoreOver: "#b91c1c",
  scoreEven: "#1a1a1a",
  goldFirst: "#d4a017",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [state, setState] = useState<LeaderboardState>({ kind: "loading" });

  const load = useCallback(async () => {
    const today = todayStr();

    const { data: rounds } = await supabase
      .from("rounds")
      .select("id, played_on, format, format_config, format_locked_at, is_complete")
      .eq("played_on", today)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!rounds || rounds.length === 0) {
      setState({ kind: "no_round", today });
      return;
    }

    const round = rounds[0] as RoundRow;

    if (round.format === null || round.format_config === null) {
      setState({ kind: "no_format", today });
      return;
    }

    // Round players + nested player display name
    const { data: rps } = await supabase
      .from("round_players")
      .select(`id, team_number, course_handicap, tee_id,
               players ( display_name, full_name )`)
      .eq("round_id", round.id)
      .gt("team_number", 0)
      .order("team_number");

    if (!rps || rps.length === 0) {
      // Round exists with format but no team_players assigned yet — show
      // the live shell with no rows. Treat as "live" state with empty teams.
      const baseState = round.is_complete ? "complete" : "live";
      setState({ kind: baseState, round, teams: [] });
      return;
    }

    // Scores
    const rpIds = rps.map((r: any) => r.id);
    const { data: allScores } = await supabase
      .from("scores")
      .select("round_player_id, hole_number, strokes")
      .in("round_player_id", rpIds);

    const scoresByRpId: Record<number, Record<number, number>> = {};
    allScores?.forEach((s: any) => {
      if (!scoresByRpId[s.round_player_id]) scoresByRpId[s.round_player_id] = {};
      scoresByRpId[s.round_player_id][s.hole_number] = s.strokes;
    });

    // Hole metadata per tee (engine needs par + stroke_index)
    const teeIds = [...new Set(rps.map((r: any) => r.tee_id).filter(Boolean))] as number[];
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

    // Group by team_number
    const teamMap: Record<number, any[]> = {};
    rps.forEach((rp: any) => {
      const tn = rp.team_number;
      if (!teamMap[tn]) teamMap[tn] = [];
      teamMap[tn].push(rp);
    });

    const useGross = getScoringBasis(round.format_config) === "gross";

    const teams: TeamForBoard[] = Object.entries(teamMap).map(([teamNum, teamPlayers]) => {
      const firstTeeId = teamPlayers[0]?.tee_id;
      const holes = holesByTee[firstTeeId] || [];
      const playersForEngine = teamPlayers.map((rp: any) => ({
        playerId: String(rp.id),
        courseHandicap: useGross ? 0 : rp.course_handicap,
        grossScores: scoresByRpId[rp.id] || {},
      }));

      const result = computeRoundResult({
        format: round.format!,
        formatConfig: { ...round.format_config!, basis: useGross ? "gross" : "net" },
        holes,
        players: playersForEngine,
      });

      const rawTeamScore = result.teamScore ?? 0;
      const teamPar = result.teamParAtScored;
      // Mirrors the scorecard pill: for best-N teamScore - teamPar is the
      // delta vs par (the helper's stroke-mode input). For Stableford the
      // engine returns teamPar=0, so the same expression collapses to the
      // absolute points total (the helper's Stableford-mode input).
      const total = rawTeamScore - teamPar;

      // "thru N" — array-vs-object pattern guard mirrors home page approach
      // for nested players(...) result; here we only need ids.
      const requiredIds = teamPlayers.map((rp: any) => rp.id as number);
      const thru = holesCompleteForTeam(scoresByRpId, requiredIds);

      const rosterDisplay = teamPlayers.map((rp: any) => {
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        return playerRow?.display_name || playerRow?.full_name || "?";
      }).join(" · ");

      return {
        id: parseInt(teamNum),
        name: `Team ${teamNum}`,
        rosterDisplay,
        total,
        rawTeamScore,
        teamPar,
        thru,
      };
    });

    const ranked = rankTeams(teams, round.format!);
    setState({
      kind: round.is_complete ? "complete" : "live",
      round,
      teams: ranked,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  return <LeaderboardView state={state} />;
}

// ─── View ───────────────────────────────────────────────────────────────────

function LeaderboardView({ state }: { state: LeaderboardState }) {
  if (state.kind === "loading") {
    return <div style={{ padding: 40, textAlign: "center", color: C.textSecondary, fontFamily: C.font }}>Loading…</div>;
  }

  // State subtitle ("Round in progress" / "Round complete" / "No round today").
  // Rendered inline below the global app-header so the global layout's
  // permanent "Semiahmoo Golf & Country Club" subtitle stays untouched.
  const subtitle = (() => {
    if (state.kind === "no_round") return "No round today";
    if (state.kind === "no_format") return "Round in progress";
    if (state.kind === "complete") return "Round complete";
    return "Round in progress";
  })();

  const dateStr = state.kind === "no_round" || state.kind === "no_format"
    ? state.today
    : state.round.played_on;

  const format: Format | null =
    state.kind === "live" || state.kind === "complete" ? state.round.format : null;
  const formatLabel = format ? FORMAT_LABELS[format].title : null;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", fontFamily: C.font, paddingBottom: 140 }}>

      {/* In-page navy state strip — mockup app-header equivalent */}
      <div style={{
        background: C.navy, color: "white",
        padding: "12px 16px",
      }}>
        <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: "0.3px" }}>
          Semiahmoo · {subtitle}
        </div>
      </div>

      {/* Round meta header */}
      <div style={{
        background: "white",
        borderBottom: `1px solid ${C.cardBorder}`,
        padding: 16, textAlign: "center",
      }}>
        <div style={{
          fontSize: 12, color: C.textSecondary,
          textTransform: "uppercase", letterSpacing: "0.5px",
          marginBottom: 6,
        }}>
          Today&apos;s Round
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
          {prettyDate(dateStr)}
        </div>
        {formatLabel && (
          <div style={{
            display: "inline-block", marginTop: 8,
            background: C.accentBlueBg, color: C.accentBlue,
            fontSize: 11, fontWeight: 600,
            padding: "4px 10px", borderRadius: 12,
            letterSpacing: "0.3px",
          }}>
            {formatLabel}
          </div>
        )}
      </div>

      {/* Body */}
      {state.kind === "no_round" || state.kind === "no_format" ? (
        <EmptyState />
      ) : (
        <Leaderboard state={state} />
      )}
    </div>
  );
}

function Leaderboard({ state }: { state: Extract<LeaderboardState, { kind: "live" | "complete" }> }) {
  const isComplete = state.kind === "complete";
  const isStableford = isStablefordFormat(state.round.format!);

  if (state.teams.length === 0) {
    // Round exists with format chosen but no teams assigned yet — show empty
    // state copy that nudges admins to /thomas-admin. Falls through to the
    // shared EmptyState; subtitle still says "Round in progress".
    return <EmptyState />;
  }

  return (
    <div style={{ background: C.bgWarm, padding: "16px 12px" }}>
      {state.teams.map(team => (
        <Link
          key={team.id}
          href={`/round/${state.round.id}/summary`}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div
            style={{
              background: "white",
              border: `1px solid ${C.cardBorder}`,
              borderRadius: 12,
              padding: "14px 14px 14px 10px",
              marginBottom: 10,
              display: "flex", alignItems: "center", gap: 12,
              cursor: "pointer",
              transition: "transform 0.05s, box-shadow 0.05s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 3px 8px rgba(0,0,0,0.08)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "";
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
              }}>
                {team.rosterDisplay}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 72 }}>
              <ScoreLabel
                total={team.total}
                format={state.round.format!}
                isStableford={isStableford}
              />
              <div style={{
                fontSize: 11,
                color: isComplete ? C.navy : C.textMuted,
                fontWeight: isComplete ? 700 : 500,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                marginTop: 4,
              }}>
                {isComplete ? "Final" : `thru ${team.thru}`}
              </div>
            </div>
          </div>
        </Link>
      ))}
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

function ScoreLabel({
  total,
  format,
  isStableford,
}: {
  total: number;
  format: Format;
  isStableford: boolean;
}) {
  // Color rules from spec:
  //   - Stableford-family (any sign): blue
  //   - Best-N negative (under par): green
  //   - Best-N positive (over par): red
  //   - Best-N zero (E): black
  let color = C.scoreEven;
  if (isStableford) color = C.accentBlue;
  else if (total < 0) color = C.scoreUnder;
  else if (total > 0) color = C.scoreOver;

  return (
    <div style={{
      fontSize: 24, fontWeight: 700, lineHeight: 1,
      color,
    }}>
      {formatTeamTotal(total, format)}
    </div>
  );
}

function EmptyState() {
  return (
    <>
      <div style={{
        background: "white",
        border: `2px dashed ${C.cardBorder}`,
        borderRadius: 12,
        padding: "40px 20px", textAlign: "center",
        margin: 16,
      }}>
        <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>⛳</div>
        <div style={{
          fontSize: 16, fontWeight: 600,
          color: C.textPrimary, marginBottom: 6,
        }}>
          No round started yet
        </div>
        <div style={{
          fontSize: 13, color: C.textSecondary,
          lineHeight: 1.4,
        }}>
          Once today&apos;s round begins and a format is picked,
          team standings will show here.
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <Link href="/season" style={{
          fontSize: 13, color: C.navy,
          textDecoration: "none", fontWeight: 600,
        }}>
          View season stats →
        </Link>
      </div>
    </>
  );
}
