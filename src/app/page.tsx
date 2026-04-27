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
      const { count } = await supabase.from("players").select("*", { count: "exact", head: true }).eq("is_active", true);
      setPlayerCount(count || 0);

      const { data: rounds } = await supabase.from("rounds").select("id, played_on, is_complete").order("played_on", { ascending: false }).limit(10);

      if (rounds) {
        const roundsWithTeams = await Promise.all(
          rounds.map(async (round) => {
            const { data: rps } = await supabase.from("round_players").select("team_number, players ( display_name, full_name )").eq("round_id", round.id);
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
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif', color: '#1e293b', paddingBottom: '140px' }}>
      
      <div style={{ background: 'linear-gradient(135deg, #14532d, #16a34a)', borderRadius: '16px', padding: '24px', color: 'white', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800 }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.9, fontSize: '0.85rem', marginBottom: '20px' }}>{playerCount} Players • Semiahmoo GCC</p>
        <div style={{ display: 'flex', gap: '8px' }}>
            <Link href="/round/new" style={{ backgroundColor: '#fbbf24', color: '#78350f', padding: '10px 16px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.85rem' }}>+ New Round</Link>
            <Link href="/thomas-admin" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '10px 16px', borderRadius: '8px', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.3)' }}>Admin</Link>
        </div>
      </div>

      <h3 style={{ color: '#14532d', fontSize: '1.1rem', marginBottom: '16px', fontWeight: 700 }}>Available Scorecards</h3>
      
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {recentRounds.map((round) => (
            <div key={round.id} style={{ background: 'white', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                <span style={{ fontWeight: 800 }}>{formatDate(round.played_on)}</span>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 'bold', color: round.is_complete ? '#94a3b8' : '#16a34a' }}>
                  {round.is_complete ? 'Archived' : 'Live'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {round.teams.map((team) => (
                  <Link key={team.number} href={`/round/${round.id}/scorecard?team=${team.number}`} style={{ display: 'flex', flexDirection: 'column', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '10px', textDecoration: 'none', border: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#1e3a8a' }}>TEAM {team.number}</span>
                    <span style={{ fontSize: '10px', color: '#64748b', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{team.players.join(', ')}</span>
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