"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

interface PlayerStats {
  player_id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
  rounds_played: number;
  total_gross: number;
  total_net: number;
  best_gross: number;
  worst_gross: number;
  avg_gross: number;
  avg_net: number;
}

function getHandicapStrokes(courseHandicap: number | null, strokeIndex: number): number {
  if (courseHandicap === null || courseHandicap === 0) return 0;
  const ch = Math.abs(courseHandicap);
  const fullStrokes = Math.floor(ch / 18);
  const remainder = ch % 18;
  let strokes = fullStrokes + (strokeIndex <= remainder ? 1 : 0);
  if (courseHandicap < 0) strokes = -strokes;
  return strokes;
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<"gross" | "net">("gross");

  useEffect(() => {
    async function load() {
      // Check if leaderboard is enabled
      const { data: setting } = await supabase
        .from("league_settings")
        .select("value")
        .eq("key", "show_leaderboard")
        .single();

      if (setting && setting.value === "false") {
        setEnabled(false);
        setLoading(false);
        return;
      }

      // Get all completed rounds
      const { data: rounds } = await supabase
        .from("rounds")
        .select("id")
        .eq("is_complete", true);

      if (!rounds || rounds.length === 0) {
        setLoading(false);
        return;
      }

      const roundIds = rounds.map(r => r.id);

      // Get all round_players for completed rounds
      const { data: rps } = await supabase
        .from("round_players")
        .select(`
          id, player_id, tee_id, course_handicap, round_id,
          players ( full_name, display_name, handicap_index )
        `)
        .in("round_id", roundIds);

      if (!rps || rps.length === 0) {
        setLoading(false);
        return;
      }

      // Get all scores
      const rpIds = rps.map((r: any) => r.id);
      const { data: allScores } = await supabase
        .from("scores")
        .select("round_player_id, hole_number, strokes")
        .in("round_player_id", rpIds);

      // Get hole data for net calculations
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

      // Build score map
      const scoreMap: Record<number, Record<number, number>> = {};
      allScores?.forEach(s => {
        if (!scoreMap[s.round_player_id]) scoreMap[s.round_player_id] = {};
        scoreMap[s.round_player_id][s.hole_number] = s.strokes;
      });

      // Aggregate per player
      const playerMap: Record<number, {
        full_name: string;
        display_name: string | null;
        handicap_index: number | null;
        rounds: { gross: number; net: number }[];
      }> = {};

      rps.forEach((rp: any) => {
        const playerScores = scoreMap[rp.id];
        if (!playerScores || Object.keys(playerScores).length < 9) return; // skip rounds with fewer than 9 holes

        const grossTotal = Object.values(playerScores).reduce((sum: number, s: any) => sum + s, 0);

        // Calculate net
        let netTotal = 0;
        const holes = holesMap[rp.tee_id] || [];
        Object.entries(playerScores).forEach(([holeNum, strokes]) => {
          const holeInfo = holes.find((h: any) => h.hole_number === parseInt(holeNum));
          const hcpStrokes = holeInfo ? getHandicapStrokes(rp.course_handicap, holeInfo.stroke_index) : 0;
          netTotal += (strokes as number) - hcpStrokes;
        });

        if (!playerMap[rp.player_id]) {
          playerMap[rp.player_id] = {
            full_name: rp.players?.full_name || "?",
            display_name: rp.players?.display_name,
            handicap_index: rp.players?.handicap_index,
            rounds: [],
          };
        }
        playerMap[rp.player_id].rounds.push({ gross: grossTotal, net: netTotal });
      });

      // Build stats
      const stats: PlayerStats[] = Object.entries(playerMap)
        .filter(([_, data]) => data.rounds.length > 0)
        .map(([playerId, data]) => {
          const grosses = data.rounds.map(r => r.gross);
          const nets = data.rounds.map(r => r.net);
          const totalGross = grosses.reduce((a, b) => a + b, 0);
          const totalNet = nets.reduce((a, b) => a + b, 0);

          return {
            player_id: parseInt(playerId),
            full_name: data.full_name,
            display_name: data.display_name,
            handicap_index: data.handicap_index,
            rounds_played: data.rounds.length,
            total_gross: totalGross,
            total_net: totalNet,
            best_gross: Math.min(...grosses),
            worst_gross: Math.max(...grosses),
            avg_gross: Math.round((totalGross / data.rounds.length) * 10) / 10,
            avg_net: Math.round((totalNet / data.rounds.length) * 10) / 10,
          };
        });

      // Sort by average gross by default
      stats.sort((a, b) => a.avg_gross - b.avg_gross);
      setPlayers(stats);
      setLoading(false);
    }
    load();
  }, []);

  const sortedPlayers = [...players].sort((a, b) =>
    viewMode === "gross" ? a.avg_gross - b.avg_gross : a.avg_net - b.avg_net
  );

  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading...</div>;
  }

  if (!enabled) {
    return (
      <div style={{ padding: "40px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", textAlign: "center" }}>
        <div style={{
          background: "white", borderRadius: "20px", padding: "40px 24px",
          border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "12px" }}>⛳</div>
          <h2 style={{ color: "#166534", fontWeight: 900, marginBottom: "8px" }}>Leaderboard is Off</h2>
          <p style={{ color: "#64748b", fontSize: "0.9rem", lineHeight: 1.5 }}>
            The league admin has turned off the leaderboard for now. Check back later!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "140px" }}>
      <h2 style={{ color: "#166534", fontWeight: 900, fontSize: "1.4rem", marginBottom: "4px" }}>
        Leaderboard
      </h2>
      <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "20px" }}>
        {players.length} players • Completed rounds only
      </p>

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

      {sortedPlayers.length === 0 ? (
        <div style={{
          background: "white", borderRadius: "16px", padding: "40px",
          textAlign: "center", border: "1px solid #e2e8f0",
        }}>
          <p style={{ color: "#94a3b8", fontWeight: 600 }}>No completed rounds yet</p>
          <p style={{ color: "#cbd5e1", fontSize: "0.85rem" }}>
            Scores will appear here after rounds are finalized
          </p>
        </div>
      ) : (
        <div style={{
          background: "white", borderRadius: "16px",
          border: "1px solid #e2e8f0", overflow: "hidden",
        }}>
          {sortedPlayers.map((p, idx) => {
            const avg = viewMode === "gross" ? p.avg_gross : p.avg_net;
            const isTop3 = idx < 3;
            const medals = ["🥇", "🥈", "🥉"];

            return (
              <Link
                key={p.player_id}
                href={`/player/${p.player_id}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px", textDecoration: "none",
                  borderBottom: idx < sortedPlayers.length - 1 ? "1px solid #f1f5f9" : "none",
                  background: idx === 0 ? "#f0fdf4" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  {/* Rank */}
                  <div style={{
                    width: "32px", textAlign: "center",
                    fontSize: isTop3 ? "1.2rem" : "0.85rem",
                    fontWeight: 800, color: isTop3 ? undefined : "#94a3b8",
                  }}>
                    {isTop3 ? medals[idx] : idx + 1}
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1e293b" }}>
                      {p.display_name || p.full_name}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                      {p.rounds_played} round{p.rounds_played !== 1 ? "s" : ""}
                      {p.handicap_index != null && ` • HCP ${p.handicap_index}`}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: "1.2rem", fontWeight: 900,
                    color: viewMode === "gross" ? "#166534" : "#1e40af",
                  }}>
                    {avg}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>
                    avg {viewMode} • best {p.best_gross}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}