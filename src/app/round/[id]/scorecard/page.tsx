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
      // 1. Fetch ALL Tees for this course
      const { data: tees } = await supabase.from("tees").select("*").eq("course_id", 1);
      setAllTees(tees || []);

      // 2. Fetch Players for this specific round/team
      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase.from("round_players").select(`
        id, player_id, tee_id, team_number, course_handicap,
        players ( full_name, display_name, handicap_index )
      `).eq("round_id", roundId);
      
      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        const playersData = rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id, 
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: Number(r.players?.handicap_index) || 0,
          course_handicap: r.course_handicap
        }));
        setRoundPlayers(playersData);

        // Logic: Show setup if even one player is missing a tee
        const allSet = playersData.every(p => p.tee_id !== null && p.tee_id !== 0);
        setNeedsSetup(!allSet);

        // 3. Load scores
        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);

        // 4. Load hole data for the first player's tee (for par/yardage)
        const initialTee = playersData[0].tee_id || 1;
        const { data: h } = await supabase.from("holes").select("*").eq("tee_id", initialTee).order("hole_number");
        setHolesByTee({ [initialTee]: h });
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  // CALCULATION LOGIC: Runs every time a tee is clicked
  const calculateCH = (index: number, teeId: number) => {
    const tee = allTees.find(t => Number(t.id) === Number(teeId));
    if (!tee || !tee.slope || !tee.rating) return Math.round(index);
    
    // USGA Formula: (Index * (Slope / 113)) + (Rating - 72)
    const rawCH = (index * (Number(tee.slope) / 113)) + (Number(tee.rating) - 72);
    return Math.round(rawCH);
  };

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    // Find the player in our current list
    const player = roundPlayers.find(p => p.id === rpId);
    if (!player) return;

    // Calculate new CH based on their index and the NEW tee
    const newCH = calculateCH(player.handicap_index, teeId);
    
    console.log(`Updating ${player.display_name}: Tee ${teeId}, New CH: ${newCH}`);

    // 1. Update UI immediately
    setRoundPlayers(current => current.map(p => 
      p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p
    ));
    
    // 2. Update Database in the background
    await supabase.from("round_players")
      .update({ tee_id: teeId, course_handicap: newCH })
      .eq("id", rpId);
    
    // 3. Ensure we have hole data for this tee (so par/yardage works later)
    if (!holesByTee[teeId]) {
      const { data: h } = await supabase.from("holes").select("*").eq("tee_id", teeId).order("hole_number");
      setHolesByTee(prev => ({ ...prev, [teeId]: h }));
    }
  };

  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores((prev: any) => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    const { data: exists } = await supabase.from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();
    if (exists) await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    else await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
  };

  const calculateTotal = (rpId: number) => {
    const pScores = scores[rpId] || {};
    return Object.values(pScores).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Scorecard...</div>;

  // SETUP VIEW: Picking Tees
  if (needsSetup) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center', color: '#166534', fontWeight: 900 }}>Tee Selection</h2>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginBottom: '24px' }}>Confirm tees for Team {teamFilter}:</p>
        
        {roundPlayers.map(rp => (
          <div key={rp.id} style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid #e2e8f0', marginBottom: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontWeight: '900', fontSize: '1.2rem', color: '#1e293b' }}>{rp.display_name}</span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8', display: 'block' }}>CH</span>
                <span style={{ fontSize: '1.2rem', fontWeight: '900', color: '#166534' }}>
                  {rp.course_handicap !== null && rp.course_handicap !== undefined ? rp.course_handicap : "?"}
                </span>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              {allTees.map((t) => {
                const isSelected = Number(rp.tee_id) === Number(t.id);
                // Contrast Logic: If hex is the Semiahmoo Blue, use White text. Else Black.
                const textColor = (t.color_code === '#1e40af') ? '#ffffff' : '#000000';
                
                return (
                  <button 
                    key={t.id} 
                    onClick={() => updatePlayerTee(rp.id, t.id)} 
                    style={{ 
                      flex: 1, padding: '14px 4px', borderRadius: '12px', fontSize: '10px', fontWeight: '900',
                      // Visual Highlight
                      border: isSelected ? '4px solid #166534' : '1px solid #e2e8f0',
                      background: t.color_code || '#ccc',
                      color: textColor,
                      textTransform: 'uppercase',
                      // Feedback
                      opacity: isSelected ? 1 : 0.4,
                      transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                      transition: 'all 0.1s ease-in-out'
                    }}
                  >
                    {t.name}
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

  // SCORING VIEW
  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  return (
    <div style={{ padding: '15px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '160px' }}>
      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: '900', color: '#166534' }}>TEAM {teamFilter}</p>
        <div style={{ fontSize: '2.2rem', fontWeight: '900' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: '0.75rem', fontWeight: 'bold' }}>PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS</p>
      </div>

      {/* Hole Selector Dots */}
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