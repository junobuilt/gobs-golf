"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type HoleInfo = {
  hole_number: number;
  par: number;
  yardage: number;
  stroke_index: number;
};

type RoundPlayerInfo = {
  id: number;
  player_id: number;
  tee_id: number;
  team_number: number;
  course_handicap: number | null;
  player_name: string;
  display_name: string;
};

type ScoreMap = {
  [roundPlayerId: number]: {
    [hole: number]: number;
  };
};

type HolesByTee = {
  [teeId: number]: HoleInfo[];
};

export default function ScorecardPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const roundId = params.id as string;
  const teamFilter = searchParams.get("team"); // Looks for ?team=X in the URL

  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerInfo[]>([]);
  const [holesByTee, setHolesByTee] = useState<HolesByTee>({});
  const [scores, setScores] = useState<ScoreMap>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [playedOn, setPlayedOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      
      // 1. Fetch round info
      const { data: round } = await supabase
        .from("rounds")
        .select("played_on")
        .eq("id", roundId)
        .single();

      if (round) setPlayedOn(round.played_on);

      // 2. Fetch round players (Filtered by team if provided)
      let query = supabase
        .from("round_players")
        .select(`
          id, player_id, tee_id, team_number, course_handicap,
          players ( full_name, display_name )
        `)
        .eq("round_id", roundId);

      // APPLY THE FILTER HERE
      if (teamFilter) {
        query = query.eq("team_number", parseInt(teamFilter));
      }

      const { data: rp } = await query
        .order("team_number")
        .order("id");

      if (rp && rp.length > 0) {
        const players: RoundPlayerInfo[] = rp.map((r: any) => ({
          id: r.id,
          player_id: r.player_id,
          tee_id: r.tee_id,
          team_number: r.team_number,
          course_handicap: r.course_handicap,
          player_name: r.players?.full_name || "Unknown",
          display_name: r.players?.display_name || r.players?.full_name || "?",
        }));
        setRoundPlayers(players);

        // Fetch holes for each unique tee
        const teeIds = [...new Set(players.map((p) => p.tee_id))];
        const holesMap: HolesByTee = {};
        for (const teeId of teeIds) {
          const { data: holes } = await supabase
            .from("holes")
            .select("hole_number, par, yardage, stroke_index")
            .eq("tee_id", teeId)
            .order("hole_number");
          if (holes) holesMap[teeId] = holes;
        }
        setHolesByTee(holesMap);

        // Fetch existing scores
        const rpIds = players.map((p) => p.id);
        const { data: existingScores } = await supabase
          .from("scores")
          .select("round_player_id, hole_number, strokes")
          .in("round_player_id", rpIds);

        if (existingScores) {
          const scoreMap: ScoreMap = {};
          existingScores.forEach((s: any) => {
            if (!scoreMap[s.round_player_id]) scoreMap[s.round_player_id] = {};
            scoreMap[s.round_player_id][s.hole_number] = s.strokes;
          });
          setScores(scoreMap);

          // Find first hole without all scores entered
          for (let h = 1; h <= 18; h++) {
            const allEntered = players.every(
              (p) => scoreMap[p.id]?.[h] !== undefined
            );
            if (!allEntered) {
              setCurrentHole(h);
              break;
            }
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [roundId, teamFilter]); // Reload if the team in the URL changes

  // ... (Keep all the helper functions: getScore, adjustScore, etc. exactly as they were) ...
  function getScore(roundPlayerId: number, hole: number): number | undefined {
    return scores[roundPlayerId]?.[hole];
  }

  function getHoleInfo(teeId: number, hole: number): HoleInfo | undefined {
    return holesByTee[teeId]?.find((h) => h.hole_number === hole);
  }

  function getStrokesReceived(courseHandicap: number | null, strokeIndex: number): number {
    if (courseHandicap === null) return 0;
    if (courseHandicap <= 0) return 0;
    let strokes = 0;
    let remaining = courseHandicap;
    if (remaining >= strokeIndex) strokes++;
    remaining -= 18;
    if (remaining > 0 && remaining >= strokeIndex) strokes++;
    remaining -= 18;
    if (remaining > 0 && remaining >= strokeIndex) strokes++;
    return strokes;
  }

  const setScore = useCallback(
    async (roundPlayerId: number, hole: number, strokes: number) => {
      if (strokes < 1 || strokes > 20) return;
      setScores((prev) => ({
        ...prev,
        [roundPlayerId]: {
          ...prev[roundPlayerId],
          [hole]: strokes,
        },
      }));
      const { data: existing } = await supabase
        .from("scores")
        .select("id")
        .eq("round_player_id", roundPlayerId)
        .eq("hole_number", hole)
        .maybeSingle();
      if (existing) {
        await supabase.from("scores").update({ strokes }).eq("id", existing.id);
      } else {
        await supabase.from("scores").insert({
          round_player_id: roundPlayerId,
          hole_number: hole,
          strokes,
        });
      }
    },
    []
  );

  function adjustScore(roundPlayerId: number, hole: number, delta: number) {
    const current = getScore(roundPlayerId, hole);
    const player = roundPlayers.find((p) => p.id === roundPlayerId);
    if (!player) return;
    const holeInfo = getHoleInfo(player.tee_id, hole);
    const defaultScore = holeInfo ? holeInfo.par : 4;
    const newScore = (current ?? defaultScore) + delta;
    setScore(roundPlayerId, hole, newScore);
  }

  function getTotalScore(roundPlayerId: number): number {
    const playerScores = scores[roundPlayerId] || {};
    return Object.values(playerScores).reduce((sum, s) => sum + s, 0);
  }

  function getHolesCompleted(roundPlayerId: number): number {
    return Object.keys(scores[roundPlayerId] || {}).length;
  }

  function scoreBadge(strokes: number, par: number) {
    const diff = strokes - par;
    if (diff <= -2) return { label: `${diff}`, className: "badge-birdie" };
    if (diff === -1) return { label: "Birdie", className: "badge-birdie" };
    if (diff === 0) return { label: "Par", className: "badge-par" };
    if (diff === 1) return { label: "Bogey", className: "badge-bogey" };
    return { label: `+${diff}`, className: "badge-double" };
  }

  async function finishRound() {
    setSaving(true);
    await supabase.from("rounds").update({ is_complete: true }).eq("id", roundId);
    router.push("/");
  }

  if (loading) {
    return <div className="page-content"><div className="loading"><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></div></div>;
  }

  if (showSummary) {
    return (
      <div className="page-content">
        <h2 className="page-title">Team {teamFilter} Summary</h2>
        <p className="page-subtitle">{playedOn}</p>
        {roundPlayers.map((rp) => (
          <div key={rp.id} className="card">
            <div className="flex-between">
              <div>
                <div style={{ fontWeight: 700 }}>{rp.display_name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{getHolesCompleted(rp.id)}/18 holes</div>
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--green-900)" }}>{getTotalScore(rp.id) || "—"}</div>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
          <button onClick={() => setShowSummary(false)} className="btn btn-secondary" style={{ flex: 1 }}>Back</button>
          <button onClick={finishRound} disabled={saving} className="btn btn-primary" style={{ flex: 1 }}>Finish</button>
        </div>
      </div>
    );
  }

  const currentHoleInfo = roundPlayers[0] ? getHoleInfo(roundPlayers[0].tee_id, currentHole) : null;

  return (
    <div className="page-content">
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, color: "var(--green-800)" }}>Team {teamFilter || "All"}</h2>
        <div style={{ fontSize: "1.8rem", fontWeight: "bold" }}>Hole {currentHole}</div>
        <div style={{ fontSize: "0.8rem", opacity: 0.6 }}>Par {currentHoleInfo?.par} • {currentHoleInfo?.yardage} yds</div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: "4px", marginBottom: "20px", flexWrap: "wrap" }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
          <button key={h} onClick={() => setCurrentHole(h)} style={{ width: "30px", height: "30px", borderRadius: "50%", border: h === currentHole ? "2px solid black" : "1px solid #ccc", background: h === currentHole ? "#eee" : "white" }}>{h}</button>
        ))}
      </div>

      {roundPlayers.map((rp) => {
        const cur = getScore(rp.id, currentHole);
        const playerHole = getHoleInfo(rp.tee_id, currentHole);
        const badge = cur && playerHole ? scoreBadge(cur, playerHole.par) : null;
        return (
          <div key={rp.id} className="card" style={{ marginBottom: "12px", padding: "16px" }}>
            <div className="flex-between">
               <span style={{ fontWeight: "bold" }}>{rp.display_name}</span>
               <span style={{ fontSize: "0.8rem" }}>Total: {getTotalScore(rp.id)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "20px", marginTop: "10px" }}>
               <button className="score-adjust-btn" onClick={() => adjustScore(rp.id, currentHole, -1)}>−</button>
               <div style={{ fontSize: "2rem", fontWeight: "bold", minWidth: "40px", textAlign: "center" }}>{cur || "—"}</div>
               <button className="score-adjust-btn" onClick={() => adjustScore(rp.id, currentHole, 1)}>+</button>
            </div>
            {badge && <div style={{ textAlign: "center", marginTop: "4px" }}><span className={`badge ${badge.className}`}>{badge.label}</span></div>}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h-1))} className="btn btn-secondary" style={{ flex: 1 }}>Previous</button>
        {currentHole < 18 ? (
          <button onClick={() => setCurrentHole(h => h + 1)} className="btn btn-primary" style={{ flex: 1 }}>Next Hole</button>
        ) : (
          <button onClick={() => setShowSummary(true)} className="btn btn-gold" style={{ flex: 1 }}>Review</button>
        )}
      </div>
    </div>
  );
}