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
  const [holesByTee, setHolesByTee] = useState<any>({});
  const [scores, setScores] = useState<any>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      // 1. Fetch Tees
      const { data: tees } = await supabase.from("tees").select("*").eq("course_id", 1);
      setAllTees(tees || []);

      // 2. Fetch Players
      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase.from("round_players").select(`
        id, player_id, tee_id, team_number, course_handicap,
        players ( full_name, display_name, handicap_index )
      `).eq("round_id", roundId);
      
      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        setRoundPlayers(rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id || 0, 
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: Number(r.players?.handicap_index) || 0,
          course_handicap: r.course_handicap
        })));

        // If everyone has a tee assigned, skip setup
        const allSet = rp.every(r => r.tee_id !== null && r.tee_id !== 0);
        setNeedsSetup(!allSet);

        // 3. Load scores
        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);

        // 4. Load hole info for first player's tee
        const activeTee = rp[0].tee_id || 1;
        const { data: h } = await supabase.from("holes").select("*").eq("tee_id", activeTee).order("hole_number");
        setHolesByTee({ [activeTee]: h });
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  // THIS SAVES THE STROKES (Fixed the Vercel Error)
  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores((prev: any) => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    const { data: exists } = await supabase.from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();
    if (exists) await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    else await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
  };

  const calculateCH = (index: number, teeId: number) => {
    const tee = allTees.find(t => t.id === teeId);
    if (!tee || !tee.slope) return Math.round(index);
    // USGA: (Index * (Slope/113)) + (Rating - Par)
    return Math.round((index * (Number(tee.slope) / 113)) + (Number(tee.rating) - 72));
  };

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    if (!player) return;

    const newCH = calculateCH(player.handicap_index, teeId);
    
    // Update local state so CH: ? changes to a number immediately
    setRoundPlayers(prev => prev.map(p => p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p));
    
    // Update Database
    await supabase.from("round_players").update({ tee_id: teeId, course_handicap: newCH }).eq("id", rpId);
    
    if (!holesByTee[teeId]) {
      const { data: h } = await supabase.from("holes").select("*").eq("tee_id", teeId).order("hole_number");
      setHolesByTee((prev: any) => ({ ...prev, [teeId]: h }));
    }
  };

  const calculateTotal = (rpId: number) => {
    const pScores = scores[rpId] || {};
    return Object.values(pScores).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Round...</div>;

  // SCREEN 1: PREGAME TEE SELECTION
  if (needsSetup) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center', color: '#166534', fontWeight: 900 }}>Tee Selection</h2>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginBottom: '24px' }}>Confirm tees for Team {teamFilter}:</p>
        
        {roundPlayers.map(rp => (
          <div key={rp.id} style={{ background: 'white', padding: '20px', borderRadius: '20px', border: '1px solid #e2e8f0', marginBottom: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontWeight: '800', fontSize: '1.1rem' }}>{rp.display_name}</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#166534', background: '#f1f5f9', padding: '4px 12px', borderRadius: '20px' }}>
                CH: {rp.course_handicap !== null && rp.course_handicap !== undefined ? rp.course_handicap : "?"}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              {allTees.map((t) => {
                const isSelected = rp.tee_id === t.id;
                // Dark background if blue or black, otherwise light
                const isDark = t.name?.toLowerCase().includes('blue') || t.name?.toLowerCase().includes('black');
                
                return (
                  <button 
                    key={t.id} 
                    onClick={() => updatePlayerTee(rp.id, t.id)} 
                    style={{ 
                      flex: 1, padding: '14px 4px', borderRadius: '10px', fontSize: '11px', fontWeight: '900',
                      border: isSelected ? '3px solid #166534' : '1px solid #e2e8f0',
                      background: isSelected ? (t.color_code || '#000') : '#f8fafc',
                      color: isSelected ? (isDark ? '#ffffff' : '#000000') : '#94a3b8',
                      textTransform: 'uppercase'
                    }}
                  >
                    {t.name || "Tee"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        
        <button onClick={() => setNeedsSetup(false)} style={{ width: '100%', padding: '20px', background: '#166534', color: 'white', border: 'none', borderRadius: '16px', fontWeight: '900', fontSize: '1.1rem', marginTop: '20px' }}>START ROUND →</button>
      </div>
    );
  }

  // SCREEN 2: MAIN SCORECARD
  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  return (
    <div style={{ padding: '15px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '160px' }}>
      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: '900', color: '#166534' }}>TEAM {teamFilter}</p>
        <div style={{ fontSize: '2.2rem', fontWeight: '900' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: '0.75rem', fontWeight: 'bold' }}>PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS</p>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', gap: '6px', marginBottom: '20px', paddingBottom: '10px' }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ minWidth: '35px', height: '35px', borderRadius: '50%', border: h === currentHole ? '2px solid #166534' : '1px solid #e2e8f0', background: h === currentHole ? '#166534' : 'white', color: h === currentHole ? 'white' : '#94a3b8', fontSize: '0.8rem', fontWeight: 'bold' }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '12px 16px', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '800', fontSize: '0.95rem' }}>{rp.display_name}</div>
            <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8' }}>CH: {rp.course_handicap} | TOTAL: {calculateTotal(rp.id)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) - 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '20px' }}>−</button>
            <div style={{ fontSize: '1.8rem', fontWeight: '900', minWidth: '35px', textAlign: 'center' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) + 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '20px' }}>+</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} disabled={currentHole === 1} style={{ flex: 1, padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>Back</button>
        <button onClick={() => setCurrentHole(h => Math.min(18, h+1))} style={{ flex: 2, padding: '18px', borderRadius: '12px', background: '#166534', color: 'white', border: 'none', fontWeight: '900' }}>Next Hole →</button>
      </div>
    </div>
  );
}