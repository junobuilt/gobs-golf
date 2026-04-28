"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";

export default function ScorecardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = params.id as string;
  
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<any[]>([]);
  const [allTees, setAllTees] = useState<any[]>([]);
  const [scores, setScores] = useState<any>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      // 1. Get Tees info (for CH calculation)
      const { data: tees } = await supabase.from("tees").select("*").eq("course_id", 1);
      setAllTees(tees || []);

      // 2. Get players for this team
      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase.from("round_players").select(`id, player_id, tee_id, team_number, course_handicap, players ( full_name, display_name, handicap_index )`).eq("round_id", roundId);
      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query;

      if (rp && rp.length > 0) {
        setRoundPlayers(rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id || 1, // Default to Blue (1) if not set
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: r.players?.handicap_index || 0,
          course_handicap: r.course_handicap
        })));

        // If all players already have a tee_id assigned and it's not the default 0, skip setup
        const alreadySet = rp.every(r => r.tee_id !== null && r.tee_id !== 0);
        if (alreadySet) setNeedsSetup(false);

        // Load scores
        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  // CH Calculation Logic
  const calculateCH = (index: number, teeId: number) => {
    const tee = allTees.find(t => t.id === teeId);
    if (!tee) return index;
    // Standard USGA Formula: (Index * (Slope/113)) + (Rating - Par)
    return Math.round((index * (tee.slope / 113)) + (tee.rating - 72));
  };

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    const newCH = calculateCH(player.handicap_index, teeId);
    
    setRoundPlayers(prev => prev.map(p => p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p));
    
    await supabase.from("round_players").update({ tee_id: teeId, course_handicap: newCH }).eq("id", rpId);
  };

  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores((prev: any) => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    const { data: exists } = await supabase.from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();
    if (exists) await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    else await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;

  // SCREEN 1: PREGAME SETUP
  if (needsSetup) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center', color: '#166534' }}>Pregame Setup</h2>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginBottom: '24px' }}>Confirm the tees for your team members:</p>
        
        {roundPlayers.map(rp => (
          <div key={rp.id} style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontWeight: 'bold' }}>{rp.display_name}</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#166534' }}>CH: {rp.course_handicap || "?"}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {allTees.map(t => (
                <button 
                  key={t.id} 
                  onClick={() => updatePlayerTee(rp.id, t.id)}
                  style={{ 
                    flex: 1, padding: '8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 'bold', border: 'none',
                    background: rp.tee_id === t.id ? t.color_code || '#000' : '#f1f5f9',
                    color: rp.tee_id === t.id ? 'white' : '#64748b'
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button 
          onClick={() => setNeedsSetup(false)} 
          style={{ width: '100%', padding: '20px', background: '#166534', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', marginTop: '20px' }}
        >
          START ROUND →
        </button>
      </div>
    );
  }

  // SCREEN 2: THE SCORECARD (Keep your previous slimmed-down scorecard code here...)
  return (
    <div style={{ padding: '15px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '160px' }}>
      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 'bold', color: '#166534' }}>TEAM {teamFilter}</p>
        <div style={{ fontSize: '1.8rem', fontWeight: '900' }}>Hole {currentHole}</div>
      </div>
      
      {/* (Rest of your Scorecard JSX from previous message) */}
      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '10px 15px', borderRadius: '12px', border: '1px solid #f1f5f9', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{rp.display_name}</div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>CH: {rp.course_handicap} | Total: {Object.values(scores[rp.id] || {}).reduce((a: any, b: any) => a + (Number(b) || 0), 0)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) - 1)} style={{ width: '40px', height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>−</button>
            <div style={{ fontSize: '1.6rem', fontWeight: '900', minWidth: '30px', textAlign: 'center' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) + 1)} style={{ width: '40px', height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>+</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>Back</button>
        <button onClick={() => setCurrentHole(h => Math.min(18, h+1))} style={{ flex: 2, padding: '15px', borderRadius: '10px', background: '#166534', color: 'white', fontWeight: 'bold' }}>Next Hole →</button>
      </div>
    </div>
  );
}