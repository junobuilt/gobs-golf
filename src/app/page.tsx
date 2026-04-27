"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from "next/link";

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  teams: number[]; // We now track which teams exist in this round
};

export default function HomePage() {
  const supabase = createClientComponentClient();
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // 1. Get total active player count
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
            // Get unique team numbers for this specific round
            const { data: rps } = await supabase
              .from("round_players")
              .select("team_number")
              .eq("round_id", round.id);
            
            // Extract unique team numbers (e.g., [1, 2, 3])
            const uniqueTeams = Array.from(new Set(rps?.map(r => r.team_number) || [])).sort((a, b) => a - b);

            return {
              ...round,
              teams: uniqueTeams,
            };
          })
        );
        setRecentRounds(roundsWithTeams);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* Header Card */}
      <div style={{ background: 'linear-gradient(135deg, #064e3b, #059669)', borderRadius: '16px', padding: '24px', color: 'white', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.8, fontSize: '0.9rem' }}>{playerCount} Players • Semiahmoo GCC</p>
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <Link href="/round/new" style={{ backgroundColor: '#fbbf24', color: '#78350f', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem' }}>+ New Round</Link>
            <Link href="/thomas-admin" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem' }}>Admin Tools</Link>
        </div>
      </div>

      <h3 style={{ color: '#064e3b', marginBottom: '16px' }}>Recent Rounds</h3>

      {loading ? (
        <p>Loading rounds...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {recentRounds.map((round) => (
            <div key={round.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: '#111827' }}>{formatDate(round.played_on)}</span>
                <span style={{ fontSize: '0.7rem', backgroundColor: round.is_complete ? '#f3f4f6' : '#ecfdf5', color: round.is_complete ? '#6b7280' : '#059669', padding: '2px 8px', borderRadius: '99px', fontWeight: 'bold' }}>
                  {round.is_complete ? 'Archived' : 'Live Scoring'}
                </span>
              </div>
              
              <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '8px' }}>Select your team to enter scores:</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {round.teams.length > 0 ? (
                  round.teams.map((teamNum) => (
                    <Link
                      key={teamNum}
                      href={`/round/${round.id}/scorecard?team=${teamNum}`}
                      style={{ 
                        textAlign: 'center', 
                        padding: '8px 4px', 
                        backgroundColor: '#f8fafc', 
                        border: '1px solid #e2e8f0', 
                        borderRadius: '6px', 
                        fontSize: '0.8rem', 
                        fontWeight: 'bold', 
                        color: '#2563eb', 
                        textDecoration: 'none' 
                      }}
                    >
                      Team {teamNum}
                    </Link>
                  ))
                ) : (
                  <Link href={`/round/${round.id}/scorecard`} style={{ gridColumn: 'span 4', textAlign: 'center', padding: '8px', backgroundColor: '#fef2f2', color: '#dc2626', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none' }}>
                    No teams assigned yet. Click to view all.
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}