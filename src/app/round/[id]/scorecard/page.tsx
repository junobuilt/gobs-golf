"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import DangerModal from "@/app/thomas-admin/components/DangerModal";
import {
  computeCourseHandicap,
  computeHoleResult,
  computeRoundResult,
  getHandicapStrokes,
} from "@/lib/scoring";
import type { HoleInfo as EngineHoleInfo, Format } from "@/lib/scoring";
import ScorecardLockNotice from "@/components/format/ScorecardLockNotice";

// --- TYPES ---
interface RoundPlayer {
  id: number;
  tee_id: number | null;
  display_name: string;
  handicap_index: number | null;
  course_handicap: number | null;
}

interface Tee {
  id: number;
  color: string;
  slope_rating: number;
  course_rating: number;
  par: number;
}

interface HoleInfo {
  hole_number: number;
  par: number;
  yardage: number;
  stroke_index: number;
}

const TEE_COLORS: Record<string, { bg: string; text: string }> = {
  Blue:   { bg: "#1e40af", text: "#ffffff" },
  White:  { bg: "#f8fafc", text: "#000000" },
  Yellow: { bg: "#facc15", text: "#000000" },
};

export default function ScorecardPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = params.id as string;

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  const [allTees, setAllTees] = useState<Tee[]>([]);
  const [holesByTee, setHolesByTee] = useState<Record<number, HoleInfo[]>>({});
  const [scores, setScores] = useState<Record<number, Record<number, number>>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(true);
  const [roundFormat, setRoundFormat] = useState<Format | null>(null);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endRoundModal, setEndRoundModal] = useState(false);
  const [removePlayerModal, setRemovePlayerModal] = useState<number | null>(null);

  // Inline handicap entry for players without one
  const [tempHandicaps, setTempHandicaps] = useState<Record<number, string>>({});

  // Per-hole manual overrides: which 2 round_player ids count
  const [countingOverrides, setCountingOverrides] = useState<Record<number, number[]>>({});

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      const { data: roundRow } = await supabase
        .from("rounds")
        .select("format, is_complete")
        .eq("id", roundId)
        .maybeSingle();
      if (roundRow) {
        setRoundFormat((roundRow.format ?? null) as Format | null);
        setIsRoundComplete(!!roundRow.is_complete);
      }

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

      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase
        .from("round_players")
        .select(`id, tee_id, course_handicap, players ( full_name, display_name, handicap_index )`)
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

        const allSet = playersData.every(p => p.tee_id !== null && p.tee_id !== 0);
        setNeedsSetup(!allSet);

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

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    const tee = allTees.find(t => t.id === teeId);
    if (!player || !tee) return;

    const hcIndex = player.handicap_index ?? (tempHandicaps[rpId] !== undefined ? parseFloat(tempHandicaps[rpId]) : null);
    const newCH = computeCourseHandicap(hcIndex, tee.slope_rating, tee.course_rating, tee.par);

    setRoundPlayers(current =>
      current.map(p => p.id === rpId ? { ...p, tee_id: teeId, course_handicap: newCH } : p)
    );

    await supabase.from("round_players").update({ tee_id: teeId, course_handicap: newCH }).eq("id", rpId);

    if (!holesByTee[teeId]) {
      const { data: h } = await supabase
        .from("holes")
        .select("hole_number, par, yardage, stroke_index")
        .eq("tee_id", teeId)
        .order("hole_number");
      setHolesByTee(prev => ({ ...prev, [teeId]: (h || []) as HoleInfo[] }));
    }
  };

  const applyTempHandicap = async (rpId: number, teeId: number | null) => {
    const raw = tempHandicaps[rpId];
    if (!raw || raw.trim() === "") return;
    const hcIndex = parseFloat(raw);
    if (isNaN(hcIndex)) return;

    let newCH: number | null = null;
    if (teeId) {
      const tee = allTees.find(t => t.id === teeId);
      if (tee) newCH = computeCourseHandicap(hcIndex, tee.slope_rating, tee.course_rating, tee.par);
    }

    setRoundPlayers(current =>
      current.map(p => p.id === rpId ? { ...p, handicap_index: hcIndex, course_handicap: newCH } : p)
    );
    if (newCH !== null) {
      await supabase.from("round_players").update({ course_handicap: newCH }).eq("id", rpId);
    }
    // Persist HC index to player record (best-effort)
    const { data: playerRef } = await supabase
      .from("round_players").select("player_id").eq("id", rpId).single();
    if (playerRef) {
      await supabase.from("players").update({ handicap_index: hcIndex }).eq("id", playerRef.player_id);
    }
  };

  const setScore = async (rpId: number, hole: number, strokes: number) => {
    if (strokes < 1 || strokes > 20) return;
    setScores(prev => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));
    // Clear manual override so best-2 recalculates from the new score
    setCountingOverrides(prev => {
      const next = { ...prev };
      delete next[hole];
      return next;
    });

    const { data: exists } = await supabase
      .from("scores").select("id").eq("round_player_id", rpId).eq("hole_number", hole).maybeSingle();

    if (exists) {
      await supabase.from("scores").update({ strokes }).eq("id", exists.id);
    } else {
      await supabase.from("scores").insert({ round_player_id: rpId, hole_number: hole, strokes });
    }
  };

  const removePlayer = async (rpId: number) => {
    await supabase.from("round_players").update({ team_number: 0 }).eq("id", rpId);
    setRoundPlayers(prev => prev.filter(p => p.id !== rpId));
    setRemovePlayerModal(null);
  };

  // --- SCORING HELPERS (engine-backed) ---

  const engineHole = (holeNumber: number): EngineHoleInfo | null => {
    const activeTeeId = roundPlayers[0]?.tee_id || 0;
    const h = holesByTee[activeTeeId]?.find(hi => hi.hole_number === holeNumber);
    return h ? { holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index } : null;
  };

  const computeHoleFor = (holeNumber: number, mode: "gross" | "net") => {
    const hole = engineHole(holeNumber);
    if (!hole) return null;
    const override = countingOverrides[holeNumber];
    return computeHoleResult({
      format: "2_ball",
      formatConfig: { basis: mode, best_n: 2, override_holes: [] },
      hole,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        grossScore: scores[rp.id]?.[holeNumber] ?? null,
        courseHandicap: rp.course_handicap,
      })),
      manualContributors: override ? override.map(String) : undefined,
    });
  };

  const getNetScore = (rp: RoundPlayer, holeNumber: number): number | null => {
    const result = computeHoleFor(holeNumber, "net");
    if (!result) {
      const gross = scores[rp.id]?.[holeNumber];
      return gross == null ? null : gross;
    }
    return result.perPlayer.find(p => p.playerId === String(rp.id))?.netScore ?? null;
  };

  // Returns the ids of the two players whose net scores count on this hole.
  // Respects manual overrides. Returns [] if fewer than 2 have scored.
  const getCountingPlayerIds = (holeNumber: number): number[] => {
    const result = computeHoleFor(holeNumber, "net");
    if (!result) return [];
    return result.contributingPlayerIds.map(id => Number(id));
  };

  // Detect whether the auto-selected Ball 1 or Ball 2 involves a tie.
  const getTieInfo = (holeNumber: number): { tiedForBall1: boolean; tiedForBall2: boolean } => {
    if (countingOverrides[holeNumber]) return { tiedForBall1: false, tiedForBall2: false };
    const result = computeHoleFor(holeNumber, "net");
    if (!result) return { tiedForBall1: false, tiedForBall2: false };
    const nets = result.perPlayer
      .filter(p => p.netScore != null)
      .map(p => p.netScore as number)
      .sort((a, b) => a - b);
    if (nets.length < 3) return { tiedForBall1: false, tiedForBall2: false };
    const tiedForBall1 = nets[0] === nets[2];
    const tiedForBall2 = !tiedForBall1 && nets[1] === nets[2];
    return { tiedForBall1, tiedForBall2 };
  };

  const getBest2ForHole = (holeNumber: number, mode: "gross" | "net"): number | null => {
    return computeHoleFor(holeNumber, mode)?.teamScore ?? null;
  };

  const buildRoundInput = (mode: "gross" | "net") => {
    const activeTeeId = roundPlayers[0]?.tee_id || 0;
    const holes: EngineHoleInfo[] = (holesByTee[activeTeeId] || []).map(h => ({
      holeNumber: h.hole_number,
      par: h.par,
      strokeIndex: h.stroke_index,
    }));
    const manualContributors: Record<number, string[]> = {};
    for (const [hn, ids] of Object.entries(countingOverrides)) {
      manualContributors[Number(hn)] = ids.map(String);
    }
    return computeRoundResult({
      format: "2_ball",
      formatConfig: { basis: mode, best_n: 2, override_holes: [] },
      holes,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        courseHandicap: rp.course_handicap,
        grossScores: scores[rp.id] || {},
      })),
      manualContributors,
    });
  };

  const getTeamTotal = (mode: "gross" | "net"): number => {
    return buildRoundInput(mode).teamScore ?? 0;
  };

  const getTeamParTotal = (): number => {
    return buildRoundInput("net").teamParAtScored;
  };

  const getPlayerTotal = (rpId: number) => {
    const playerScores = scores[rpId];
    if (!playerScores) return 0;
    return Object.values(playerScores).reduce((sum, s) => sum + s, 0);
  };

  const holesWithTeamScores = (): number => {
    return buildRoundInput("net").holesScored;
  };

  const toggleOverride = (holeNumber: number, rpId: number) => {
    const current = countingOverrides[holeNumber] ?? getCountingPlayerIds(holeNumber);
    let next: number[];
    if (current.includes(rpId)) {
      // Replace with next best scorer not already counting
      const netScores = roundPlayers
        .filter(p => !current.includes(p.id) || p.id === rpId)
        .map(p => ({ id: p.id, net: getNetScore(p, holeNumber) ?? Infinity }))
        .sort((a, b) => a.net - b.net);
      const replacement = netScores.find(s => !current.includes(s.id));
      if (!replacement) return;
      next = current.map(id => id === rpId ? replacement.id : id);
    } else {
      // Swap out the higher of the two counting scores
      const higherIdx = current.length < 2 ? 0 :
        ((getNetScore(roundPlayers.find(p => p.id === current[0])!, holeNumber) ?? 0) >
          (getNetScore(roundPlayers.find(p => p.id === current[1])!, holeNumber) ?? 0) ? 0 : 1);
      next = [...current];
      next[higherIdx] = rpId;
    }
    setCountingOverrides(prev => ({ ...prev, [holeNumber]: next }));
  };

  // Check if all active teams have ≥2 players with 18 hole scores before marking complete.
  const finishRound = async () => {
    setEndRoundModal(false);
    setSaving(true);

    const { data: allRPs } = await supabase
      .from("round_players")
      .select("id, team_number")
      .eq("round_id", roundId)
      .gt("team_number", 0);

    let allComplete = false;
    if (allRPs && allRPs.length > 0) {
      const teamGroups: Record<number, number[]> = {};
      allRPs.forEach((rp: any) => {
        if (!teamGroups[rp.team_number]) teamGroups[rp.team_number] = [];
        teamGroups[rp.team_number].push(rp.id);
      });

      const { data: allScores } = await supabase
        .from("scores")
        .select("round_player_id, hole_number")
        .in("round_player_id", allRPs.map((r: any) => r.id));

      const scoreCounts: Record<number, number> = {};
      allScores?.forEach((s: any) => {
        scoreCounts[s.round_player_id] = (scoreCounts[s.round_player_id] || 0) + 1;
      });

      allComplete = Object.values(teamGroups).every(rpIds =>
        rpIds.filter(id => (scoreCounts[id] || 0) >= 18).length >= 2
      );
    }

    if (allComplete) {
      await supabase.from("rounds").update({ is_complete: true }).eq("id", roundId);
    }

    setSaving(false);
    router.push(`/round/${roundId}/summary`);
  };

  // --- LOADING ---
  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading Round…</div>;
  }

  // --- LOCKED: format not yet picked ---
  if (roundFormat === null && !isRoundComplete) {
    return (
      <div style={{ padding: "20px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif" }}>
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          {teamFilter && (
            <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: "#0c3057" }}>TEAM {teamFilter}</p>
          )}
        </div>
        <ScorecardLockNotice />
      </div>
    );
  }

  // --- TEE SELECTION SCREEN ---
  if (needsSetup) {
    return (
      <div style={{ padding: "20px", paddingBottom: "100px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif" }}>
        <h2 style={{ textAlign: "center", color: "#0c3057", fontWeight: 900, marginBottom: "4px" }}>
          Tee Selection
        </h2>
        <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#64748b", marginBottom: "24px" }}>
          {teamFilter ? `Confirm tees for Team ${teamFilter}` : "Confirm tees for each player"}
        </p>

        {roundPlayers.map(rp => {
          const noHC = rp.handicap_index == null;
          const applyDisabled = !tempHandicaps[rp.id] || tempHandicaps[rp.id].trim() === "";
          return (
            <div key={rp.id} style={{
              background: "white", padding: "20px", borderRadius: "24px",
              border: `1px solid ${noHC ? "#fcd34d" : "#e2e8f0"}`, marginBottom: "16px",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: noHC ? "12px" : "16px", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "#1e293b" }}>{rp.display_name}</span>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "2px" }}>
                    Handicap Index: {rp.handicap_index ?? "Not on file"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "block" }}>Strokes</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 900, color: "#0c3057" }}>
                    {rp.course_handicap !== null ? rp.course_handicap : "?"}
                  </span>
                </div>
              </div>

              {/* Inline HC prompt */}
              {noHC && (
                <div style={{
                  background: "#fef9c3", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px",
                  border: "1px solid #fde68a",
                }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#92400e", marginBottom: "6px" }}>
                    No handicap on file for {rp.display_name}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Enter Strokes index"
                      value={tempHandicaps[rp.id] ?? ""}
                      onChange={e => setTempHandicaps(prev => ({ ...prev, [rp.id]: e.target.value }))}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: "8px",
                        border: "1px solid #fcd34d", fontSize: "0.85rem",
                        fontFamily: "sans-serif", outline: "none",
                      }}
                    />
                    <button
                      onClick={() => applyTempHandicap(rp.id, rp.tee_id)}
                      disabled={applyDisabled}
                      style={{
                        padding: "6px 14px", borderRadius: "8px", border: "none",
                        background: "#0c3057", color: "white", fontSize: "0.82rem",
                        fontWeight: 700, cursor: applyDisabled ? "default" : "pointer",
                        opacity: applyDisabled ? 0.5 : 1,
                      }}
                    >
                      Apply
                    </button>
                    <span style={{ fontSize: "0.72rem", color: "#92400e" }}>or play gross</span>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px" }}>
                {allTees.map(t => {
                  const isSelected = rp.tee_id === t.id;
                  const colors = TEE_COLORS[t.color] || { bg: "#ccc", text: "#000" };
                  return (
                    <button key={t.id} onClick={() => updatePlayerTee(rp.id, t.id)} style={{
                      flex: 1, padding: "14px 4px", borderRadius: "12px", fontSize: "10px", fontWeight: 900,
                      border: isSelected ? "4px solid #0c3057" : "1px solid #e2e8f0",
                      background: colors.bg, color: colors.text, textTransform: "uppercase",
                      opacity: isSelected ? 1 : 0.4, transform: isSelected ? "scale(1.05)" : "scale(1)",
                      transition: "all 0.15s ease", cursor: "pointer",
                    }}>
                      {t.color}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button onClick={() => {
          if (!roundPlayers.every(p => p.tee_id !== null && p.tee_id !== 0)) {
            alert("Please select a tee for every player before starting.");
            return;
          }
          setNeedsSetup(false);
        }} style={{
          width: "100%", padding: "20px", background: "#0c3057", color: "white",
          border: "none", borderRadius: "16px", fontWeight: 900, fontSize: "1.1rem",
          marginTop: "20px", cursor: "pointer",
        }}>
          START ROUND →
        </button>
      </div>
    );
  }

  // --- SCORECARD ---
  const activeTeeId = roundPlayers[0]?.tee_id || 0;
  const currentHoleInfo = holesByTee[activeTeeId]?.find(h => h.hole_number === currentHole);
  const teamGross = getTeamTotal("gross");
  const teamNet = getTeamTotal("net");
  const teamPar = getTeamParTotal();
  const scoredHoles = holesWithTeamScores();
  const countingIds = getCountingPlayerIds(currentHole);
  const { tiedForBall1, tiedForBall2 } = getTieInfo(currentHole);
  const playerToRemove = removePlayerModal !== null ? roundPlayers.find(p => p.id === removePlayerModal) : null;

  return (
    <div style={{ padding: "15px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        {teamFilter && (
          <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: "#0c3057" }}>TEAM {teamFilter}</p>
        )}
        <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: "0.75rem", fontWeight: "bold" }}>
          PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS
        </p>
      </div>

      {/* Team score summary bar */}
      {scoredHoles > 0 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <div style={{ flex: 1, background: "#1e40af", borderRadius: "12px", padding: "10px 14px", color: "white", textAlign: "center" }}>
            <div style={{ fontSize: "0.6rem", fontWeight: 800, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>Team Net</div>
            <div style={{ fontSize: "2rem", fontWeight: 900 }}>
              {teamNet === teamPar ? "E" : teamNet > teamPar ? `+${teamNet - teamPar}` : `−${teamPar - teamNet}`}
            </div>
          </div>
        </div>
      )}

      {/* Hole navigation dots */}
      <div style={{ display: "flex", overflowX: "auto", gap: "6px", marginBottom: "20px", paddingBottom: "10px" }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hasScores = roundPlayers.some(rp => scores[rp.id]?.[h] != null);
          const hasOverride = !!countingOverrides[h];
          return (
            <button key={h} onClick={() => setCurrentHole(h)} style={{
              minWidth: "35px", height: "35px", borderRadius: "50%",
              border: h === currentHole ? "2px solid #0c3057" : hasOverride ? "2px solid #f59e0b" : "1px solid #e2e8f0",
              background: h === currentHole ? "#0c3057" : hasScores ? "#dbeafe" : "white",
              color: h === currentHole ? "white" : hasScores ? "#1e40af" : "#94a3b8",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer",
            }}>
              {h}
            </button>
          );
        })}
      </div>

      {/* Tie notices */}
      {(tiedForBall1 || tiedForBall2) && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px",
          padding: "8px 12px", marginBottom: "10px", fontSize: "0.75rem",
          color: "#92400e", fontWeight: 600,
        }}>
          {tiedForBall1
            ? "Tied for Ball 1 — tap a card to override which balls count"
            : "Tied for Ball 2 — tap a card to override which balls count"}
        </div>
      )}

      {/* Player score entry cards */}
      {roundPlayers.map(rp => {
        const playerTee = allTees.find(t => t.id === rp.tee_id);
        const teeColor = playerTee ? TEE_COLORS[playerTee.color] : null;
        const playerTotal = getPlayerTotal(rp.id);
        const gross = scores[rp.id]?.[currentHole];
        const net = getNetScore(rp, currentHole);
        const holeInfo = holesByTee[rp.tee_id || 0]?.find(h => h.hole_number === currentHole);
        const hcpStrokes = holeInfo ? getHandicapStrokes(rp.course_handicap, holeInfo.stroke_index) : 0;

        const isCounting = countingIds.includes(rp.id);
        const countingRank = countingIds.indexOf(rp.id); // 0 = Ball 1, 1 = Ball 2

        const countingBorderColor = countingRank === 0 ? "#0c3057" : "#1e40af";
        const countingBg = countingRank === 0 ? "#eff6ff" : "#eff6ff";

        const isTied = isCounting && ((countingRank === 0 && tiedForBall1) || (countingRank === 1 && tiedForBall2));

        return (
          <div
            key={rp.id}
            onClick={() => gross != null ? toggleOverride(currentHole, rp.id) : undefined}
            style={{
              background: isCounting ? countingBg : "white",
              padding: "12px 16px", borderRadius: "16px",
              border: isCounting ? `2px solid ${countingBorderColor}` : "1px solid #f1f5f9",
              marginBottom: "10px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: gross != null ? "pointer" : "default",
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <span
                  style={{ fontWeight: 800, fontSize: "0.95rem" }}
                  onClick={e => { e.stopPropagation(); setRemovePlayerModal(rp.id); }}
                >
                  {rp.display_name}
                </span>
                {isCounting && !isTied && (
                  <span style={{
                    fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px", borderRadius: "999px",
                    background: countingBorderColor, color: "white", textTransform: "uppercase",
                  }}>
                    {countingRank === 0 ? "Ball 1" : "Ball 2"}
                  </span>
                )}
                {isTied && (
                  <span style={{
                    fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px", borderRadius: "999px",
                    background: "#f59e0b", color: "white", textTransform: "uppercase",
                  }}>
                    Tied
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "2px" }}>
                <span>Strokes: {rp.course_handicap ?? "?"}</span>
                {teeColor && (
                  <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: teeColor.bg, border: "1px solid #cbd5e1" }} />
                )}
                {gross != null && net != null && net !== gross && (
                  <span style={{ color: "#0c3057" }}>Net: {net}</span>
                )}
                {playerTotal > 0 && (
                  <span style={{ color: "#64748b" }}>Tot: {playerTotal}</span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "15px" }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || (holeInfo?.par ?? 4)) - 1)}
                style={{ width: "44px", height: "44px", borderRadius: "10px", border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: "20px", cursor: "pointer" }}
              >
                −
              </button>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "35px" }}>
                <div style={{ height: "8px", display: "flex", gap: "3px", alignItems: "center", marginBottom: "2px" }}>
                  {Array.from({ length: hcpStrokes }).map((_, i) => (
                    <span key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#1e40af" }} />
                  ))}
                </div>
                <div style={{ fontSize: "1.8rem", fontWeight: 900, textAlign: "center" }}>
                  {scores[rp.id]?.[currentHole] || "—"}
                </div>
              </div>
              <button
                onClick={() => setScore(rp.id, currentHole, (scores[rp.id]?.[currentHole] || (holeInfo?.par ?? 4)) + 1)}
                style={{ width: "44px", height: "44px", borderRadius: "10px", border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: "20px", cursor: "pointer" }}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Tap hint when scores are entered */}
      {countingIds.length >= 2 && !tiedForBall1 && !tiedForBall2 && (
        <p style={{ textAlign: "center", fontSize: "0.68rem", color: "#94a3b8", margin: "6px 0 0" }}>
          Tap a player card to override which balls count
        </p>
      )}

      {/* Navigation buttons */}
      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h - 1))} disabled={currentHole === 1}
          style={{
            flex: 1, padding: "18px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white",
            cursor: currentHole === 1 ? "default" : "pointer", opacity: currentHole === 1 ? 0.4 : 1,
            fontFamily: "sans-serif",
          }}>
          ← Back
        </button>
        {currentHole < 18 ? (
          <button onClick={() => setCurrentHole(h => h + 1)} style={{
            flex: 2, padding: "18px", borderRadius: "12px", background: "#0c3057",
            color: "white", border: "none", fontWeight: 900, cursor: "pointer", fontFamily: "sans-serif",
          }}>
            Next Hole →
          </button>
        ) : (
          <button onClick={() => setEndRoundModal(true)} disabled={saving} style={{
            flex: 2, padding: "18px", borderRadius: "12px", background: "#b45309",
            color: "white", border: "none", fontWeight: 900, cursor: "pointer",
            opacity: saving ? 0.6 : 1, fontFamily: "sans-serif",
          }}>
            {saving ? "Saving…" : "Finish Round ✓"}
          </button>
        )}
      </div>

      {/* End round early link */}
      {currentHole < 18 && (
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <button
            onClick={() => setEndRoundModal(true)}
            style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "0.78rem", cursor: "pointer", textDecoration: "underline" }}
          >
            End round early
          </button>
        </div>
      )}

      {endRoundModal && (
        <DangerModal
          title="Finalize this round?"
          description="This will save all scores. If all teams have completed 18 holes, the round will be marked complete."
          cannotBeUndone={false}
          confirmLabel="Finish Round"
          onConfirm={finishRound}
          onCancel={() => setEndRoundModal(false)}
        />
      )}

      {removePlayerModal !== null && playerToRemove && (
        <DangerModal
          title={`Remove ${playerToRemove.display_name}?`}
          description={`${playerToRemove.display_name} will be removed from this team's scorecard. Their scores will not be deleted.`}
          cannotBeUndone={false}
          confirmLabel="Remove from round"
          onConfirm={() => removePlayer(removePlayerModal)}
          onCancel={() => setRemovePlayerModal(null)}
        />
      )}
    </div>
  );
}
