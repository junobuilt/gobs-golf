"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";

export default function ScorecardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = params.id as string;
  
  // SAFE WAY TO GET TEAM FROM URL
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
    // Get team number from URL safely
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      const { data: round } = await supabase.from("rounds").select("played_on").eq("id", roundId).single();
      if (round) setPlayedOn(round.played_on);

      let query = supabase.from("round_players").select(`id, player_id, tee_id, team_number, course_handicap, players ( full_name, display_name )`).eq("round_id", roundId);
      
      const team = new URLSearchParams(window.location.search).get("team");
      if (team) query = query.eq("team_number", parseInt(team));

      const { data: rp } = await query.order("id");

      if (rp) {
        setRoundPlayers(rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id,
          display_name: r.players?.display_name || r.players?.full_name || "?",
          course_handicap: r.course_handicap
        })));

        // Load scores
        const { data: s } = await supabase.from("scores").select("*").in("round_player_id", rp.map(r => r.id));
        const scoreMap: any = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);

        // Load holes for first player's tee
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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Scorecard...</div>;

  const currentHoleInfo = holesByTee[roundPlayers[0]?.tee_id]?.find((h: any) => h.hole_number === currentHole);

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>Team {teamFilter || "All"}</h2>
        <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.6 }}>Par {currentHoleInfo?.par} • {currentHoleInfo?.yardage} yards</p>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', gap: '8px', marginBottom: '20px', paddingBottom: '10px' }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ minWidth: '35px', height: '35px', borderRadius: '50%', border: h === currentHole ? '2px solid black' : '1px solid #ccc', background: h === currentHole ? '#000' : 'white', color: h === currentHole ? 'white' : 'black' }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map(rp => (
        <div key={rp.id} style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid #eee', marginBottom: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>{rp.display_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px' }}>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) - 1)} style={{ width: '50px', height: '50px', borderRadius: '50%', border: '1px solid #ddd', fontSize: '24px' }}>-</button>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', minWidth: '60px', textAlign: 'center' }}>{scores[rp.id]?.[currentHole] || "—"}</div>
            <button onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || currentHoleInfo?.par || 4) + 1)} style={{ width: '50px', height: '50px', borderRadius: '50%', border: '1px solid #ddd', fontSize: '24px' }}>+</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} style={{ flex: 1, padding: '15px', borderRadius: '8px', border: '1px solid #ddd' }}>Previous</button>
        <button onClick={() => setCurrentHole(h => Math.min(18, h+1))} style={{ flex: 1, padding: '15px', borderRadius: '8px', background: '#059669', color: 'white', border: 'none', fontWeight: 'bold' }}>Next Hole</button>
      </div>
    </div>
  );
}