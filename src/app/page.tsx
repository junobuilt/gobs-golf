"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type TeamInfo = {
  number: number;
  players: string[];
  hasScores: boolean;
};

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  isYesterday: boolean;
  teams: TeamInfo[];
  hasAnyScores: boolean;
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export default function HomePage() {
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { count } = await supabase
        .from("players")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      setPlayerCount(count || 0);

      const today = todayStr();
      const yesterday = yesterdayStr();

      const { data: rounds } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete")
        .or(`played_on.eq.${today},and(played_on.eq.${yesterday},is_complete.eq.false)`)
        .order("played_on", { ascending: false });

      if (rounds) {
        const roundsWithTeams = await Promise.all(
          rounds.map(async (round) => {
            // Fetch round_players including id for score lookup
            const { data: rps } = await supabase
              .from("round_players")
              .select("id, team_number, players ( display_name, full_name )")
              .eq("round_id", round.id);

            // Get which round_player_ids have any scores
            const rpIds = rps?.map((rp: any) => rp.id) || [];
            const rpIdsWithScores = new Set<number>();
            if (rpIds.length > 0) {
              const { data: scoreData } = await supabase
                .from("scores")
                .select("round_player_id")
                .in("round_player_id", rpIds);
              scoreData?.forEach((s: any) => rpIdsWithScores.add(s.round_player_id));
            }

            // Build team map with per-team hasScores flag
            const teamMap: Record<number, { players: string[]; hasScores: boolean }> = {};
            rps?.forEach((rp: any) => {
              const tNum = rp.team_number;
              if (!tNum) return;
              if (!teamMap[tNum]) teamMap[tNum] = { players: [], hasScores: false };
              teamMap[tNum].players.push(rp.players?.display_name || rp.players?.full_name || "?");
              if (rpIdsWithScores.has(rp.id)) teamMap[tNum].hasScores = true;
            });

            const teamList: TeamInfo[] = Object.entries(teamMap)
              .map(([num, info]) => ({ number: parseInt(num), players: info.players, hasScores: info.hasScores }))
              .sort((a, b) => a.number - b.number);

            const hasAnyScores = teamList.some(t => t.hasScores);

            return {
              ...round,
              isYesterday: round.played_on === yesterday,
              teams: teamList,
              hasAnyScores,
            };
          })
        );
        setRecentRounds(roundsWithTeams);
      }
      setLoading(false);
    }
    load();
  }, []);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  const F = {
    font: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  };

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto", fontFamily: F.font, color: "#1e293b", paddingBottom: "140px" }}>

      <div style={{ background: "linear-gradient(135deg, #0c3057, #0f4a7a)", borderRadius: "16px", padding: "24px", color: "white", marginBottom: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.8, fontSize: "0.85rem", marginBottom: "20px", marginTop: "4px" }}>{playerCount} Players · Semiahmoo GCC</p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link href="/round/new" style={{ backgroundColor: "white", color: "#0c3057", padding: "10px 16px", borderRadius: "8px", fontWeight: 700, textDecoration: "none", fontSize: "0.85rem" }}>
            + Start a Scorecard
          </Link>
          <Link href="/thomas-admin" style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "white", padding: "10px 16px", borderRadius: "8px", fontWeight: 600, textDecoration: "none", fontSize: "0.85rem", border: "1px solid rgba(255,255,255,0.25)" }}>
            Admin
          </Link>
        </div>
      </div>

      <h3 style={{ color: "#0c3057", fontSize: "1rem", marginBottom: "14px", fontWeight: 700 }}>Today's Scorecards</h3>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>Loading…</div>
      ) : recentRounds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8", fontSize: "0.9rem" }}>
          No rounds today. Set one up in Admin.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {recentRounds.map((round) => {
            // Determine overall round status
            const status = round.is_complete ? "Complete"
              : round.isYesterday ? "Unfinished"
              : round.hasAnyScores ? "In Progress"
              : "Not Started";

            const statusBg = round.is_complete ? "#f1f5f9"
              : round.isYesterday ? "#fef3c7"
              : round.hasAnyScores ? "#dcfce7"
              : "#fef3c7";

            const statusColor = round.is_complete ? "#475569"
              : round.isYesterday ? "#92400e"
              : round.hasAnyScores ? "#166534"
              : "#92400e";

            return (
              <div key={round.id} style={{ background: "white", borderRadius: "14px", border: "1px solid rgba(0,0,0,0.07)", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{formatDate(round.played_on)}</span>
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                    padding: "3px 10px", borderRadius: "999px",
                    background: statusBg, color: statusColor,
                  }}>
                    {status}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                  {round.teams.map((team) => {
                    // Color-code each team card by its own score status
                    const teamBg = round.is_complete
                      ? "#f8fafc"
                      : team.hasScores
                      ? "#f0fdf4"
                      : "#fffbeb";

                    const teamBorder = round.is_complete
                      ? "#f1f5f9"
                      : team.hasScores
                      ? "#bbf7d0"
                      : "#fde68a";

                    const teamAccent = round.is_complete
                      ? "#94a3b8"
                      : team.hasScores
                      ? "#166534"
                      : "#92400e";

                    return (
                      <Link
                        key={team.number}
                        href={`/round/${round.id}/scorecard?team=${team.number}`}
                        style={{
                          display: "flex", flexDirection: "column", padding: "10px 12px",
                          backgroundColor: teamBg, borderRadius: "10px", textDecoration: "none",
                          border: `1px solid ${teamBorder}`,
                        }}
                      >
                        <span style={{ fontSize: "0.68rem", fontWeight: 800, color: teamAccent, marginBottom: "4px" }}>
                          TEAM {team.number}
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                          {team.players.map((name, i) => (
                            <span key={i} style={{ fontSize: "0.75rem", color: "#64748b" }}>{name}</span>
                          ))}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {round.is_complete && (
                  <Link href={`/round/${round.id}/summary`} style={{
                    display: "block", textAlign: "center", marginTop: "10px",
                    padding: "8px", borderRadius: "8px", background: "#f0fdf4",
                    color: "#166534", fontSize: "0.82rem", fontWeight: 700,
                    textDecoration: "none", border: "1px solid #bbf7d0",
                  }}>
                    View Summary →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
