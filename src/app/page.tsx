"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type TeamInfo = {
  number: number;
  players: string[];
};

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  isYesterday: boolean;
  teams: TeamInfo[];
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

      // Load today's rounds + yesterday's incomplete rounds
      const { data: rounds } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete")
        .or(`played_on.eq.${today},and(played_on.eq.${yesterday},is_complete.eq.false)`)
        .order("played_on", { ascending: false });

      if (rounds) {
        const roundsWithTeams = await Promise.all(
          rounds.map(async (round) => {
            const { data: rps } = await supabase
              .from("round_players")
              .select("team_number, players ( display_name, full_name )")
              .eq("round_id", round.id);

            const teamMap: Record<number, string[]> = {};
            rps?.forEach((rp: any) => {
              const tNum = rp.team_number;
              if (!tNum) return;
              if (!teamMap[tNum]) teamMap[tNum] = [];
              teamMap[tNum].push(rp.players?.display_name || rp.players?.full_name || "?");
            });

            const teamList: TeamInfo[] = Object.entries(teamMap)
              .map(([num, players]) => ({ number: parseInt(num), players }))
              .sort((a, b) => a.number - b.number);

            return {
              ...round,
              isYesterday: round.played_on === yesterday,
              teams: teamList,
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
          {recentRounds.map((round) => (
            <div key={round.id} style={{ background: "white", borderRadius: "14px", border: "1px solid rgba(0,0,0,0.07)", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{formatDate(round.played_on)}</span>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                  padding: "3px 10px", borderRadius: "999px",
                  background: round.is_complete ? "#dcfce7" : round.isYesterday ? "#fef3c7" : "#eff6ff",
                  color: round.is_complete ? "#166534" : round.isYesterday ? "#92400e" : "#1d4ed8",
                }}>
                  {round.is_complete ? "Complete" : round.isYesterday ? "Unfinished" : "In Progress"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                {round.teams.map((team) => (
                  <Link
                    key={team.number}
                    href={`/round/${round.id}/scorecard?team=${team.number}`}
                    style={{ display: "flex", flexDirection: "column", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "10px", textDecoration: "none", border: "1px solid #f1f5f9" }}
                  >
                    <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#0c3057", marginBottom: "3px" }}>TEAM {team.number}</span>
                    <span style={{ fontSize: "0.78rem", color: "#64748b", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {team.players.join(", ")}
                    </span>
                  </Link>
                ))}
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
          ))}
        </div>
      )}
    </div>
  );
}
