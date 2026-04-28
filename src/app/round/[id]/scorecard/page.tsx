"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";

// --- TYPES (matching actual DB columns) ---
interface RoundPlayer {
  id: number;
  tee_id: number | null;
  display_name: string;
  handicap_index: number | null;
  course_handicap: number | null;
}

interface Tee {
  id: number;
  color: string;        // DB column is "color", not "name"
  slope_rating: number; // DB column is "slope_rating", not "slope"
  course_rating: number;// DB column is "course_rating", not "rating"
  par: number;
}

interface HoleInfo {
  hole_number: number;
  par: number;
  yardage: number;
  stroke_index: number;
}

// Color map for tee button styling
const TEE_COLORS: Record<string, { bg: string; text: string }> = {
  Blue:   { bg: "#1e40af", text: "#ffffff" },
  White:  { bg: "#f8fafc", text: "#000000" },
  Yellow: { bg: "#facc15", text: "#000000" },
};

// Same formula used in round/new/page.tsx — keeps everything consistent
function computeCourseHandicap(
  handicapIndex: number | null,
  slope: number,
  rating: number,
  par: number
): number | null {
  if (handicapIndex === null) return null;
  return Math.round(handicapIndex * slope / 113 + (rating - par));
}

export default function ScorecardPage() {
  const params = useParams();
  const roundId = params.id as string;

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  const [allTees, setAllTees] = useState<Tee[]>([]);
  const [holesByTee, setHolesByTee] = useState<Record<number, HoleInfo[]>>({});
  const [scores, setScores] = useState<Record<number, Record<number, number>>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      // 1. Fetch tees using ACTUAL column names
      const { data: teesData } = await supabase
        .from("tees")
        .select("id, color, slope_rating, course_rating, par")
        .order("sort_order");

      const formattedTees: Tee[] = (teesData || []).map(t => ({
        id: t.id,
        color: t.color,
        slope_rating: Number(t.slope_rating),
        course_rating: Number(t.course_rating),
        par: Number(t.par),
      }));
      setAllTees(formattedTees);

      // 2. Fetch round players
      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase
        .from("round_players")
        .select(`
          id, tee_id, course_handicap,
          players ( full_name, display_name, handicap_index )
        `)
        .eq("round_id", roundId);

      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        const playersData: RoundPlayer[] = rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id,
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: r.players?.handicap_index != null ? Number(r.players.handicap_index) : null,
          course_handicap: r.course_handicap != null ? Number(r.course_handicap) : null,
        }));
        setRoundPlayers(playersData);

        // Show tee setup screen if anyone is missing a tee
        const allSet = playersData.every(p => p.tee_id !== null && p.tee_id !== 0);
        setNeedsSetup(!allSet);

        // 3. Load existing scores
        const { data: s } = await supabase
          .from("scores")
          .select("*")
          .in("round_player_id", rp.map((r: any) => r.id));

        const scoreMap: Record<number, Record<number, number>> = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });
        setScores(scoreMap);

        // 4. Pre-load hole data for any tees already assigned
        const uniqueTeeIds = [...new Set(playersData.map(p => p.tee_id).filter(Boolean))] as number[];
        const holesMap: Record<number, HoleInfo[]> = {};
        for (const teeId of uniqueTeeIds) {
          const { data: h } = await supabase
            .from("holes")
            .select("hole_number, par, yardage, stroke_index")
            .eq("tee_id", teeId)
            .order("hole_number");
          holesMap[teeId] = (h || []) as HoleInfo[];
        }
        setHolesByTee(holesMap);
      }
      setLoading(false);
    }
    load();
  }, [roundId]);

  // Update a player's tee and recalculate their CH
  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    const tee = allTees.find(t => t.id === teeId);
    if (!player || !tee) return;

    const newCH = computeCourseHandicap(
      player.handicap_index,
      tee.slope_rating,
      tee.course_rating,
      tee.par
    );

    // 1. Update local state immediately so UI reflects change
    setRoundPlayers(current =>
      current.map(p =>
        p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p
      )
    );

    // 2. Persist to database
    await supabase
      .from("round_players")
      .update({ tee_id: teeId, course_handicap: newCH })
      .eq("id", rpId);

    // 3. Load hole data for this tee if we haven't yet
    if (!holesByTee[teeId]) {
      const { data: h } = await supabase
        .from("holes")
        .select("hole_number, par, yardage, stroke_index")
        .eq("tee_id", teeId)
        .order("hole_number");
      setHolesByTee(prev => ({ ...prev, [teeId]: (h || []) as HoleInfo[] }));
    }
  };

  // Save a score for a player on a hole
  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores(prev => ({
      ...prev,
      [rpId]: { ...prev[rpId], [hole]: strokes },
    }));

    const { data: exists } = await supabase
      .from("scores")
      .select("id")
      .eq("round_player_id", rpId)
      .eq("hole_number", hole)
      .maybeSingle();

    if (exists) {
      await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    } else {
      await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
    }
  };

  // Get total strokes for a player across all holes entered so far
  const getPlayerTotal = (rpId: number) => {
    const playerScores = scores[rpId];
    if (!playerScores) return 0;
    return Object.values(playerScores).reduce((sum, s) => sum + s, 0);
  };

  // --- LOADING STATE ---
  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
        Loading Round...
      </div>
    );
  }

  // --- TEE SELECTION SCREEN ---
  if (needsSetup) {
    return (
      <div style={{ padding: "20px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif" }}>
        <h2 style={{ textAlign: "center", color: "#166534", fontWeight: 900, marginBottom: "4px" }}>
          Tee Selection
        </h2>
        <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#64748b", marginBottom: "24px" }}>
          {teamFilter ? `Confirm tees for Team ${teamFilter}` : "Confirm tees for each player"}
        </p>

        {roundPlayers.map(rp => (
          <div key={rp.id} style={{
            background: "white",
            padding: "20px",
            borderRadius: "24px",
            border: "1px solid #e2e8f0",
            marginBottom: "16px",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", alignItems: "center" }}>
              <div>
                <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "#1e293b" }}>
                  {rp.display_name}
                </span>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "2px" }}>
                  HCP Index: {rp.handicap_index ?? "N/A"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "block" }}>CH</span>
                <span style={{ fontSize: "1.2rem", fontWeight: 900, color: "#166534" }}>
                  {rp.course_handicap !== null ? rp.course_handicap : "?"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {allTees.map(t => {
                const isSelected = rp.tee_id === t.id;
                const colors = TEE_COLORS[t.color] || { bg: "#ccc", text: "#000" };

                return (
                  <button
                    key={t.id}
                    onClick={() => updatePlayerTee(rp.id, t.id)}
                    style={{
                      flex: 1,
                      padding: "14px 4px",
                      borderRadius: "12px",
                      fontSize: "10px",
                      fontWeight: 900,
                      border: isSelected ? "4px solid #166534" : "1px solid #e2e8f0",
                      background: colors.bg,
                      color: colors.text,
                      textTransform: "uppercase",
                      opacity: isSelected ? 1 : 0.4,
                      transform: isSelected ? "scale(1.05)" : "scale(1)",
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    {t.color}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <button
          onClick={() => {
            const allSet = roundPlayers.every(p => p.tee_id !== null && p.tee_id !== 0);
            if (!allSet) {
              alert("Please select a tee for every player before starting.");
              return;
            }
            setNeedsSetup(false);
          }}
          style={{
            width: "100%",
            padding: "20px",
            background: "#166534",
            color: "white",
            border: "none",
            borderRadius: "16px",
            fontWeight: 900,
            fontSize: "1.1rem",
            marginTop: "20px",
            cursor: "pointer",
          }}
        >
          START ROUND →
        </button>
      </div>
    );
  }

  // --- SCORECARD SCREEN ---
  const activeTeeId = roundPlayers[0]?.tee_id || 0;
  const currentHoleInfo = holesByTee[activeTeeId]?.find(h => h.hole_number === currentHole);

  return (
    <div style={{ padding: "15px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        {teamFilter && (
          <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: "#166534" }}>
            TEAM {teamFilter}
          </p>
        )}
        <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: "0.75rem", fontWeight: "bold" }}>
          PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS
        </p>
      </div>

      {/* Hole navigation dots */}
      <div style={{
        display: "flex",
        overflowX: "auto",
        gap: "6px",
        marginBottom: "20px",
        paddingBottom: "10px",
      }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hasScores = roundPlayers.some(rp => scores[rp.id]?.[h] != null);

          return (
            <button
              key={h}
              onClick={() => setCurrentHole(h)}
              style={{
                minWidth: "35px",
                height: "35px",
                borderRadius: "50%",
                border: h === currentHole ? "2px solid #166534" : "1px solid #e2e8f0",
                background: h === currentHole ? "#166534" : hasScores ? "#dcfce7" : "white",
                color: h === currentHole ? "white" : hasScores ? "#166534" : "#94a3b8",
                fontSize: "0.8rem",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              {h}
            </button>
          );
        })}
      </div>

      {/* Player score entry cards */}
      {roundPlayers.map(rp => {
        const playerTee = allTees.find(t => t.id === rp.tee_id);
        const teeColor = playerTee ? TEE_COLORS[playerTee.color] : null;
        const playerTotal = getPlayerTotal(rp.id);

        return (
          <div key={rp.id} style={{
            background: "white",
            padding: "12px 16px",
            borderRadius: "16px",
            border: "1px solid #f1f5f9",
            marginBottom: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{rp.display_name}</div>
              <div style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "flex", gap: "8px", alignItems: "center" }}>
                <span>CH: {rp.course_handicap ?? "?"}</span>
                {teeColor && (
                  <span style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: teeColor.bg,
                    border: "1px solid #cbd5e1",
                  }} />
                )}
                {playerTotal > 0 && (
                  <span style={{ color: "#166534" }}>Total: {playerTotal}</span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
              <button
                onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) - 1)}
                style={{
                  width: "44px", height: "44px", borderRadius: "10px",
                  border: "1px solid #e2e8f0", background: "#f8fafc",
                  fontSize: "20px", cursor: "pointer",
                }}
              >
                −
              </button>
              <div style={{
                fontSize: "1.8rem", fontWeight: 900,
                minWidth: "35px", textAlign: "center",
              }}>
                {scores[rp.id]?.[currentHole] || "—"}
              </div>
              <button
                onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || 4) + 1)}
                style={{
                  width: "44px", height: "44px", borderRadius: "10px",
                  border: "1px solid #e2e8f0", background: "#f8fafc",
                  fontSize: "20px", cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Navigation buttons */}
      <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
        <button
          onClick={() => setCurrentHole(h => Math.max(1, h - 1))}
          disabled={currentHole === 1}
          style={{
            flex: 1, padding: "18px", borderRadius: "12px",
            border: "1px solid #e2e8f0", background: "white",
            cursor: currentHole === 1 ? "default" : "pointer",
            opacity: currentHole === 1 ? 0.4 : 1,
          }}
        >
          ← Back
        </button>
        {currentHole < 18 ? (
          <button
            onClick={() => setCurrentHole(h => h + 1)}
            style={{
              flex: 2, padding: "18px", borderRadius: "12px",
              background: "#166534", color: "white", border: "none",
              fontWeight: 900, cursor: "pointer",
            }}
          >
            Next Hole →
          </button>
        ) : (
          <button
            onClick={async () => {
              if (!confirm("Finalize this round? Scores will be saved.")) return;
              setSaving(true);
              await supabase
                .from("rounds")
                .update({ is_complete: true })
                .eq("id", roundId);
              setSaving(false);
              alert("Round complete!");
            }}
            disabled={saving}
            style={{
              flex: 2, padding: "18px", borderRadius: "12px",
              background: "#b45309", color: "white", border: "none",
              fontWeight: 900, cursor: "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Finish Round ✓"}
          </button>
        )}
      </div>
    </div>
  );
}