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
  const [playedOn, setPlayedOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(true);
  const [showSummary, setShowSummary] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      const { data: tees } = await supabase.from("tees").select("*").eq("course_id", 1);
      setAllTees(tees || []);

      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase.from("round_players").select(`
        id, player_id, tee_id, team_number, course_handicap,
        players ( full_name, display_name, handicap_index )
      `).eq("round_id", roundId);
      
      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        // DIAGNOSTIC LOG
        console.log("SCORECARD LOADED DATA:", rp);

        setRoundPlayers(rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id, 
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: r.players?.handicap_index || 0,
          course_handicap: r.course_handicap
        })));

        // FORCE CHECK: If any tee_id is 1, null, or 0, we show setup
        const allPlayersHaveTees = rp.every(r => r.tee_id !== null && r.tee_id !== 0);
        
        if (allPlayersHaveTees) {
          console.log("All players have tees assigned. Moving to scoring.");
          setNeedsSetup(false);
          const { data: h } = await supabase.from("holes").select("*").eq("tee_id", rp[0].tee_id).order("hole_number");
          setHolesByTee({ [rp[0].tee_id]: h });
        } else {
          console.log("Missing Tee IDs found. Redirecting to Setup Screen.");
          setNeedsSetup(true);
        }

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

  const calculateCH = (index: number, teeId: number) => {
    const tee = allTees.find(t => t.id === teeId);
    if (!tee) return Math.round(index);
    return Math.round((index * (tee.slope / 113)) + (tee.rating - 72));
  };

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    const newCH = calculateCH(player.handicap_index, teeId);
    setRoundPlayers(prev => prev.map(p => p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p));
    await supabase.from("round_players").update({ tee_id: teeId, course_handicap: newCH }).eq("id", rpId);
    
    // Also load hole info for this new tee if we don't have it
    if (!holesByTee[teeId]) {
        const { data: h } = await supabase.from("holes").select("*").eq("tee_id", teeId).order("hole_number");
        setHolesByTee((prev: any) => ({ ...prev, [teeId]: h }));
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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Round...</div>;

  // VIEW 1: PREGAME SETUP
  if (needsSetup) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center', color: '#166534', fontWeight: 900 }}>Tee Selection</h2>
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginBottom: '24px' }}>Team {teamFilter} — Confirm tees for today:</p>
        {roundPlayers.map(rp => (
          <div key={rp.id} style={{ background: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
              <span style={{ fontWeight: '800' }}>{rp.display_name}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px' }}>CH: {rp.course_handicap || "?"}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {allTees.map(t => (
                <button key={t.id} onClick={() => updatePlayerTee(rp.id, t.id)} style={{ flex: 1, padding: '10px 4px', borderRadius: '8px', fontSize: '10px', fontWeight: '900', border: 'none', background: rp.tee_id === t.id ? (t.color_code || '#000') : '#f8fafc', color: rp.tee_id === t.id ? 'white' : '#94a3b8', textTransform: 'uppercase' }}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button onClick={() => setNeedsSetup(false)} style={{ width: '100%', padding: '20px', background: '#166534', color: 'white', border: 'none', borderRadius: '14px', fontWeight: '900', marginTop: '20px', boxShadow: '0 10px 15px -3px rgba(22, 101, 52, 0.2)' }}>START SCORING →</button>
      </div>
    );
  }

  // VIEW 2: SUMMARY REVIEW
  if (showSummary) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', paddingBottom: '160px' }}>
        <h2 style={{ textAlign: 'center', fontWeight: 900 }}>Review Team {teamFilter}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
          {roundPlayers.map(rp => (
             <div key={rp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', backgroundColor: 'white', borderRadius: '16px', border: '1px solid #eee' }}>
                <span style={{ fontWeight: '800' }}>{rp.display_name}</span>
                <span style={{ fontWeight: '900', fontSize: '1.4rem', color: '#166534' }}>{calculateTotal(rp.id)}</span>
             </div>
          ))}
        </div>
        <button onClick={async () => { setSaving(true); await supabase.from("rounds").update({ is_complete: true }).eq("id", roundId); router.push("/"); }} style={{ width: '100%', padding: '20px', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: '16px', fontWeight: '900', fontSize: '1.1rem', marginTop: '30px' }}>
          {saving ? "SAVING..." : "FINALIZE & CLOSE ROUND"}
        </button>
        <button onClick={() => setShowSummary(false)} style={{ width: '100%', padding: '15px', background: 'none', border: 'none', color: '#64748b', fontWeight: 'bold' }}>Back to Scorecard</button>
      </div>
    );
  }

  // VIEW 3: MAIN SCORECARD
  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  return (
    <div style={{ padding: '15px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '160px' }}>
      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: '900', color: '#166534', letterSpacing: '0.05em' }}>TEAM {teamFilter}</p>
        <div style={{ fontSize: '2.2rem', fontWeight: '900', letterSpacing: '-1px' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: '0.75rem', fontWeight: 'bold' }}>PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS</p>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', gap: '6px', marginBottom: '20px', paddingBottom: '12px' }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ minWidth: '35px', height: '35px', borderRadius: '50%', border: h === currentHole ? '2px solid #166534' : '1px solid #e2e8f0', background: h === currentHole ? '#166534' : 'white', color: h === currentHole ? 'white' : '#94a3b8', fontSize: '0.8rem', fontWeight: 'bold' }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '12px 16px', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '800', fontSize: '0.95rem', color: '#1e293b' }}>{rp.display_name}</div>
            <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8' }}>CH: {rp.course_handicap} | TOTAL: {calculateTotal(rp.id)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) - 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '20px', fontWeight: 'bold' }}>−</button>
            <div style={{ fontSize: '1.8rem', fontWeight: '900', minWidth: '35px', textAlign: 'center', color: '#1e3a8a' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) + 1)} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '20px', fontWeight: 'bold' }}>+</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} disabled={currentHole === 1} style={{ flex: 1, padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 'bold', color: '#94a3b8' }}>Back</button>
        {currentHole < 18 ? (
          <button onClick={() => setCurrentHole(h => h + 1)} style={{ flex: 2, padding: '18px', borderRadius: '12px', background: '#166534', color: 'white', border: 'none', fontWeight: '900', boxShadow: '0 4px 12px rgba(22, 101, 52, 0.2)' }}>Next Hole →</button>
        ) : (
          <button onClick={() => setShowSummary(true)} style={{ flex: 2, padding: '18px', borderRadius: '12px', background: '#fbbf24', color: '#78350f', border: 'none', fontWeight: '900' }}>REVIEW ROUND</button>
        )}
      </div>
    </div>
  );
}