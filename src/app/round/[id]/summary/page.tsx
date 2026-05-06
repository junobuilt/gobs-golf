"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import Link from "next/link";
import { computeRoundResult, computePlayerRoundTotal } from "@/lib/scoring";
import type { HoleInfo } from "@/lib/scoring";

interface PlayerResult {
  display_name: string;
  course_handicap: number | null;
  tee_color: string;
  gross_total: number;
  net_total: number;
  holes_played: number;
}

interface TeamResult {
  team_number: number;
  players: PlayerResult[];
  team_gross: number;
  team_net: number;
  holes_scored: number;
}

export default function RoundSummaryPage() {
  const params = useParams();
  const roundId = params.id as string;

  const [roundDate, setRoundDate] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [teams, setTeams] = useState<TeamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"gross" | "net">("gross");

  useEffect(() => {
    async function load() {
      // Get round info
      const { data: round } = await supabase
        .from("rounds")
        .select("played_on, is_complete")
        .eq("id", roundId)
        .single();

      if (round) {
        setRoundDate(round.played_on);
        setIsComplete(round.is_complete);
      }

      // Get all players in this round with their data
      const { data: rps } = await supabase
        .from("round_players")
        .select(`
          id, team_number, tee_id, course_handicap,
          players ( full_name, display_name, handicap_index ),
          tees ( color )
        `)
        .eq("round_id", roundId)
        .order("team_number");

      if (!rps || rps.length === 0) {
        setLoading(false);
        return;
      }

      // Get all scores for this round
      const rpIds = rps.map((r: any) => r.id);
      const { data: allScores } = await supabase
        .from("scores")
        .select("round_player_id, hole_number, strokes")
        .in("round_player_id", rpIds);

      // Build score map: rpId -> { holeNumber -> strokes }
      const scoreMap: Record<number, Record<number, number>> = {};
      allScores?.forEach(s => {
        if (!scoreMap[s.round_player_id]) scoreMap[s.round_player_id] = {};
        scoreMap[s.round_player_id][s.hole_number] = s.strokes;
      });

      // Get hole data for each tee (for net scoring)
      const uniqueTeeIds = [...new Set(rps.map((r: any) => r.tee_id).filter(Boolean))] as number[];
      const holesMap: Record<number, any[]> = {};
      for (const teeId of uniqueTeeIds) {
        const { data: h } = await supabase
          .from("holes")
          .select("hole_number, par, stroke_index")
          .eq("tee_id", teeId)
          .order("hole_number");
        holesMap[teeId] = h || [];
      }

      // Group by team
      const teamMap: Record<number, any[]> = {};
      rps.forEach((rp: any) => {
        const tn = rp.team_number || 0;
        if (!teamMap[tn]) teamMap[tn] = [];
        teamMap[tn].push(rp);
      });

      // Calculate team scores
      const teamResults: TeamResult[] = Object.entries(teamMap).map(([teamNum, teamPlayers]) => {
        // Per-tee hole metadata in engine shape
        const holesByTeeForEngine: Record<number, HoleInfo[]> = {};
        for (const teeId of Object.keys(holesMap)) {
          holesByTeeForEngine[Number(teeId)] = (holesMap[Number(teeId)] || []).map((h: any) => ({
            holeNumber: h.hole_number,
            par: h.par,
            strokeIndex: h.stroke_index,
          }));
        }

        // Per-player gross/net totals via engine helper
        const playerResults: PlayerResult[] = teamPlayers.map((rp: any) => {
          const playerScores = scoreMap[rp.id] || {};
          const holes = holesByTeeForEngine[rp.tee_id] || [];
          const { gross, net, holesPlayed } = computePlayerRoundTotal(
            playerScores,
            rp.course_handicap,
            holes,
          );
          return {
            display_name: rp.players?.display_name || rp.players?.full_name || "?",
            course_handicap: rp.course_handicap,
            tee_color: (rp as any).tees?.color || "?",
            gross_total: gross,
            net_total: net,
            holes_played: holesPlayed,
          };
        });

        // Team-format best-2 totals via engine. Use first player's tee for the
        // hole metadata (par is constant across tees; stroke_index per-tee is
        // applied per-player inside the engine via courseHandicap mapping).
        const firstTee = teamPlayers[0]?.tee_id;
        const holes = holesByTeeForEngine[firstTee] || [];
        const playersForEngine = teamPlayers.map((rp: any) => ({
          playerId: String(rp.id),
          courseHandicap: rp.course_handicap,
          grossScores: scoreMap[rp.id] || {},
        }));

        const grossResult = computeRoundResult({
          format: "2_ball",
          formatConfig: { basis: "gross", best_n: 2, override_holes: [] },
          holes,
          players: playersForEngine,
        });
        const netResult = computeRoundResult({
          format: "2_ball",
          formatConfig: { basis: "net", best_n: 2, override_holes: [] },
          holes,
          players: playersForEngine,
        });

        return {
          team_number: parseInt(teamNum),
          players: playerResults,
          team_gross: grossResult.teamScore ?? 0,
          team_net: netResult.teamScore ?? 0,
          holes_scored: grossResult.holesScored,
        };
      });

      // Sort by the active view mode
      teamResults.sort((a, b) => a.team_gross - b.team_gross);
      setTeams(teamResults);
      setLoading(false);
    }
    load();
  }, [roundId]);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  const sortedTeams = [...teams].sort((a, b) =>
    viewMode === "gross" ? a.team_gross - b.team_gross : a.team_net - b.team_net
  );

  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading Summary...</div>;
  }

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "140px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <Link href="/" style={{ fontSize: "0.8rem", color: "#166534", textDecoration: "none" }}>← Back to Home</Link>
        <h2 style={{ color: "#166534", fontWeight: 900, fontSize: "1.5rem", marginTop: "8px", marginBottom: "4px" }}>
          Round Summary
        </h2>
        <p style={{ color: "#64748b", fontSize: "0.85rem" }}>
          {roundDate ? formatDate(roundDate) : ""}
        </p>
        <span style={{
          display: "inline-block", marginTop: "4px",
          fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase",
          color: isComplete ? "#166534" : "#ea580c",
          background: isComplete ? "#dcfce7" : "#fff7ed",
          padding: "4px 10px", borderRadius: "999px",
        }}>
          {isComplete ? "Round Complete" : "In Progress"}
        </span>
      </div>

      {/* Gross / Net toggle */}
      <div style={{
        display: "flex", background: "#f1f5f9", borderRadius: "10px",
        padding: "3px", marginBottom: "20px",
      }}>
        <button onClick={() => setViewMode("gross")} style={{
          flex: 1, padding: "10px", borderRadius: "8px", border: "none",
          fontWeight: 800, fontSize: "0.85rem", cursor: "pointer",
          background: viewMode === "gross" ? "#166534" : "transparent",
          color: viewMode === "gross" ? "white" : "#64748b",
        }}>
          Gross
        </button>
        <button onClick={() => setViewMode("net")} style={{
          flex: 1, padding: "10px", borderRadius: "8px", border: "none",
          fontWeight: 800, fontSize: "0.85rem", cursor: "pointer",
          background: viewMode === "net" ? "#1e40af" : "transparent",
          color: viewMode === "net" ? "white" : "#64748b",
        }}>
          Net
        </button>
      </div>

      {/* Team cards */}
      {sortedTeams.map((team, idx) => {
        const teamScore = viewMode === "gross" ? team.team_gross : team.team_net;
        const teamPar = team.holes_scored * 2 * 4; // rough estimate — 2 scores x par 4 avg
        // For proper par we'd need hole data, but this gives a reasonable sense

        return (
          <div key={team.team_number} style={{
            background: "white", borderRadius: "16px", border: "1px solid #e2e8f0",
            marginBottom: "14px", overflow: "hidden",
            boxShadow: idx === 0 ? "0 4px 12px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            {/* Team header */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 16px",
              background: idx === 0 ? (viewMode === "gross" ? "#166534" : "#1e40af") : "#0c3057",
              color: "white",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {idx === 0 && <span style={{ fontSize: "1.2rem" }}>🏆</span>}
                <div>
                  <div style={{ fontWeight: 900, fontSize: "1rem" }}>Team {team.team_number}</div>
                  <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>{team.holes_scored} holes scored</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 900 }}>{teamScore}</div>
                <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>
                  {viewMode === "gross" ? "Gross" : "Net"} (Best 2)
                </div>
              </div>
            </div>

            {/* Player rows */}
            {team.players.map((p, pi) => (
              <div key={pi} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 16px",
                borderBottom: pi < team.players.length - 1 ? "1px solid #f1f5f9" : "none",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{p.display_name}</div>
                  <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                    {p.tee_color} • CH: {p.course_handicap ?? "?"} • {p.holes_played} holes
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                    {viewMode === "gross" ? p.gross_total : p.net_total}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>
                    {viewMode === "gross" ? "gross" : "net"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {teams.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
          No team scores found for this round.
        </div>
      )}

      {/* Individual player rankings */}
      {(() => {
        const allPlayers = sortedTeams
          .filter(t => t.team_number > 0)
          .flatMap(t => t.players.map(p => ({ ...p, team_number: t.team_number })))
          .filter(p => p.holes_played > 0)
          .sort((a, b) => a.gross_total - b.gross_total);
        if (allPlayers.length === 0) return null;
        return (
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden", marginTop: "8px" }}>
            <div style={{ padding: "12px 16px", background: "#0c3057", color: "white" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>Individual Rankings</div>
              <div style={{ fontSize: "0.68rem", opacity: 0.7 }}>Sorted by gross score</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase" }}>#</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase" }}>Player</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase" }}>Team</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase" }}>Gross</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase" }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {allPlayers.map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: i === 0 ? "#0c3057" : "#94a3b8" }}>{i + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{p.display_name}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "#64748b" }}>{p.team_number}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>{p.gross_total}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#1e40af", fontWeight: 600 }}>{p.net_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}