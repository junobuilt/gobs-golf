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
  const [search, setSearch] = useState("");
  const [defaultTeeId, setDefaultTeeId] = useState<number>(0);
  const [teamCount, setTeamCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
    }
    load();
  }, []);

  const selectedIds = new Set(selected.map((s) => s.player.id));
  const filtered = players.filter(
    (p) =>
      !selectedIds.has(p.id) &&
      p.full_name.toLowerCase().includes(search.toLowerCase())
  );

  function addPlayer(player: Player) {
    setSelected((prev) => [
      ...prev,
      { player, tee_id: defaultTeeId, team_number: 1 },
    ]);
    setSearch("");
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

  function updateTeam(playerId: number, team: number) {
    setSelected((prev) =>
      prev.map((s) =>
        s.player.id === playerId ? { ...s, team_number: team } : s
      )
    );
  }

  function getTeeById(teeId: number) {
    return tees.find((t) => t.id === teeId);
  }

  async function startRound() {
    if (selected.length === 0) return;
    setSaving(true);

    // Create the round
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

    // Add players to the round
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
        round_id: round.id,
        player_id: s.player.id,
        tee_id: s.tee_id,
        team_number: s.team_number,
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

    // Navigate to scorecard
    router.push(`/round/${round.id}/scorecard`);
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <h2 className="page-title">New Round</h2>
      <p className="page-subtitle">
        Add the players in your group and assign tee colors
      </p>

      {/* Search to add players */}
      <div className="search-wrapper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="search-bar"
          placeholder="Search to add a player..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Search results dropdown */}
      {search.length > 0 && (
        <div style={{
          background: "var(--white)",
          borderRadius: "var(--card-radius)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          marginTop: "-8px",
          marginBottom: "12px",
          maxHeight: "200px",
          overflow: "auto",
          border: "1px solid rgba(0,0,0,0.08)",
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "14px 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              No matching players
            </div>
          ) : (
            filtered.slice(0, 8).map((player) => (
              <button
                key={player.id}
                onClick={() => addPlayer(player)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "14px 16px",
                  border: "none",
                  borderBottom: "1px solid var(--green-50)",
                  background: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.95rem",
                  textAlign: "left",
                  minHeight: "48px",
                }}
              >
                <span style={{ fontWeight: 600 }}>{player.full_name}</span>
                <span style={{
                  color: "var(--green-600)",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}>
                  + Add
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Selected players */}
      {selected.length > 0 && (
        <>
          <h3 style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.1rem",
            color: "var(--green-900)",
            marginBottom: "10px",
          }}>
            Today&apos;s Group ({selected.length})
          </h3>

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

            return (
              <div key={s.player.id} className="card" style={{ padding: "12px 14px" }}>
                <div className="flex-between" style={{ marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                      {s.player.display_name || s.player.full_name}
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      HCP Index: {s.player.handicap_index ?? "N/A"}
                      {ch !== null && ` → CH: ${ch}`}
                    </div>
                  </div>
                  <button
                    onClick={() => removePlayer(s.player.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--red-500)",
                      cursor: "pointer",
                      padding: "8px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {/* Tee picker */}
                  <div style={{ flex: 1 }}>
                    <label style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "block",
                      marginBottom: "4px",
                    }}>
                      Tee
                    </label>
                    <select
                      value={s.tee_id}
                      onChange={(e) => updateTee(s.player.id, Number(e.target.value))}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "2px solid var(--cream-dark)",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        background: "var(--white)",
                      }}
                    >
                      {tees.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.color}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Team picker */}
                  <div style={{ flex: 1 }}>
                    <label style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "block",
                      marginBottom: "4px",
                    }}>
                      Team
                    </label>
                    <select
                      value={s.team_number}
                      onChange={(e) => updateTeam(s.player.id, Number(e.target.value))}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "2px solid var(--cream-dark)",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        background: "var(--white)",
                      }}
                    >
                      {Array.from({ length: teamCount }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          Team #{n}
                        </option>
                      ))}
                      <option value={teamCount + 1}>
                        + New Team (#{teamCount + 1})
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Update team count when someone picks "New Team" */}
          {(() => {
            const maxTeam = Math.max(...selected.map((s) => s.team_number));
            if (maxTeam > teamCount) {
              setTimeout(() => setTeamCount(maxTeam), 0);
            }
            return null;
          })()}

          {/* Start round button */}
          <div className="mt-4">
            <button
              onClick={startRound}
              disabled={saving}
              className="btn btn-primary btn-large"
              style={{ opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Creating Round..." : `Start Round (${selected.length} players)`}
            </button>
          </div>
        </>
      )}

      {selected.length === 0 && search.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "48px", height: "48px", marginBottom: "12px", opacity: 0.4 }}>
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="23" y1="11" x2="17" y2="11" />
              <line x1="20" y1="8" x2="20" y2="14" />
            </svg>
            <p style={{ fontWeight: 600, marginBottom: "4px" }}>No players added yet</p>
            <p style={{ fontSize: "0.85rem" }}>
              Search above to add players to today&apos;s round
            </p>
          </div>
        </div>
      )}
    </div>
  );
}