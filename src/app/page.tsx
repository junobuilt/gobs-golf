"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase"; // Using your existing working client
import Link from "next/link";

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  teams: number[]; 
};

export default function HomePage() {
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // 1. Get player count
      const { count } = await supabase
        .from("players")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      setPlayerCount(count || 0);

      // 2. Get recent rounds
      const { data: rounds } = await supabase
        .from("rounds")
        .select("id, played_on, is_complete")
        .order("played_on", { ascending: false })
        .limit(5);

      if (rounds) {
        const roundsWithTeams = await Promise.all(
          rounds.map(async (round) => {
            const { data: rps } = await supabase
              .from("round_players")
              .select("team_number")
              .eq("round_id", round.id);
            
            const uniqueTeams = Array.from(new Set(rps?.map(r => r.team_number) || []))
              .filter(n => n !== null && n !== 0)
              .sort((a, b) => a - b);

            return { ...round, teams: uniqueTeams };
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

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg, #064e3b, #059669)', borderRadius: '16px', padding: '24px', color: 'white', marginBottom: '24px' }}>
        <h2 style={{ margin: 0 }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.8 }}>{playerCount} Players • Semiahmoo GCC</p>
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <Link href="/round/new" style={{ backgroundColor: '#fbbf24', color: '#78350f', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none' }}>+ New Round</Link>
            <Link href="/thomas-admin" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none' }}>Admin Dashboard</Link>
        </div>
      </div>

      <h3 style={{ color: '#064e3b' }}>Recent Rounds</h3>
      {loading ? <p>Loading...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {recentRounds.map((round) => (
            <div key={round.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>{formatDate(round.played_on)}</span>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: round.is_complete ? '#999' : '#059669' }}>
                  {round.is_complete ? 'Complete' : 'In Progress'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {round.teams.map((teamNum) => (
                  <Link key={teamNum} href={`/round/${round.id}/scorecard?team=${teamNum}`} style={{ textAlign: 'center', padding: '8px', backgroundColor: '#f1f5f9', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', color: '#2563eb', textDecoration: 'none' }}>
                    Team {teamNum}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}