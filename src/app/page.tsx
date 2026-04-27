"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  player_count: number; 
  player_names: string;
};

export default function HomePage() {
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Get player count
      const { count } = await supabase
        .from("players")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      setPlayerCount(count || 0);

      // Get recent rounds with player counts
      const { data: rounds } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete")
        .order("played_on", { ascending: false })
        .limit(5);

      if (rounds && rounds.length > 0) {
        const roundsWithCounts = await Promise.all(
          rounds.map(async (round) => {
            const { data: rps } = await supabase
              .from("round_players")
              .select("players ( display_name, full_name )")
              .eq("round_id", round.id);
            const names = rps
              ? rps.map((rp: any) => rp.players?.display_name || rp.players?.full_name || "?").join(", ")
              : "";
            return {
              ...round,
              player_count: rps?.length || 0,
              player_names: names,
            };
          })
        );
        setRecentRounds(roundsWithCounts);
      }
      setLoading(false);
    }
    load();
  }, []);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="page-content">
      {/* Hero / quick start */}
      <div style={{
        background: "linear-gradient(135deg, var(--green-800), var(--green-600))",
        borderRadius: "var(--card-radius)",
        padding: "24px 20px",
        color: "var(--white)",
        marginBottom: "20px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute",
          top: "-20px",
          right: "-20px",
          width: "120px",
          height: "120px",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.06)",
        }} />
        <div style={{
          position: "absolute",
          bottom: "-30px",
          right: "40px",
          width: "80px",
          height: "80px",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.04)",
        }} />
        <h2 style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.5rem",
          marginBottom: "4px",
          fontWeight: 400,
        }}>
          Good Ole Boys
        </h2>
        <p style={{ opacity: 0.7, fontSize: "0.85rem", marginBottom: "16px" }}>
          {playerCount} players &bull; Semiahmoo GCC
        </p>
        <Link href="/round/new" className="btn btn-gold btn-large" style={{ position: "relative" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          Start New Round
        </Link>
      </div>

      {/* Recent Rounds */}
      <div className="flex-between mb-2">
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", color: "var(--green-900)" }}>
          Recent Rounds
        </h3>
      </div>

      {loading ? (
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      ) : recentRounds.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            <p style={{ fontWeight: 600, marginBottom: "4px" }}>No rounds yet</p>
            <p style={{ fontSize: "0.85rem" }}>
              Tap &ldquo;Start New Round&rdquo; to record your first scorecard
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          background: "var(--white)",
          borderRadius: "var(--card-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid rgba(0,0,0,0.04)",
        }}>
          {recentRounds.map((round) => (
            <Link
            key={round.id}
            href={`/round/${round.id}/scorecard`}
            className="player-row"
          >
            <div>
              <div className="player-name">{formatDate(round.played_on)}</div>
              <div className="player-meta">
                {round.player_names || `${round.player_count} players`}
              </div>
            </div>
            <div>
              {round.is_complete ? (
                <span className="badge badge-par">Complete</span>
              ) : (
                <span className="badge badge-birdie">In Progress</span>
              )}
            </div>
          </Link>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div className="mt-4">
        <Link href="/players" className="btn btn-secondary btn-large">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
          View All Players
        </Link>
      </div>
    </div>
  );
}