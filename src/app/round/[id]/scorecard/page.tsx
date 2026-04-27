"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";

export default function ScorecardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = params.id as string;
  
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<any[]>([]);
  const [holesByTee, setHolesByTee] = useState<any>({});
  const [scores, setScores] = useState<any>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [playedOn, setPlayedOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      const { data: round } = await supabase.from("rounds").select("played_on").eq("id", roundId).single();
      if (round) setPlayedOn(round.played_on);

      let query = supabase.from("round_players").select(`id, player_id, tee_id, team_number, course_handicap, players ( full_name, display_name )`).eq("round_id", roundId);
      
      const team = new URLSearchParams(window.location.search).get("team");
      if (team) query = query.eq("team_number", parseInt(team));

      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        setRoundPlayers(rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id,
          display_name: r.players?.display_name || r.players?.full_name || "?",
          course_handicap: r.course_handicap
        })));

        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);

        const { data: h } = await supabase.from("holes").select("*").eq("tee_id", rp[0].tee_id).order("hole_number");
        setHolesByTee({ [rp[0].tee_id]: h });
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores((prev: any) => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    const { data: exists } = await supabase.from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();
    if (exists) await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    else await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
  };

  async function finishRound() {
    setSaving(true);
    await supabase.from("rounds").update({ is_complete: true }).eq("id", roundId);
    router.push("/");
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Scorecard...</div>;

  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  // SUMMARY VIEW
  if (showSummary) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', paddingBottom: '120px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>Round Review</h2>
        {roundPlayers.map(rp => (
           <div key={rp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontWeight: 'bold' }}>{rp.display_name}</span>
              <span style={{ fontWeight: 800 }}>Total: {Object.values(scores[rp.id] || {}).reduce((a: any, b: any) => a + b, 0)}</span>
           </div>
        ))}
        <div style={{ marginTop: '30px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button onClick={finishRound} disabled={saving} style={{ padding: '20px', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: '12px', fontWeight: '900', fontSize: '1.2rem' }}>
            {saving ? "SAVING..." : "CONFIRM & FINALIZE ROUND"}
          </button>
          <button onClick={() => setShowSummary(false)} style={{ padding: '15px', background: 'none', border: '1px solid #ccc', borderRadius: '12px' }}>Back to Editing</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '500px', 
      margin: '0 auto', 
      fontFamily: 'sans-serif',
      paddingBottom: '140px' // THIS FIXES THE OVERLAP WITH THE BOTTOM NAV
    }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#166534', fontSize: '1rem' }}>Team {teamFilter || "All"}</h2>
        <div style={{ fontSize: '2.5rem', fontWeight: '900', letterSpacing: '-1px' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.6, fontWeight: 'bold' }}>Par {currentHoleInfo?.par} • {currentHoleInfo?.yardage} yards</p>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', gap: '8px', marginBottom: '24px', paddingBottom: '10px', scrollbarWidth: 'none' }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ minWidth: '38px', height: '38px', borderRadius: '50%', border: h === currentHole ? '2px solid #166534' : '1px solid #ddd', background: h === currentHole ? '#166534' : 'white', color: h === currentHole ? 'white' : '#666', fontWeight: 'bold' }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
             <span style={{ fontWeight: '800', color: '#1e293b' }}>{rp.display_name}</span>
             <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '10px', color: '#64748b' }}>Total: {Object.values(scores[rp.id] || {}).reduce((a: any, b: any) => a + b, 0)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) - 1)} style={{ width: '55px', height: '55px', borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '24px', background: '#f8fafc', color: '#1e293b' }}>−</button>
            <div style={{ fontSize: '2.8rem', fontWeight: '900', minWidth: '60px', textAlign: 'center', color: '#1e3a8a' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) + 1)} style={{ width: '55px', height: '55px', borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '24px', background: '#f8fafc', color: '#1e293b' }}>+</button>
          </div>
        </div>
      ))}

      {/* FOOTER NAVIGATION */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <button 
          onClick={() => setCurrentHole(h => Math.max(1, h-1))} 
          disabled={currentHole === 1}
          style={{ flex: 1, padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 'bold', color: currentHole === 1 ? '#ccc' : '#64748b' }}
        >
          Previous
        </button>
        
        {currentHole < 18 ? (
          <button 
            onClick={() => setCurrentHole(h => h + 1)} 
            style={{ flex: 2, padding: '18px', borderRadius: '12px', background: '#166534', color: 'white', border: 'none', fontWeight: '900', fontSize: '1rem', boxShadow: '0 4px 10px rgba(22, 101, 52, 0.2)' }}
          >
            Next Hole →
          </button>
        ) : (
          <button 
            onClick={() => setShowSummary(true)} 
            style={{ flex: 2, padding: '18px', borderRadius: '12px', background: '#fbbf24', color: '#78350f', border: 'none', fontWeight: '900', fontSize: '1rem', boxShadow: '0 4px 10px rgba(251, 191, 36, 0.3)' }}
          >
            FINALIZE ROUND
          </button>
        )}
      </div>
    </div>
  );
}