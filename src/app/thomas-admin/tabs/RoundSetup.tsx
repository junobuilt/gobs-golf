"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Player, MatrixRow } from "../page";
import DangerModal from "../components/DangerModal";
import { getTeamColor } from "@/lib/teamColors";
import FormatNotSetBanner from "@/components/format/FormatNotSetBanner";
import { roundNeedsFormat } from "@/lib/format/helpers";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Format } from "@/lib/scoring/types";

interface Props {
  allPlayers: Player[];
  matrix: MatrixRow[];
}

const C = {
  navy: "#0b2d50",
  red: "#c0392b",
  bg: "#f2f1ed",
  border: "rgba(0,0,0,0.08)",
  gold: "#e8a800",
  pool: "#1a5a8c",
  font: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

type ViewMode = "none" | "active" | "edit";
type TeamScoreStatus = "not_started" | "in_progress";

export default function RoundSetup({ allPlayers }: Props) {
  const isMobile = useIsMobile();

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [roster, setRoster] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Record<number, Player[]>>({});
  const [existingRoundId, setExistingRoundId] = useState<number | null>(null);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [roundFormat, setRoundFormat] = useState<Format | null>(null);
  const [teamScoreStatus, setTeamScoreStatus] = useState<Record<number, TeamScoreStatus>>({});
  const [maxTeams, setMaxTeams] = useState(8);
  const [viewMode, setViewMode] = useState<ViewMode>("none");
  const [mobileStep, setMobileStep] = useState<"checkin" | "teams">("checkin");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [bottomSheetPlayer, setBottomSheetPlayer] = useState<Player | null>(null);
  const [undoAction, setUndoAction] = useState<{ player: Player; fromTeam: number; toTeam: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load score status per team ─────────────────────────────────────────────
  const loadScoreStatus = useCallback(async (roundId: number, teamNumList: number[]) => {
    const { data: rps } = await supabase
      .from("round_players").select("id, team_number")
      .eq("round_id", roundId).gt("team_number", 0);
    if (!rps || rps.length === 0) return;

    const { data: scores } = await supabase
      .from("scores").select("round_player_id")
      .in("round_player_id", rps.map((r: any) => r.id));

    const scoredIds = new Set(scores?.map((s: any) => s.round_player_id) ?? []);
    const status: Record<number, TeamScoreStatus> = {};
    teamNumList.forEach(tn => {
      const ids = rps.filter((r: any) => r.team_number === tn).map((r: any) => r.id);
      status[tn] = ids.some(id => scoredIds.has(id)) ? "in_progress" : "not_started";
    });
    setTeamScoreStatus(status);
  }, []);

  // ── Load round for selected date ───────────────────────────────────────────
  const loadRoundForDate = useCallback(async (date: string) => {
    setExistingRoundId(null);
    setIsRoundComplete(false);
    setRoundFormat(null);
    setRoster([]);
    setTeams({});
    setMaxTeams(8);
    setViewMode("none");
    setMobileStep("checkin");
    setTeamScoreStatus({});
    setUndoAction(null);
    setBottomSheetPlayer(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    const { data: rounds } = await supabase
      .from("rounds").select("id, is_complete, format").eq("played_on", date)
      .order("created_at", { ascending: false }).limit(1);

    if (!rounds || rounds.length === 0) return;

    const round = rounds[0];
    setExistingRoundId(round.id);
    setIsRoundComplete(round.is_complete);
    setRoundFormat((round.format ?? null) as Format | null);

    const { data: rps } = await supabase
      .from("round_players").select("player_id, team_number").eq("round_id", round.id);

    if (!rps || rps.length === 0) {
      setViewMode("active");
      setMobileStep("teams");
      return;
    }

    const loadedRoster: Player[] = [];
    const loadedTeams: Record<number, Player[]> = {};

    rps.forEach((rp: any) => {
      const player = allPlayers.find(p => p.id === rp.player_id);
      if (!player) return;
      loadedRoster.push(player);
      const tn = rp.team_number;
      if (tn >= 1) {
        if (!loadedTeams[tn]) loadedTeams[tn] = [];
        loadedTeams[tn].push(player);
      }
    });

    setRoster(loadedRoster);
    setTeams(loadedTeams);

    const teamNumList = Object.keys(loadedTeams).map(Number);
    const maxTn = teamNumList.length > 0 ? Math.max(...teamNumList) : 8;
    setMaxTeams(Math.max(maxTn, 8));

    if (teamNumList.length > 0) {
      await loadScoreStatus(round.id, teamNumList);
      setViewMode("active");
    } else {
      setViewMode("active");
      setMobileStep("teams");
    }
  }, [allPlayers, loadScoreStatus]);

  useEffect(() => {
    if (allPlayers.length > 0) loadRoundForDate(selectedDate);
  }, [selectedDate, allPlayers, loadRoundForDate]);

  // ── Autosave assignment to DB ──────────────────────────────────────────────
  const autosaveAssignment = useCallback(async (playerId: number, teamNum: number) => {
    if (!existingRoundId) return;
    await supabase.from("round_players")
      .update({ team_number: teamNum })
      .eq("round_id", existingRoundId)
      .eq("player_id", playerId);
  }, [existingRoundId]);

  // ── Assign player to team (autosaves + undo toast) ─────────────────────────
  const assignToTeam = useCallback((player: Player, toTeam: number) => {
    let fromTeam = 0;
    Object.entries(teams).forEach(([tn, ps]) => {
      if (ps.find(p => p.id === player.id)) fromTeam = parseInt(tn);
    });

    setTeams(prev => {
      const next: Record<number, Player[]> = {};
      Object.entries(prev).forEach(([tn, ps]) => {
        next[parseInt(tn)] = ps.filter(p => p.id !== player.id);
      });
      if (toTeam >= 1) {
        if (!next[toTeam]) next[toTeam] = [];
        next[toTeam] = [...(next[toTeam] || []), player];
      }
      return next;
    });

    setBottomSheetPlayer(null);
    autosaveAssignment(player.id, toTeam);

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoAction({ player, fromTeam, toTeam });
    undoTimerRef.current = setTimeout(() => setUndoAction(null), 5000);
  }, [teams, autosaveAssignment]);

  const undoAssignment = useCallback(() => {
    if (!undoAction) return;
    const { player, fromTeam } = undoAction;
    setTeams(prev => {
      const next: Record<number, Player[]> = {};
      Object.entries(prev).forEach(([tn, ps]) => {
        next[parseInt(tn)] = ps.filter(p => p.id !== player.id);
      });
      if (fromTeam >= 1) {
        if (!next[fromTeam]) next[fromTeam] = [];
        next[fromTeam] = [...(next[fromTeam] || []), player];
      }
      return next;
    });
    autosaveAssignment(player.id, fromTeam);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoAction(null);
  }, [undoAction, autosaveAssignment]);

  // ── Toggle player in roster (autosaves in edit mode) ──────────────────────
  const toggleInRoster = (player: Player) => {
    const isChecked = !!roster.find(p => p.id === player.id);
    if (isChecked) {
      setRoster(prev => prev.filter(p => p.id !== player.id));
      setTeams(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(tn => {
          next[parseInt(tn)] = next[parseInt(tn)].filter(p => p.id !== player.id);
        });
        return next;
      });
      if (existingRoundId) {
        supabase.from("round_players").delete()
          .eq("round_id", existingRoundId).eq("player_id", player.id);
      }
    } else {
      setRoster(prev => [...prev, player]);
      if (existingRoundId) {
        supabase.from("round_players").insert({
          round_id: existingRoundId, player_id: player.id, team_number: 0, tee_id: null,
        });
      }
    }
  };

  // ── Create round in DB ─────────────────────────────────────────────────────
  const createRound = async () => {
    setSaving(true);
    const { data: round, error } = await supabase
      .from("rounds")
      .insert({ played_on: selectedDate, course_id: 1, format: null, format_config: null })
      .select().single();
    if (error || !round) {
      alert("Error creating round: " + error?.message);
      setSaving(false);
      return;
    }
    setExistingRoundId(round.id);
    setViewMode("edit");
    setMobileStep("checkin");
    setSaving(false);
  };

  // ── Mobile: transition checkin → teams ────────────────────────────────────
  const goToTeams = async () => {
    if (!existingRoundId) return;
    setSaving(true);

    const { data: existing } = await supabase
      .from("round_players").select("player_id, team_number").eq("round_id", existingRoundId);

    const existingMap: Record<number, number> = {};
    existing?.forEach((rp: any) => { existingMap[rp.player_id] = rp.team_number ?? 0; });

    await supabase.from("round_players").delete().eq("round_id", existingRoundId);

    if (roster.length > 0) {
      await supabase.from("round_players").insert(
        roster.map(p => ({
          round_id: existingRoundId,
          player_id: p.id,
          team_number: existingMap[p.id] ?? 0,
          tee_id: null,
        }))
      );
    }

    const newTeams: Record<number, Player[]> = {};
    for (let i = 1; i <= maxTeams; i++) newTeams[i] = [];
    roster.forEach(p => {
      const tn = existingMap[p.id] ?? 0;
      if (tn >= 1 && tn <= maxTeams) {
        if (!newTeams[tn]) newTeams[tn] = [];
        newTeams[tn].push(p);
      }
    });
    setTeams(newTeams);
    setMobileStep("teams");
    setSaving(false);
  };

  // ── Delete round ───────────────────────────────────────────────────────────
  const doDeleteRound = async () => {
    if (!existingRoundId) return;
    setDeleteModal(false);
    setSaving(true);
    const { data: rpRows } = await supabase.from("round_players").select("id").eq("round_id", existingRoundId);
    if (rpRows && rpRows.length > 0) {
      await supabase.from("scores").delete().in("round_player_id", rpRows.map((r: any) => r.id));
    }
    await supabase.from("round_players").delete().eq("round_id", existingRoundId);
    await supabase.from("rounds").delete().eq("id", existingRoundId);
    setExistingRoundId(null);
    setIsRoundComplete(false);
    setRoster([]);
    setTeams({});
    setViewMode("none");
    setSaving(false);
  };

  // ── Exit edit mode ─────────────────────────────────────────────────────────
  const doneEditing = async () => {
    await loadRoundForDate(selectedDate);
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const unassigned = roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id));
  const teamsInUse = Object.values(teams).filter(ps => ps.length > 0).length;
  const filteredPlayers = allPlayers.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.display_name || "").toLowerCase().includes(search.toLowerCase())
  );
  const teamNums = Array.from({ length: maxTeams }, (_, i) => i + 1);

  const formatDate = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const formatDateShort = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── Shared UI pieces ───────────────────────────────────────────────────────
  const hero = (
    <div style={{ background: C.navy, padding: "20px 16px 24px", color: "white" }}>
      <div style={{ fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.55, marginBottom: "4px" }}>
        Playing on
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "10px", lineHeight: 1.2 }}>
        {formatDateShort(selectedDate)}
      </div>
      <input
        type="date" value={selectedDate}
        onChange={e => setSelectedDate(e.target.value)}
        style={{
          background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
          color: "white", padding: "6px 10px", borderRadius: "8px",
          fontSize: "0.82rem", fontFamily: C.font, cursor: "pointer",
        }}
      />
    </div>
  );

  const statsRow = (
    <div style={{ background: C.bg, padding: "12px 16px", display: "flex", gap: "10px" }}>
      {[
        { label: "Checked In", value: roster.length },
        { label: "Teams", value: teamsInUse },
        { label: "On Bench", value: unassigned.length },
      ].map(s => (
        <div key={s.label} style={{
          flex: 1, background: "white", borderRadius: "10px",
          border: "0.5px solid #e4e4e4", padding: "10px 8px", textAlign: "center",
        }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, color: C.navy }}>{s.value}</div>
          <div style={{ fontSize: "0.58rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );

  const ctaBtn = (label: string, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", padding: "15px", borderRadius: "9px",
      border: "none", background: disabled ? "#d1d5db" : C.gold,
      color: disabled ? "#9ca3af" : "#1a1a1a",
      fontSize: "1rem", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: C.font,
    }}>
      {label}
    </button>
  );

  const editBanner = (
    <div style={{
      background: C.navy, padding: "14px 16px",
      display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
    }}>
      <div>
        <div style={{ color: "white", fontWeight: 700, fontSize: "0.88rem" }}>Editing teams</div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "1px" }}>Changes save automatically</div>
      </div>
      <button onClick={doneEditing} style={{
        background: C.gold, color: "#1a1a1a", border: "none", borderRadius: "8px",
        padding: "8px 16px", fontWeight: 700, fontSize: "0.85rem",
        cursor: "pointer", fontFamily: C.font,
      }}>
        Done ✓
      </button>
    </div>
  );

  const undoToast = undoAction && (
    <div style={{
      background: "#1f2937", color: "white", padding: "10px 14px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexShrink: 0, fontSize: "0.82rem", fontFamily: C.font,
    }}>
      <span>
        {undoAction.toTeam >= 1
          ? `${undoAction.player.display_name || undoAction.player.full_name} → Team ${undoAction.toTeam}`
          : `${undoAction.player.display_name || undoAction.player.full_name} removed from Team ${undoAction.fromTeam}`}
      </span>
      <button onClick={undoAssignment} style={{
        background: "none", border: "none", color: C.gold,
        fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", padding: "0 0 0 16px", fontFamily: C.font,
      }}>
        Undo
      </button>
    </div>
  );

  const poolBar = (
    <div style={{
      position: "sticky", top: 0, zIndex: 10,
      background: C.pool, padding: "10px 14px",
      display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center",
    }}>
      {unassigned.length === 0 ? (
        <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>All players assigned ✓</span>
      ) : (
        <>
          <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Tap to assign:
          </span>
          {unassigned.map(p => (
            <button key={p.id} onClick={() => setBottomSheetPlayer(p)} style={{
              padding: "5px 12px", borderRadius: "999px",
              background: bottomSheetPlayer?.id === p.id ? C.gold : "rgba(255,255,255,0.15)",
              color: bottomSheetPlayer?.id === p.id ? "#1a1a1a" : "white",
              border: `1.5px solid ${bottomSheetPlayer?.id === p.id ? C.gold : "rgba(255,255,255,0.3)"}`,
              fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
              {p.display_name || p.full_name}
            </button>
          ))}
        </>
      )}
    </div>
  );

  const dangerModal = deleteModal && (
    <DangerModal
      title="Delete this round?"
      description={`This will permanently delete the round on ${formatDate(selectedDate)}, all team assignments, and all scores.`}
      confirmLabel="Delete round"
      onConfirm={doDeleteRound}
      onCancel={() => setDeleteModal(false)}
    />
  );

  // ── STATE 1: No round ──────────────────────────────────────────────────────
  if (viewMode === "none") {
    return (
      <div style={{ fontFamily: C.font }}>
        {hero}
        {statsRow}
        <div style={{ padding: "60px 24px 100px", textAlign: "center", maxWidth: "400px", margin: "0 auto" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>⛳</div>
          <div style={{ fontSize: "1.15rem", fontWeight: 700, color: C.navy, marginBottom: "8px" }}>No round today yet</div>
          <div style={{ fontSize: "0.88rem", color: "#9ca3af", marginBottom: "32px", lineHeight: 1.5 }}>
            Schedule a round and assign teams to get started.
          </div>
          {ctaBtn(saving ? "Creating…" : "+ Create today's round", createRound, saving)}
        </div>
        {dangerModal}
      </div>
    );
  }

  // ── STATE 2: Active (round with teams) ────────────────────────────────────
  if (viewMode === "active") {
    const activeTeams = Object.entries(teams)
      .filter(([, ps]) => ps.length > 0)
      .sort(([a], [b]) => parseInt(a) - parseInt(b));

    return (
      <div style={{ fontFamily: C.font }}>
        {hero}
        {statsRow}

        <div style={{ padding: "16px", maxWidth: "700px", margin: "0 auto", paddingBottom: "100px" }}>
          {existingRoundId && roundNeedsFormat({ format: roundFormat, is_complete: isRoundComplete }) && (
            <FormatNotSetBanner
              roundId={existingRoundId}
              onChosen={() => loadRoundForDate(selectedDate)}
            />
          )}

          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "14px" }}>
            Today's scorecards
          </div>

          {activeTeams.map(([num, players]) => {
            const tn = parseInt(num);
            const tc = getTeamColor(tn);
            const combinedHC = players.reduce((s, p) => s + (p.handicap_index ?? 0), 0);
            const rawStatus = isRoundComplete ? "complete" : (teamScoreStatus[tn] ?? "not_started");
            const statusLabel = rawStatus === "complete" ? "Complete" : rawStatus === "in_progress" ? "In progress" : "Not started";
            const statusBg = rawStatus === "complete" ? "#e9f5ee" : rawStatus === "in_progress" ? "#fef3c7" : "#f1f5f9";
            const statusColor = rawStatus === "complete" ? "#276e34" : rawStatus === "in_progress" ? "#92400e" : "#64748b";

            return (
              <div key={num} style={{
                background: tc.bg, borderRadius: "12px", marginBottom: "10px", overflow: "hidden",
                border: `1px solid ${tc.border}`, borderLeft: `4px solid ${tc.border}`,
              }}>
                <div style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <span style={{
                        background: tc.pillBg, color: tc.pillText,
                        fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
                        padding: "2px 8px", borderRadius: "999px",
                      }}>
                        Team {tn}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>HC {Math.round(combinedHC)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {players.map(p => (
                        <span key={p.id} style={{ fontSize: "0.85rem", fontWeight: 500, color: "#1e293b" }}>
                          {p.display_name || p.full_name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flexShrink: 0, marginLeft: "12px" }}>
                    <span style={{
                      background: statusBg, color: statusColor,
                      fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                      padding: "3px 8px", borderRadius: "999px",
                    }}>
                      {statusLabel}
                    </span>
                    {existingRoundId && (
                      <Link href={`/round/${existingRoundId}/scorecard?team=${tn}`} style={{
                        fontSize: "0.75rem", fontWeight: 600, color: tc.pillText, textDecoration: "none",
                      }}>
                        Open scorecard →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {activeTeams.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px", color: "#9ca3af", fontSize: "0.88rem" }}>
              No teams assigned yet.
            </div>
          )}

          <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {ctaBtn("Edit teams", () => { setViewMode("edit"); setMobileStep("checkin"); })}
            <button onClick={() => setDeleteModal(true)} disabled={saving} style={{
              width: "100%", padding: "13px", borderRadius: "9px",
              border: `1.5px solid ${C.red}`, background: "transparent",
              color: C.red, fontSize: "0.9rem", fontWeight: 600,
              cursor: "pointer", fontFamily: C.font,
            }}>
              Delete round
            </button>
          </div>
        </div>
        {dangerModal}
      </div>
    );
  }

  // ── STATE 3: Edit mode ────────────────────────────────────────────────────

  // ── MOBILE: Checkin step ──────────────────────────────────────────────────
  if (isMobile && mobileStep === "checkin") {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 120px)", fontFamily: C.font }}>
        {editBanner}

        <div style={{ padding: "12px 16px", background: "white", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
              style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              placeholder="Search players…" value={search} onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "9px 10px 9px 30px",
                border: `1px solid ${C.border}`, borderRadius: "8px",
                fontSize: "0.85rem", fontFamily: C.font, outline: "none", color: "#1f2937",
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", background: C.bg, paddingBottom: "80px" }}>
          {filteredPlayers.map(player => {
            const checked = !!roster.find(r => r.id === player.id);
            return (
              <button key={player.id} onClick={() => toggleInRoster(player)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: "14px",
                padding: "14px 16px", background: "white",
                borderBottom: `1px solid ${C.border}`, border: "none",
                cursor: "pointer", textAlign: "left", fontFamily: C.font, minHeight: "56px",
              }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "6px", flexShrink: 0,
                  border: checked ? "none" : "2px solid #d1d5db",
                  background: checked ? C.navy : "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {checked && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span style={{ flex: 1, fontSize: "1rem", fontWeight: checked ? 600 : 400, color: checked ? C.navy : "#1f2937" }}>
                  {player.display_name || player.full_name}
                </span>
                <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
                  {player.handicap_index != null ? `HC ${player.handicap_index}` : "–"}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{
          position: "fixed", bottom: "60px", left: 0, right: 0,
          padding: "12px 16px", background: "white",
          borderTop: `1px solid ${C.border}`, boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
        }}>
          {ctaBtn(
            saving ? "Saving…" : roster.length < 4 ? `Check in ${4 - roster.length} more to continue` : `Assign to teams → (${roster.length} players)`,
            goToTeams,
            roster.length < 4 || saving
          )}
        </div>
        {dangerModal}
      </div>
    );
  }

  // ── MOBILE: Teams step ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 108px)", overflow: "hidden", fontFamily: C.font }}>
        {editBanner}
        {undoToast}

        <div style={{
          padding: "10px 16px", background: "white", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: "12px", flexShrink: 0,
        }}>
          <button onClick={() => setMobileStep("checkin")} style={{
            background: "none", border: "none", color: C.navy,
            fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: C.font,
          }}>
            ← Back
          </button>
          <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>
            {unassigned.length > 0 ? `${unassigned.length} unassigned` : "All assigned ✓"}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {poolBar}

          <div style={{ padding: "12px 16px", background: C.bg, paddingBottom: "100px" }}>
            {teamNums.map(num => {
              const tc = getTeamColor(num);
              const teamPlayers = teams[num] || [];
              const combinedHC = teamPlayers.reduce((s, p) => s + (p.handicap_index ?? 0), 0);

              return (
                <div key={num} style={{
                  background: tc.bg, borderRadius: "10px", marginBottom: "10px", overflow: "hidden",
                  border: `1px solid ${tc.border}`, borderLeft: `4px solid ${tc.border}`,
                }}>
                  <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{
                      background: tc.pillBg, color: tc.pillText,
                      fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
                      padding: "2px 8px", borderRadius: "999px",
                    }}>
                      Team {num}
                    </span>
                    {teamPlayers.length > 0 && (
                      <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>HC {Math.round(combinedHC)}</span>
                    )}
                  </div>

                  <div style={{ padding: "0 14px 10px" }}>
                    {teamPlayers.map(p => (
                      <div key={p.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "7px 8px", borderRadius: "6px", marginBottom: "4px",
                        background: "rgba(255,255,255,0.6)",
                      }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: 500, color: "#1e293b" }}>
                          {p.display_name || p.full_name}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                            {p.handicap_index != null ? `HC ${p.handicap_index}` : "–"}
                          </span>
                          <button onClick={() => assignToTeam(p, 0)} style={{
                            background: "none", border: "none", color: "#d1d5db",
                            cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "0 2px",
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
                      <button onClick={() => assignToTeam(bottomSheetPlayer, num)} style={{
                        width: "100%", marginTop: "8px", padding: "8px", borderRadius: "8px",
                        border: `1.5px dashed ${tc.border}`, background: "rgba(255,255,255,0.5)",
                        color: tc.pillText, fontSize: "0.82rem", fontWeight: 600,
                        cursor: "pointer", fontFamily: C.font,
                      }}>
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
              + Add new team
            </button>
          </div>
        </div>
        {dangerModal}
      </div>
    );
  }

  // ── DESKTOP: Edit mode ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", fontFamily: C.font }}>
      {editBanner}
      {undoToast}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "0", minHeight: "600px" }}>
        {/* Left: player check-in */}
        <div style={{ borderRight: `1px solid ${C.border}`, background: "white", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 16px 10px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Players</span>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: C.navy }}>{roster.length}/{allPlayers.length}</span>
            </div>
            <div style={{ position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
                style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
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
                  border: checked ? `1.5px solid ${C.navy}` : "1px solid transparent",
                  background: checked ? `${C.navy}10` : "transparent",
                  cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                  fontFamily: C.font,
                }}>
                  <span style={{ fontSize: "0.88rem", fontWeight: checked ? 600 : 400, color: checked ? C.navy : "#374151" }}>
                    {player.display_name || player.full_name}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
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
            {teamNums.map(num => {
              const tc = getTeamColor(num);
              const teamPlayers = teams[num] || [];
              const combinedHC = teamPlayers.reduce((s, p) => s + (p.handicap_index ?? 0), 0);

              return (
                <div key={num} style={{
                  background: tc.bg, borderRadius: "10px", overflow: "hidden",
                  border: `1px solid ${tc.border}`, borderLeft: `4px solid ${tc.border}`,
                }}>
                  <div style={{
                    padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
                    borderBottom: `1px solid ${tc.border}`,
                  }}>
                    <span style={{
                      background: tc.pillBg, color: tc.pillText,
                      fontSize: "0.65rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
                      padding: "2px 8px", borderRadius: "999px",
                    }}>
                      Team {num}
                    </span>
                    {teamPlayers.length > 0 && (
                      <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>HC {Math.round(combinedHC)}</span>
                    )}
                  </div>
                  <div style={{ padding: "10px", minHeight: "100px" }}>
                    {teamPlayers.map(p => (
                      <div key={p.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "6px 8px", borderRadius: "6px", marginBottom: "4px",
                        background: "rgba(255,255,255,0.7)", fontSize: "0.82rem",
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
                      <div style={{ color: "#d1d5db", fontSize: "0.78rem", fontStyle: "italic", padding: "6px 8px" }}>
                        Drop players here
                      </div>
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
                        {unassigned.map(u => (
                          <option key={u.id} value={u.id}>{u.display_name || u.full_name}</option>
                        ))}
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
              <span style={{ fontSize: "18px", lineHeight: 1 }}>+</span> Add new team
            </button>
          </div>
        </div>
      </div>
      {dangerModal}
    </div>
  );
}
