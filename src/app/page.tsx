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
  teams: TeamInfo[]; 
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
            // Get players AND their team numbers
            const { data: rps } = await supabase
              .from("round_players")
              .select("team_number, players ( display_name, full_name )")
              .eq("round_id", round.id);
            
            // Group players by team number
            const teamMap: Record<number, string[]> = {};
            rps?.forEach((rp: any) => {
              const tNum = rp.team_number;
              if (tNum === null || tNum === 0) return;
              if (!teamMap[tNum]) teamMap[tNum] = [];
              teamMap[tNum].push(rp.players?.display_name || rp.players?.full_name || "?");
            });

            const teamList: TeamInfo[] = Object.entries(teamMap).map(([num, players]) => ({
              number: parseInt(num),
              players: players
            })).sort((a, b) => a.number - b.number);

            return { ...round, teams: teamList };
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
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif', color: '#1e293b' }}>
      
      {/* HEADER CARD */}
      <div style={{ background: 'linear-gradient(135deg, #14532d, #16a34a)', borderRadius: '16px', padding: '24px', color: 'white', marginBottom: '24px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}>
        <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800 }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.9, fontSize: '0.9rem', marginBottom: '20px' }}>{playerCount} Players • Semiahmoo GCC</p>
        <div style={{ display: 'flex', gap: '10px' }}>
            <Link href="/round/new" style={{ backgroundColor: '#fbbf24', color: '#78350f', padding: '12px 20px', borderRadius: '10px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem' }}>+ New Round</Link>
            <Link href="/thomas-admin" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '12px 20px', borderRadius: '10px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem', border: '1px solid rgba(255,255,255,0.3)' }}>Admin Panel</Link>
        </div>
      </div>

      <h3 style={{ color: '#14532d', fontSize: '1.2rem', marginBottom: '16px', fontWeight: 700 }}>Active Rounds</h3>
      
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading scorecards...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {recentRounds.map((round) => (
            <div key={round.id} style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>{formatDate(round.played_on)}</span>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'black', letterSpacing: '0.05em', backgroundColor: round.is_complete ? '#f1f5f9' : '#dcfce7', color: round.is_complete ? '#94a3b8' : '#166534', padding: '4px 10px', borderRadius: '20px' }}>
                  {round.is_complete ? 'Archived' : 'Live Scoring'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                {round.teams.map((team) => (
                  <Link 
                    key={team.number} 
                    href={`/round/${round.id}/scorecard?team=${team.number}`} 
                    style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      padding: '12px', 
                      backgroundColor: '#f8fafc', 
                      borderRadius: '12px', 
                      textDecoration: 'none', 
                      border: '1px solid #f1f5f9',
                      transition: 'transform 0.1s'
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#1e3a8a', marginBottom: '4px' }}>TEAM {team.number}</span>
                    <span style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>
                      {team.players.join(', ')}
                    </span>
                  </Link>
                ))}
                
                {round.teams.length === 0 && (
                   <div style={{ gridColumn: 'span 2', padding: '12px', textAlign: 'center', backgroundColor: '#fff1f2', color: '#be123c', borderRadius: '10px', fontSize: '12px' }}>
                      No teams assigned in Admin yet.
                   </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}