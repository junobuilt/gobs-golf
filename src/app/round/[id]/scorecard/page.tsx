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
        setRoundPlayers(rp.map((r: any) => ({ id: r.id, tee_id: r.tee_id, display_name: r.players?.display_name || r.players?.full_name || "?", course_handicap: r.course_handicap })));
        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => { if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {}; scoreMap[item.round_player_id][item.hole_number] = item.strokes; });
        setScores(scoreMap);
        const { data: h } = await supabase.from("holes").select("*").eq("tee_id", rp[0].tee_id).order("hole_number");
        setHolesByTee({ [rp[0].tee_id]: h });
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  const calculateTotal = (rpId: number): number => {
    const pScores = scores[rpId];
    if (!pScores) return 0;
    return Object.values(pScores).reduce((sum: number, val: any) => sum + (Number(val) || 0), 0);
  };

  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores((prev: any) => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    const { data: exists } = await supabase.from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();
    if (exists) await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    else await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  if (showSummary) {
    return (
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', paddingBottom: '160px' }}>
        <h2 style={{ textAlign: 'center' }}>Summary</h2>
        {roundPlayers.map(rp => (
           <div key={rp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontWeight: 'bold' }}>{rp.display_name}</span>
              <span style={{ fontWeight: 900, color: '#166534' }}>{calculateTotal(rp.id)}</span>
           </div>
        ))}
        <button onClick={async () => { setSaving(true); await supabase.from("rounds").update({ is_complete: true }).eq("id", roundId); router.push("/"); }} disabled={saving} style={{ width: '100%', padding: '20px', background: '#fbbf24', border: 'none', borderRadius: '12px', fontWeight: '900', marginTop: '20px' }}>{saving ? "SAVING..." : "FINALIZE ROUND"}</button>
        <button onClick={() => setShowSummary(false)} style={{ width: '100%', padding: '15px', background: 'none', border: '1px solid #ccc', borderRadius: '12px', marginTop: '10px' }}>Back</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '15px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif', paddingBottom: '160px' }}>
      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 'bold', color: '#166534' }}>TEAM {teamFilter}</p>
        <div style={{ fontSize: '1.8rem', fontWeight: '900' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: '0.7rem', margin: 0 }}>Par {currentHoleInfo?.par} • {currentHoleInfo?.yardage}y</p>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', gap: '6px', marginBottom: '15px', paddingBottom: '10px' }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ minWidth: '32px', height: '32px', borderRadius: '50%', border: 'none', background: h === currentHole ? '#166534' : '#f1f5f9', color: h === currentHole ? 'white' : '#64748b', fontSize: '0.75rem', fontWeight: 'bold' }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '10px 15px', borderRadius: '12px', border: '1px solid #f1f5f9', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{rp.display_name}</div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Total: {calculateTotal(rp.id)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) - 1)} style={{ width: '40px', height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '18px' }}>−</button>
            <div style={{ fontSize: '1.6rem', fontWeight: '900', minWidth: '30px', textAlign: 'center' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) + 1)} style={{ width: '40px', height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '18px' }}>+</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} disabled={currentHole === 1} style={{ flex: 1, padding: '15px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 'bold', color: '#64748b' }}>Back</button>
        {currentHole < 18 ? (
          <button onClick={() => setCurrentHole(h => h + 1)} style={{ flex: 2, padding: '15px', borderRadius: '10px', background: '#166534', color: 'white', border: 'none', fontWeight: '900' }}>Next Hole →</button>
        ) : (
          <button onClick={() => setShowSummary(true)} style={{ flex: 2, padding: '15px', borderRadius: '10px', background: '#fbbf24', color: '#78350f', border: 'none', fontWeight: '900' }}>FINALIZE</button>
        )}
      </div>
    </div>
  );
}