"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Player, MatrixRow, LeagueSettings } from "../page";
import DangerModal from "../components/DangerModal";

interface Props {
  allPlayers: Player[];
  matrix: MatrixRow[];
  settings: LeagueSettings;
  onSettingsChange: () => void;
}

const C = {
  navy: "#0c3057",
  midNavy: "#0f4a7a",
  green: "#2a7a3a",
  red: "#a32d2d",
  bg: "#f5f4f0",
  border: "rgba(0,0,0,0.08)",
  font: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} style={{
      width: "40px", height: "22px", borderRadius: "11px",
      background: value ? C.green : "#d1d5db",
      position: "relative", cursor: "pointer", flexShrink: 0,
      transition: "background 0.2s",
    }}>
      <div style={{
        width: "18px", height: "18px", borderRadius: "50%", background: "white",
        position: "absolute", top: "2px", left: value ? "20px" : "2px",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </div>
  );
}

type ToggleKey = "show_leaderboard" | "show_weekly_winners" | "two_ball_scoring";

export default function RoundSetup({ allPlayers, matrix, settings, onSettingsChange }: Props) {
  const isMobile = useIsMobile();

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [roster, setRoster] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Record<number, Player[]>>({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] });
  const [existingRoundId, setExistingRoundId] = useState<number | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [maxTeams, setMaxTeams] = useState(8);

  // "active" = round exists with scores in progress; "setup" = editing mode
  const [viewMode, setViewMode] = useState<"active" | "setup">("setup");

  // Mobile step state
  const [mobileStep, setMobileStep] = useState<"checkin" | "teams">("checkin");
  const [bottomSheetPlayer, setBottomSheetPlayer] = useState<Player | null>(null);

  // Suggest teams guard
  const [suggestModal, setSuggestModal] = useState(false);

  // Optimistic toggle state — updates immediately on click, then syncs after DB round-trip
  const [localToggles, setLocalToggles] = useState<Record<ToggleKey, boolean>>({
    show_leaderboard: settings["show_leaderboard"] === "true",
    show_weekly_winners: settings["show_weekly_winners"] === "true",
    two_ball_scoring: settings["two_ball_scoring"] === "true",
  });

  useEffect(() => {
    setLocalToggles({
      show_leaderboard: settings["show_leaderboard"] === "true",
      show_weekly_winners: settings["show_weekly_winners"] === "true",
      two_ball_scoring: settings["two_ball_scoring"] === "true",
    });
  }, [settings]);

  const loadRoundForDate = useCallback(async (date: string) => {
    setExistingRoundId(null);
    setIsComplete(false);
    setRoster([]);
    setTeams({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] });
    setMobileStep("checkin");
    setViewMode("setup");

    const { data: rounds } = await supabase
      .from("rounds").select("id, is_complete").eq("played_on", date)
      .order("created_at", { ascending: false }).limit(1);

    if (rounds && rounds.length > 0) {
      const round = rounds[0];
      setExistingRoundId(round.id);
      setIsComplete(round.is_complete);

      const { data: rps } = await supabase
        .from("round_players").select("id, player_id, team_number").eq("round_id", round.id);

      if (rps && rps.length > 0) {
        const loadedRoster: Player[] = [];
        const loadedTeams: Record<number, Player[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] };
        rps.forEach((rp: any) => {
          const player = allPlayers.find(p => p.id === rp.player_id);
          if (!player) return;
          loadedRoster.push(player);
          const tn = rp.team_number || 0;
          if (tn >= 1 && tn <= 8) loadedTeams[tn].push(player);
        });
        setRoster(loadedRoster);
        setTeams(loadedTeams);
        const usedTeams = Object.entries(loadedTeams).filter(([, ps]) => ps.length > 0).length;
        setMaxTeams(Math.max(usedTeams, 8));

        // Detect whether play has started (scores exist) → show active view
        if (usedTeams > 0) {
          const { count: scoreCount } = await supabase
            .from("scores")
            .select("id", { count: "exact", head: true })
            .in("round_player_id", rps.map((r: any) => r.id));
          if ((scoreCount ?? 0) > 0 || round.is_complete) {
            setViewMode("active");
          }
        }
      }
    }
  }, [allPlayers]);

  useEffect(() => {
    if (allPlayers.length > 0) loadRoundForDate(selectedDate);
  }, [selectedDate, allPlayers, loadRoundForDate]);

  const toggleSetting = async (key: ToggleKey) => {
    const newValue = !localToggles[key];
    setLocalToggles(prev => ({ ...prev, [key]: newValue }));
    const { data } = await supabase
      .from("league_settings")
      .update({ value: String(newValue) })
      .eq("key", key)
      .select();
    if (!data || data.length === 0) {
      await supabase.from("league_settings").insert({ key, value: String(newValue) });
    }
    onSettingsChange();
  };

  const toggleInRoster = (player: Player) => {
    if (roster.find(p => p.id === player.id)) {
      setRoster(roster.filter(p => p.id !== player.id));
      const newTeams = { ...teams };
      Object.keys(newTeams).forEach(n => {
        newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id);
      });
      setTeams(newTeams);
    } else {
      setRoster([...roster, player]);
    }
  };

  const assignToTeam = (player: Player, teamNum: number) => {
    const newTeams = { ...teams };
    Object.keys(newTeams).forEach(n => {
      newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id);
    });
    if (teamNum !== 0) newTeams[teamNum] = [...newTeams[teamNum], player];
    setTeams(newTeams);
    setBottomSheetPlayer(null);
  };

  const getCompatibility = (player: Player, teamNum: number): number => {
    return teams[teamNum].reduce((total, tm) => {
      const match = matrix.find(m =>
        (m.player_a === player.full_name && m.player_b === tm.full_name) ||
        (m.player_b === player.full_name && m.player_a === tm.full_name)
      );
      return total + (match?.times_played_together ?? 0);
    }, 0);
  };

  const checkScorecardInProgress = async (): Promise<boolean> => {
    if (!existingRoundId) return false;
    const { data: rpIds } = await supabase
      .from("round_players").select("id").eq("round_id", existingRoundId);
    if (!rpIds || rpIds.length === 0) return false;
    const { count } = await supabase
      .from("scores")
      .select("id", { count: "exact", head: true })
      .in("round_player_id", rpIds.map((r: any) => r.id));
    return (count ?? 0) > 0;
  };

  const handleSuggestTeams = async () => {
    const inProgress = await checkScorecardInProgress();
    if (inProgress) {
      setSuggestModal(true);
    } else {
      runSuggestTeams();
    }
  };

  const runSuggestTeams = () => {
    setSuggestModal(false);
    const checkedIn = [...roster];
    if (checkedIn.length < 2) return;
    const numTeams = Math.ceil(checkedIn.length / 4);
    const newTeams: Record<number, Player[]> = {};
    for (let i = 1; i <= 8; i++) newTeams[i] = [];

    checkedIn.forEach(player => {
      let bestTeam = 1;
      let bestScore = Infinity;
      for (let t = 1; t <= numTeams; t++) {
        if (newTeams[t].length >= 4) continue;
        const score = newTeams[t].reduce((sum, tm) => {
          const match = matrix.find(m =>
            (m.player_a === player.full_name && m.player_b === tm.full_name) ||
            (m.player_b === player.full_name && m.player_a === tm.full_name)
          );
          return sum + (match?.times_played_together ?? 0);
        }, 0);
        if (score < bestScore) { bestScore = score; bestTeam = t; }
      }
      newTeams[bestTeam] = [...newTeams[bestTeam], player];
    });
    setTeams(newTeams);
    setMaxTeams(Math.max(numTeams, 8));
  };

  const saveRound = async () => {
    const allAssigned = Object.values(teams).flat();
    if (allAssigned.length === 0) { alert("No players assigned to teams yet."); return; }
    setSaving(true);

    if (existingRoundId) {
      await supabase.from("round_players").delete().eq("round_id", existingRoundId);
      const assignments = Object.entries(teams).flatMap(([num, ps]) =>
        ps.map(p => ({ round_id: existingRoundId, player_id: p.id, team_number: parseInt(num), tee_id: null }))
      );
      const { error } = await supabase.from("round_players").insert(assignments);
      if (error) alert("Error saving teams: " + error.message);
    } else {
      const { data: round, error: rErr } = await supabase
        .from("rounds").insert({ played_on: selectedDate, course_id: 1 }).select().single();
      if (rErr) { alert("Error creating round: " + rErr.message); setSaving(false); return; }
      const assignments = Object.entries(teams).flatMap(([num, ps]) =>
        ps.map(p => ({ round_id: round.id, player_id: p.id, team_number: parseInt(num), tee_id: null }))
      );
      const { error } = await supabase.from("round_players").insert(assignments);
      if (error) alert("Error saving teams: " + error.message);
      else setExistingRoundId(round.id);
    }
    setSaving(false);
  };

  const doDeleteRound = async () => {
    if (!existingRoundId) return;
    setDeleteModal(false);
    setSaving(true);
    const { data: rpIds } = await supabase.from("round_players").select("id").eq("round_id", existingRoundId);
    if (rpIds && rpIds.length > 0) {
      await supabase.from("scores").delete().in("round_player_id", rpIds.map((r: any) => r.id));
    }
    await supabase.from("round_players").delete().eq("round_id", existingRoundId);
    await supabase.from("rounds").delete().eq("id", existingRoundId);
    setExistingRoundId(null);
    setIsComplete(false);
    setRoster([]);
    setTeams({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] });
    setViewMode("setup");
    setSaving(false);
  };

  const totalAssigned = Object.values(teams).flat().length;
  const unassigned = roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id));
  const teamsInUse = Object.entries(teams).filter(([, ps]) => ps.length > 0).length;
  const filteredPlayers = allPlayers.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.display_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const formatDate = (d: string) => {
    const date = new Date(d + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  };

  // ── Hero bar ─────────────────────────────────────────────────────────────
  const heroBar = (
    <div style={{
      background: `linear-gradient(135deg, ${C.navy} 0%, ${C.midNavy} 100%)`,
      padding: "20px 16px", color: "white",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <input
              type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
                color: "white", padding: "6px 10px", borderRadius: "8px",
                fontSize: "0.95rem", fontWeight: 600, fontFamily: C.font, cursor: "pointer",
              }}
            />
            {existingRoundId ? (
              <span style={{
                background: isComplete ? "#b45309" : C.green,
                padding: "4px 12px", borderRadius: "999px",
                fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase",
              }}>
                {isComplete ? "Complete" : "Active"}
              </span>
            ) : (
              <span style={{
                background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)",
                padding: "4px 12px", borderRadius: "999px",
                fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase",
              }}>
                No round yet
              </span>
            )}
          </div>
          <div style={{ marginTop: "6px", fontSize: "0.8rem", opacity: 0.7 }}>{formatDate(selectedDate)}</div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {viewMode === "active" ? (
            <>
              <button onClick={() => setViewMode("setup")} style={{
                padding: "8px 14px", borderRadius: "8px",
                border: "1.5px solid rgba(255,255,255,0.5)",
                background: "transparent", color: "white",
                fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: C.font,
              }}>
                Edit teams
              </button>
              {existingRoundId && (
                <button onClick={() => setDeleteModal(true)} disabled={saving} style={{
                  padding: "8px 14px", borderRadius: "8px",
                  border: "none", background: C.red, color: "white",
                  fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                  opacity: saving ? 0.6 : 1, fontFamily: C.font,
                }}>
                  Delete round
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={handleSuggestTeams} disabled={roster.length < 2} style={{
                padding: "8px 14px", borderRadius: "8px",
                border: "1.5px solid rgba(255,255,255,0.5)",
                background: "transparent", color: "white",
                fontSize: "0.82rem", fontWeight: 600,
                cursor: roster.length < 2 ? "not-allowed" : "pointer",
                opacity: roster.length < 2 ? 0.4 : 1, fontFamily: C.font,
              }}>
                Suggest teams
              </button>
              {existingRoundId && (
                <button onClick={() => setDeleteModal(true)} disabled={saving} style={{
                  padding: "8px 14px", borderRadius: "8px",
                  border: "none", background: C.red, color: "white",
                  fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                  opacity: saving ? 0.6 : 1, fontFamily: C.font,
                }}>
                  Delete round
                </button>
              )}
              <button onClick={saveRound} disabled={saving || totalAssigned === 0} style={{
                padding: "8px 16px", borderRadius: "8px",
                border: "none", background: C.green, color: "white",
                fontSize: "0.82rem", fontWeight: 700, cursor: "pointer",
                opacity: (saving || totalAssigned === 0) ? 0.5 : 1, fontFamily: C.font,
              }}>
                {saving ? "Saving…" : existingRoundId ? "Update teams" : "Create round"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        {[
          { label: "Checked In", value: `${roster.length}/${allPlayers.length}` },
          { label: "Teams", value: teamsInUse },
          { label: "On Bench", value: unassigned.length },
        ].map(stat => (
          <div key={stat.label} style={{
            background: "rgba(255,255,255,0.12)", borderRadius: "10px",
            padding: "8px 16px", textAlign: "center",
            border: "1px solid rgba(255,255,255,0.15)",
          }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{stat.value}</div>
            <div style={{ fontSize: "0.6rem", fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Settings bar ─────────────────────────────────────────────────────────
  const settingsBar = (
    <div style={{
      background: "white", borderBottom: `1px solid ${C.border}`,
      padding: "10px 16px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center",
    }}>
      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        League
      </span>
      {([
        { key: "show_leaderboard" as ToggleKey, label: "Show Leaderboard" },
        { key: "show_weekly_winners" as ToggleKey, label: "Show Weekly Winners" },
        { key: "two_ball_scoring" as ToggleKey, label: "2-ball Scoring" },
      ]).map(s => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
          onClick={() => toggleSetting(s.key)}>
          <Toggle value={localToggles[s.key]} onChange={() => toggleSetting(s.key)} />
          <span style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );

  // ── Active round view (read-only, shown when play is in progress) ─────────
  if (viewMode === "active") {
    const activeTeams = Object.entries(teams)
      .filter(([, ps]) => ps.length > 0)
      .sort(([a], [b]) => parseInt(a) - parseInt(b));

    return (
      <div style={{ fontFamily: C.font }}>
        {heroBar}
        {settingsBar}

        <div style={{ padding: "16px", maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Today's Teams
            </div>
            <button onClick={() => setViewMode("setup")} style={{
              padding: "7px 14px", borderRadius: "8px",
              border: `1.5px solid ${C.border}`, background: "white",
              color: C.navy, fontSize: "0.82rem", fontWeight: 600,
              cursor: "pointer", fontFamily: C.font,
            }}>
              Edit teams
            </button>
          </div>

          {activeTeams.map(([num, players]) => {
            const combinedHC = players.reduce((s, p) => s + (p.handicap_index ?? 0), 0);
            return (
              <div key={num} style={{
                background: "white", borderRadius: "10px",
                border: `1px solid ${C.border}`, marginBottom: "10px", overflow: "hidden",
              }}>
                <div style={{
                  background: C.navy, padding: "10px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ color: "white", fontWeight: 700, fontSize: "0.88rem" }}>Team {num}</span>
                    <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.6)" }}>HC {Math.round(combinedHC)}</span>
                  </div>
                  {existingRoundId && (
                    <Link
                      href={`/round/${existingRoundId}/scorecard?team=${num}`}
                      style={{
                        color: "white", fontSize: "0.78rem", fontWeight: 600,
                        textDecoration: "none", background: "rgba(255,255,255,0.15)",
                        padding: "4px 10px", borderRadius: "6px",
                        border: "1px solid rgba(255,255,255,0.25)",
                      }}
                    >
                      Open scorecard →
                    </Link>
                  )}
                </div>
                <div style={{ padding: "8px 14px" }}>
                  {players.map((p, pi) => (
                    <div key={p.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "6px 0",
                      borderBottom: pi < players.length - 1 ? `1px solid ${C.border}` : "none",
                    }}>
                      <span style={{ fontSize: "0.88rem", fontWeight: 500 }}>{p.display_name || p.full_name}</span>
                      <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                        {p.handicap_index != null ? `HC ${p.handicap_index}` : "–"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {activeTeams.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", color: "#9ca3af", fontSize: "0.88rem" }}>
              No teams assigned yet.
            </div>
          )}

          <button onClick={() => setViewMode("setup")} style={{
            width: "100%", marginTop: "8px", padding: "14px", borderRadius: "10px",
            border: `1.5px dashed ${C.border}`, background: "transparent",
            color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500,
            cursor: "pointer", fontFamily: C.font,
          }}>
            + Add or change teams
          </button>
        </div>

        {deleteModal && (
          <DangerModal
            title="Delete this round?"
            description={`This will permanently delete the round on ${formatDate(selectedDate)}, all team assignments, and all scores.`}
            confirmLabel="Delete round"
            onConfirm={doDeleteRound}
            onCancel={() => setDeleteModal(false)}
          />
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MOBILE LAYOUT
  // ─────────────────────────────────────────────────────────────────────────
  if (isMobile) {
    // Step 1: Check-in
    if (mobileStep === "checkin") {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", fontFamily: C.font }}>
          {heroBar}
          {settingsBar}

          {/* Search */}
          <div style={{ padding: "12px 16px", background: "white", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
                style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                placeholder="Search players…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%", padding: "9px 10px 9px 30px",
                  border: `1px solid ${C.border}`, borderRadius: "8px",
                  fontSize: "0.85rem", fontFamily: C.font, outline: "none", color: "#1f2937",
                }}
              />
            </div>
          </div>

          {/* Player list */}
          <div style={{ flex: 1, overflowY: "auto", background: C.bg, paddingBottom: "80px" }}>
            {filteredPlayers.map(player => {
              const checked = !!roster.find(r => r.id === player.id);
              return (
                <button
                  key={player.id}
                  onClick={() => toggleInRoster(player)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "14px",
                    padding: "14px 16px", background: "white",
                    borderBottom: `1px solid ${C.border}`, border: "none",
                    cursor: "pointer", textAlign: "left", fontFamily: C.font,
                    minHeight: "56px",
                  }}
                >
                  <div style={{
                    width: "22px", height: "22px", borderRadius: "6px", flexShrink: 0,
                    border: checked ? "none" : `2px solid #d1d5db`,
                    background: checked ? C.navy : "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.15s",
                  }}>
                    {checked && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ flex: 1, fontSize: "1rem", fontWeight: checked ? 600 : 400, color: checked ? C.navy : "#1f2937" }}>
                    {player.display_name || player.full_name}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "#9ca3af", fontWeight: 500 }}>
                    {player.handicap_index != null ? `HC ${player.handicap_index}` : "–"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Pinned bottom button */}
          <div style={{
            position: "fixed", bottom: "60px", left: 0, right: 0,
            padding: "12px 16px", background: "white",
            borderTop: `1px solid ${C.border}`,
            boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
          }}>
            <button
              onClick={() => setMobileStep("teams")}
              disabled={roster.length < 4}
              style={{
                width: "100%", padding: "15px", borderRadius: "12px",
                border: "none", background: roster.length >= 4 ? C.green : "#d1d5db",
                color: "white", fontSize: "1rem", fontWeight: 700,
                cursor: roster.length >= 4 ? "pointer" : "not-allowed",
                fontFamily: C.font, transition: "background 0.2s",
              }}
            >
              {roster.length < 4 ? `Check in ${4 - roster.length} more to continue` : `Assign to teams → (${roster.length} players)`}
            </button>
          </div>
        </div>
      );
    }

    // Step 2: Team assignment
    const teamNums = Array.from({ length: maxTeams }, (_, i) => i + 1);

    return (
      <div style={{ display: "flex", flexDirection: "column", fontFamily: C.font }}>
        {heroBar}
        {settingsBar}

        {/* Step header */}
        <div style={{
          padding: "12px 16px", background: "white", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <button onClick={() => setMobileStep("checkin")} style={{
            background: "none", border: "none", color: C.navy,
            fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: C.font,
          }}>
            ← Check-in
          </button>
          <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
            {unassigned.length > 0 ? `${unassigned.length} unassigned` : "All assigned ✓"}
          </span>
        </div>

        {/* Unassigned chips — sticky so it stays visible while scrolling teams */}
        {unassigned.length > 0 && (
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            padding: "12px 16px", background: "#eff6ff",
            borderBottom: "1px solid #dbeafe",
            display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center",
          }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Tap to assign:
            </span>
            {unassigned.map(p => (
              <button
                key={p.id}
                onClick={() => setBottomSheetPlayer(p)}
                style={{
                  padding: "6px 12px", borderRadius: "999px",
                  background: bottomSheetPlayer?.id === p.id ? C.navy : "white",
                  color: bottomSheetPlayer?.id === p.id ? "white" : "#1d4ed8",
                  border: `1.5px solid ${bottomSheetPlayer?.id === p.id ? C.navy : "#93c5fd"}`,
                  fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: C.font,
                }}
              >
                {p.display_name || p.full_name}
              </button>
            ))}
          </div>
        )}

        {/* Team cards */}
        <div style={{ padding: "12px 16px", background: C.bg, paddingBottom: "100px" }}>
          {teamNums.map(num => {
            const teamPlayers = teams[num] || [];
            const hasPlayers = teamPlayers.length > 0;
            const combinedHC = teamPlayers.reduce((s, p) => s + (p.handicap_index ?? 0), 0);

            return (
              <div key={num} style={{
                background: "white", borderRadius: "10px",
                border: `1px solid ${C.border}`, marginBottom: "10px", overflow: "hidden",
              }}>
                <div style={{
                  background: hasPlayers ? C.navy : "#f9fafb",
                  padding: "10px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: hasPlayers ? "white" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Team {num}
                  </span>
                  {hasPlayers && (
                    <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>
                      HC {Math.round(combinedHC)}
                    </span>
                  )}
                </div>

                <div style={{ padding: "10px 14px", minHeight: "64px" }}>
                  {teamPlayers.map(p => (
                    <div key={p.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "7px 8px", borderRadius: "6px", marginBottom: "4px", background: "#f8fafc",
                    }}>
                      <span style={{ fontSize: "0.88rem", fontWeight: 500 }}>
                        {p.display_name || p.full_name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                          {p.handicap_index != null ? `HC ${p.handicap_index}` : "–"}
                        </span>
                        <button onClick={() => assignToTeam(p, 0)} style={{
                          background: "none", border: "none", color: "#d1d5db",
                          cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0 2px",
                        }}>×</button>
                      </div>
                    </div>
                  ))}

                  {teamPlayers.length === 0 && (
                    <div style={{ color: "#d1d5db", fontSize: "0.8rem", fontStyle: "italic", padding: "4px 8px" }}>
                      No players yet
                    </div>
                  )}

                  {bottomSheetPlayer && (
                    <button
                      onClick={() => assignToTeam(bottomSheetPlayer, num)}
                      style={{
                        width: "100%", marginTop: "8px", padding: "8px",
                        borderRadius: "8px", border: `1.5px dashed ${C.green}`,
                        background: "#f0fdf4", color: C.green,
                        fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: C.font,
                      }}
                    >
                      + Add {bottomSheetPlayer.display_name || bottomSheetPlayer.full_name} here
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button onClick={() => setMaxTeams(t => t + 1)} style={{
            width: "100%", padding: "14px", borderRadius: "10px",
            border: `1.5px dashed ${C.border}`, background: "transparent",
            color: "#9ca3af", fontSize: "0.85rem", fontWeight: 500,
            cursor: "pointer", fontFamily: C.font,
          }}>
            + Add team
          </button>
        </div>

        {deleteModal && (
          <DangerModal
            title="Delete this round?"
            description={`This will permanently delete the round on ${formatDate(selectedDate)}, all team assignments, and all scores.`}
            confirmLabel="Delete round"
            onConfirm={doDeleteRound}
            onCancel={() => setDeleteModal(false)}
          />
        )}
        {suggestModal && (
          <DangerModal
            title="Teams have active scorecards"
            description="Some teams have already started scoring. Reassigning teams may break scorecards in progress. All existing scores will be preserved but team assignments will change."
            cannotBeUndone={false}
            confirmLabel="Reassign anyway"
            onConfirm={runSuggestTeams}
            onCancel={() => setSuggestModal(false)}
          />
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESKTOP LAYOUT
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", fontFamily: C.font }}>
      {heroBar}
      {settingsBar}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "0", minHeight: "600px" }}>

        {/* Left: player check-in */}
        <div style={{ borderRight: `1px solid ${C.border}`, background: "white", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 16px 10px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Players</span>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: C.navy }}>{roster.length}/{allPlayers.length}</span>
            </div>
            <div style={{ position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px 8px 30px",
                  border: `1px solid ${C.border}`, borderRadius: "8px",
                  fontSize: "0.82rem", fontFamily: C.font, outline: "none", color: "#1f2937",
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "8px" }}>
            {filteredPlayers.map(player => {
              const checked = !!roster.find(r => r.id === player.id);
              return (
                <button key={player.id} onClick={() => toggleInRoster(player)} style={{
                  width: "100%", textAlign: "left", padding: "9px 12px",
                  borderRadius: "8px", marginBottom: "3px",
                  border: checked ? `1.5px solid ${C.navy}` : `1px solid transparent`,
                  background: checked ? `${C.navy}10` : "transparent",
                  cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  fontFamily: C.font, transition: "background 0.1s",
                }}>
                  <span style={{ fontSize: "0.88rem", fontWeight: checked ? 600 : 400, color: checked ? C.navy : "#374151" }}>
                    {player.display_name || player.full_name}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#9ca3af", fontWeight: 500 }}>
                    {player.handicap_index != null ? `HC ${player.handicap_index}` : "–"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: team grid */}
        <div style={{ padding: "16px", background: C.bg }}>
          {roster.length > 0 && (
            <div style={{
              background: "white", borderRadius: "10px", border: `1px solid ${C.border}`,
              padding: "12px 16px", marginBottom: "16px",
              display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "52px",
            }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>Bench</span>
              {unassigned.length === 0 ? (
                <span style={{ fontSize: "0.82rem", color: "#d1d5db", fontStyle: "italic" }}>All players assigned</span>
              ) : unassigned.map(p => (
                <span key={p.id} style={{
                  background: "#eff6ff", color: "#1d4ed8",
                  padding: "4px 10px", borderRadius: "999px",
                  fontSize: "0.78rem", fontWeight: 600, border: "1px solid #dbeafe",
                }}>
                  {p.display_name || p.full_name}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "12px" }}>
            {Array.from({ length: maxTeams }, (_, i) => i + 1).map(num => {
              const teamPlayers = teams[num] || [];
              const hasPlayers = teamPlayers.length > 0;
              const combinedHC = teamPlayers.reduce((s, p) => s + (p.handicap_index ?? 0), 0);

              return (
                <div key={num} style={{
                  background: "white", borderRadius: "10px",
                  border: hasPlayers ? `1px solid ${C.border}` : `1.5px dashed ${C.border}`,
                  overflow: "hidden",
                }}>
                  <div style={{
                    background: hasPlayers ? C.navy : "#f9fafb", padding: "8px 12px",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: hasPlayers ? "white" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Team {num}
                    </span>
                    {hasPlayers && (
                      <span style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.65)", fontWeight: 500 }}>
                        HC {Math.round(combinedHC)}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "10px", minHeight: "100px" }}>
                    {teamPlayers.map(p => (
                      <div key={p.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "6px 8px", borderRadius: "6px", marginBottom: "4px",
                        background: "#f8fafc", fontSize: "0.82rem",
                      }}>
                        <span style={{ fontWeight: 500, color: "#1f2937" }}>{p.display_name || p.full_name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                            {p.handicap_index != null ? `HC ${p.handicap_index}` : "–"}
                          </span>
                          <button onClick={() => assignToTeam(p, 0)} style={{
                            background: "none", border: "none", color: "#d1d5db",
                            cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0 2px",
                          }}>×</button>
                        </div>
                      </div>
                    ))}
                    {teamPlayers.length === 0 && (
                      <div style={{ color: "#d1d5db", fontSize: "0.78rem", fontStyle: "italic", padding: "6px 8px" }}>Drop players here</div>
                    )}
                    {unassigned.length > 0 && (
                      <select value="" onChange={e => {
                        const player = unassigned.find(u => u.id === parseInt(e.target.value));
                        if (player) assignToTeam(player, num);
                      }} style={{
                        width: "100%", marginTop: "8px", padding: "6px 8px",
                        fontSize: "0.78rem", borderRadius: "6px",
                        border: `1px solid ${C.border}`, background: "#f8fafc",
                        cursor: "pointer", color: "#374151", fontFamily: C.font,
                      }}>
                        <option value="" disabled>+ Add player</option>
                        {unassigned.map(u => {
                          const conflict = getCompatibility(u, num);
                          return (
                            <option key={u.id} value={u.id}>
                              {u.display_name || u.full_name}{conflict > 0 ? ` (${conflict}× together)` : ""}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}

            <button onClick={() => setMaxTeams(t => t + 1)} style={{
              borderRadius: "10px", border: `1.5px dashed ${C.border}`,
              background: "transparent", cursor: "pointer", minHeight: "140px",
              color: "#9ca3af", fontSize: "0.82rem", fontWeight: 500, fontFamily: C.font,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }}>
              <span style={{ fontSize: "18px", lineHeight: 1 }}>+</span> Add team
            </button>
          </div>
        </div>
      </div>

      {deleteModal && (
        <DangerModal
          title="Delete this round?"
          description={`This will permanently delete the round on ${formatDate(selectedDate)}, all team assignments, and all scores recorded for it.`}
          confirmLabel="Delete round"
          onConfirm={doDeleteRound}
          onCancel={() => setDeleteModal(false)}
        />
      )}
      {suggestModal && (
        <DangerModal
          title="Teams have active scorecards"
          description="Some teams have already started scoring. Reassigning teams may break scorecards in progress. All existing scores will be preserved but team assignments will change."
          cannotBeUndone={false}
          confirmLabel="Reassign anyway"
          onConfirm={runSuggestTeams}
          onCancel={() => setSuggestModal(false)}
        />
      )}
    </div>
  );
}
