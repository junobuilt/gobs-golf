"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Player = {
  id: number;
  full_name: string;
  display_name: string | null;
  handicap_index: number | null;
};

type Tee = {
  id: number;
  color: string;
  slope_rating: number;
  course_rating: number;
  par: number;
};

type SelectedPlayer = {
  player: Player;
  tee_id: number;
  team_number: number;
};

const TEE_COLORS: Record<string, { bg: string; text: string }> = {
  Blue:   { bg: "#1e40af", text: "#ffffff" },
  White:  { bg: "#f8fafc", text: "#000000" },
  Yellow: { bg: "#facc15", text: "#000000" },
};

function computeCourseHandicap(
  handicapIndex: number | null,
  slope: number,
  rating: number,
  par: number
): number | null {
  if (handicapIndex === null) return null;
  return Math.round(handicapIndex * slope / 113 + (rating - par));
}

export default function NewRoundPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [tees, setTees] = useState<Tee[]>([]);
  const [selected, setSelected] = useState<SelectedPlayer[]>([]);
  const [filter, setFilter] = useState("");
  const [defaultTeeId, setDefaultTeeId] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [existingRound, setExistingRound] = useState<{ id: number; teamCount: number } | null>(null);
  const [alreadyInRound, setAlreadyInRound] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function load() {
      const { data: playersData } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index")
        .eq("is_active", true)
        .order("full_name");
      setPlayers(playersData || []);

      const { data: teesData } = await supabase
        .from("tees")
        .select("id, color, slope_rating, course_rating, par")
        .order("sort_order");
      setTees(teesData || []);
      if (teesData && teesData.length > 0) {
        setDefaultTeeId(teesData[0].id);
      }

      // Check if a round already exists for today
      const today = new Date().toISOString().split("T")[0];
      const { data: todayRounds } = await supabase
        .from("rounds")
        .select("id")
        .eq("played_on", today)
        .eq("is_complete", false)
        .order("created_at", { ascending: false })
        .limit(1);

      if (todayRounds && todayRounds.length > 0) {
        const roundId = todayRounds[0].id;
        // Find the highest team number and which players are already in
        const { data: rps } = await supabase
          .from("round_players")
          .select("team_number, player_id")
          .eq("round_id", roundId);

        const maxTeam = rps && rps.length > 0
          ? Math.max(...rps.map((r: any) => r.team_number || 0))
          : 0;
        const playerIds = new Set((rps || []).map((r: any) => r.player_id));

        setExistingRound({ id: roundId, teamCount: maxTeam });
        setAlreadyInRound(playerIds as Set<number>);
      }

      setLoading(false);
    }
    load();
  }, []);

  const selectedIds = new Set(selected.map((s) => s.player.id));

  // Filter for the roster list — exclude already selected AND already in today's round
  const rosterPlayers = players.filter(
    (p) =>
      !selectedIds.has(p.id) &&
      !alreadyInRound.has(p.id) &&
      (filter === "" || p.full_name.toLowerCase().includes(filter.toLowerCase()))
  );

  function togglePlayer(player: Player) {
    if (selectedIds.has(player.id)) {
      setSelected((prev) => prev.filter((s) => s.player.id !== player.id));
    } else {
      setSelected((prev) => [
        ...prev,
        { player, tee_id: defaultTeeId, team_number: 1 },
      ]);
    }
  }

  function removePlayer(playerId: number) {
    setSelected((prev) => prev.filter((s) => s.player.id !== playerId));
  }

  function updateTee(playerId: number, teeId: number) {
    setSelected((prev) =>
      prev.map((s) =>
        s.player.id === playerId ? { ...s, tee_id: teeId } : s
      )
    );
  }

  function getTeeById(teeId: number) {
    return tees.find((t) => t.id === teeId);
  }

  async function startRound() {
    if (selected.length === 0) return;
    setSaving(true);

    let roundId: number;
    let teamNumber: number;

    if (existingRound) {
      // Join the existing round as the next team
      roundId = existingRound.id;
      teamNumber = existingRound.teamCount + 1;
    } else {
      // Create a new round
      const today = new Date().toISOString().split("T")[0];
      const { data: round, error: roundError } = await supabase
        .from("rounds")
        .insert({ course_id: 1, played_on: today, is_complete: false })
        .select("id")
        .single();

      if (roundError || !round) {
        alert("Error creating round: " + (roundError?.message || "Unknown"));
        setSaving(false);
        return;
      }
      roundId = round.id;
      teamNumber = 1;
    }

    const roundPlayers = selected.map((s) => {
      const tee = getTeeById(s.tee_id);
      const ch = tee
        ? computeCourseHandicap(
            s.player.handicap_index,
            tee.slope_rating,
            tee.course_rating,
            tee.par
          )
        : null;
      return {
        round_id: roundId,
        player_id: s.player.id,
        tee_id: s.tee_id,
        team_number: teamNumber,
        course_handicap: ch,
      };
    });

    const { error: rpError } = await supabase
      .from("round_players")
      .insert(roundPlayers);

    if (rpError) {
      alert("Error adding players: " + rpError.message);
      setSaving(false);
      return;
    }

    router.push(`/round/${roundId}/scorecard?team=${teamNumber}`);
  }

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      <h2 style={{ color: "#166534", fontWeight: 900, fontSize: "1.4rem", marginBottom: "4px" }}>
        Start a Scorecard
      </h2>
      <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "6px" }}>
        Tap players to add them to your group
      </p>

      {existingRound && (
        <div style={{
          background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px",
          padding: "10px 14px", marginBottom: "16px", fontSize: "0.8rem", color: "#1e40af",
        }}>
          <strong>Today&apos;s round already exists</strong> — your group will be added as Team {existingRound.teamCount + 1}.
          {alreadyInRound.size > 0 && (
            <span style={{ display: "block", marginTop: "4px", opacity: 0.8 }}>
              {alreadyInRound.size} player{alreadyInRound.size !== 1 ? "s" : ""} already assigned to other teams today.
            </span>
          )}
        </div>
      )}

      {/* Selected players section — shown at top when anyone is picked */}
      {selected.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{
            fontSize: "0.7rem", fontWeight: 800, color: "#166534",
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px",
          }}>
            Your Group ({selected.length})
          </div>

          {selected.map((s) => {
            const tee = getTeeById(s.tee_id);
            const ch = tee
              ? computeCourseHandicap(
                  s.player.handicap_index,
                  tee.slope_rating,
                  tee.course_rating,
                  tee.par
                )
              : null;
            const teeColors = tee ? TEE_COLORS[tee.color] || { bg: "#ccc", text: "#000" } : null;

            return (
              <div key={s.player.id} style={{
                background: "white",
                borderRadius: "16px",
                border: "1px solid #e2e8f0",
                padding: "14px 16px",
                marginBottom: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                      {s.player.display_name || s.player.full_name}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                      HCP: {s.player.handicap_index ?? "N/A"}
                      {ch !== null && <span style={{ color: "#166534", fontWeight: 700 }}> → CH: {ch}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => removePlayer(s.player.id)}
                    style={{
                      background: "none", border: "none", color: "#ef4444",
                      cursor: "pointer", padding: "8px", fontSize: "0.8rem", fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Tee color buttons */}
                <div style={{ display: "flex", gap: "6px" }}>
                  {tees.map((t) => {
                    const isSelected = s.tee_id === t.id;
                    const colors = TEE_COLORS[t.color] || { bg: "#ccc", text: "#000" };
                    return (
                      <button
                        key={t.id}
                        onClick={() => updateTee(s.player.id, t.id)}
                        style={{
                          flex: 1,
                          padding: "10px 4px",
                          borderRadius: "10px",
                          fontSize: "10px",
                          fontWeight: 900,
                          border: isSelected ? "3px solid #166534" : "1px solid #e2e8f0",
                          background: colors.bg,
                          color: colors.text,
                          textTransform: "uppercase",
                          opacity: isSelected ? 1 : 0.35,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {t.color}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Start round button */}
          <button
            onClick={startRound}
            disabled={saving}
            style={{
              width: "100%",
              padding: "18px",
              background: "#166534",
              color: "white",
              border: "none",
              borderRadius: "14px",
              fontWeight: 900,
              fontSize: "1.05rem",
              marginTop: "12px",
              cursor: "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Creating..." : existingRound
              ? `Join as Team ${existingRound.teamCount + 1} (${selected.length} players) →`
              : `Start Round (${selected.length} players) →`
            }
          </button>
        </div>
      )}

      {/* Roster — tap to select */}
      <div style={{
        fontSize: "0.7rem", fontWeight: 800, color: "#94a3b8",
        textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px",
      }}>
        All Players
      </div>

      {/* Optional filter for long roster */}
      <input
        type="text"
        placeholder="Filter names..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          fontSize: "0.9rem",
          marginBottom: "10px",
          fontFamily: "sans-serif",
          background: "#f8fafc",
          boxSizing: "border-box",
        }}
      />

      <div style={{
        background: "white",
        borderRadius: "14px",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}>
        {rosterPlayers.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
            {filter ? "No matching players" : "All players have been added"}
          </div>
        ) : (
          rosterPlayers.map((player, i) => (
            <button
              key={player.id}
              onClick={() => togglePlayer(player)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "14px 16px",
                border: "none",
                borderBottom: i < rosterPlayers.length - 1 ? "1px solid #f1f5f9" : "none",
                background: "none",
                cursor: "pointer",
                fontSize: "0.95rem",
                fontFamily: "sans-serif",
                textAlign: "left",
                minHeight: "48px",
              }}
            >
              <span style={{ fontWeight: 600, color: "#1e293b" }}>
                {player.full_name}
              </span>
              <span style={{
                color: "#16a34a",
                fontSize: "1.2rem",
                fontWeight: 700,
                lineHeight: 1,
              }}>
                +
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}