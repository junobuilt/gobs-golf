"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { getTeamColor } from "@/lib/teamColors";
import { todayLocal, yesterdayLocal } from "@/lib/date";
import { getWriteQueue } from "@/lib/writeQueue";
import type { QueueItem } from "@/lib/writeQueue";
import StaleFailureDialog from "@/components/scorecard/StaleFailureDialog";
import { formatStaleItemsForClipboard } from "@/components/scorecard/stuckItemsClipboard";
import { ensureRoundShell } from "@/lib/round/ensureRoundShell";
import type { Player } from "@/app/admin/page";
import { RoundPlayer, SmartJoinResult } from "@/lib/teamFormation/smartJoin";
import PlayerPickerSheet from "@/components/teamFormation/PlayerPickerSheet";
import JoinTeamConfirmModal from "@/components/teamFormation/JoinTeamConfirmModal";
import MixedTeamsErrorModal from "@/components/teamFormation/MixedTeamsErrorModal";

// Phase E: sessionStorage flag. Suppresses the stale-failure prompt for
// the current browser-tab session after the user dismisses it. Cleared
// when the tab is closed → next app open re-checks.
const STALE_SUPPRESS_KEY = "gobs:stale-failure-dismissed";

type TeamInfo = {
  number: number;
  players: string[];
  hasScores: boolean;
};

type RecentRound = {
  id: number;
  played_on: string;
  is_complete: boolean;
  isYesterday: boolean;
  teams: TeamInfo[];
  hasAnyScores: boolean;
};

export default function HomePage() {
  const router = useRouter();
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Team formation state
  const [activePlayers, setActivePlayers] = useState<Player[]>([]);
  const [todayRoundId, setTodayRoundId] = useState<number | null>(null);
  const [todayRoundPlayers, setTodayRoundPlayers] = useState<RoundPlayer[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmJoinModal, setConfirmJoinModal] = useState<Extract<SmartJoinResult, { kind: "confirm_join" }> | null>(null);
  const [mixedTeamsModal, setMixedTeamsModal] = useState<Extract<SmartJoinResult, { kind: "mixed_teams_error" }> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-player write queue — canonical shape from CLAUDE.md "Locked patterns".
  // Serializes writes for the same player_id; cross-player writes run in parallel.
  const writeQueueRef = useRef<Map<number, Promise<void>>>(new Map());
  function enqueuePlayerWrite(playerId: number, fn: () => Promise<void>) {
    const prev = writeQueueRef.current.get(playerId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => console.error("[teamFormation]", err));
    writeQueueRef.current.set(playerId, next);
    return next;
  }
  async function drainWrites() {
    await Promise.all([...writeQueueRef.current.values()]);
  }

  // Phase E: stale-failure prompt state.
  const [staleItems, setStaleItems] = useState<QueueItem[]>([]);
  const [staleCopyState, setStaleCopyState] = useState<"idle" | "copied">("idle");

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  const loadTodayRoundPlayers = useCallback(async (roundId: number) => {
    const { data: rps } = await supabase
      .from("round_players")
      .select("id, player_id, team_number, players ( display_name, full_name )")
      .eq("round_id", roundId);

    if (rps) {
      const mapped: RoundPlayer[] = rps.map((rp: any) => {
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        return {
          id: rp.id,
          player_id: rp.player_id,
          team_number: rp.team_number ?? 0,
          players: {
            full_name: playerRow?.full_name ?? "",
            display_name: playerRow?.display_name ?? "",
          },
        };
      });
      setTodayRoundPlayers(mapped);
    }
  }, []);

  const load = useCallback(async () => {
    const [{ count }, { data: playerRows }] = await Promise.all([
      supabase.from("players").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("players").select("id, full_name, display_name, handicap_index, is_active, preferred_tee_id").eq("is_active", true).order("full_name"),
    ]);
    setPlayerCount(count || 0);
    if (playerRows) setActivePlayers(playerRows as Player[]);

    const today = todayLocal();
    const yesterday = yesterdayLocal();

    const { data: rounds } = await supabase
      .from("rounds")
      .select("id, played_on, is_complete")
      .or(`played_on.eq.${today},and(played_on.eq.${yesterday},is_complete.eq.false)`)
      .order("played_on", { ascending: false });

    if (rounds) {
      // Find today's round for team formation
      const todayRound = rounds.find((r: any) => r.played_on === today);
      if (todayRound) {
        setTodayRoundId(todayRound.id);
        await loadTodayRoundPlayers(todayRound.id);
      } else {
        setTodayRoundId(null);
        setTodayRoundPlayers([]);
      }

      const roundsWithTeams = await Promise.all(
        rounds.map(async (round: any) => {
          // Fetch round_players including id for score lookup
          const { data: rps } = await supabase
            .from("round_players")
            .select("id, team_number, players ( display_name, full_name )")
            .eq("round_id", round.id);

          // Get which round_player_ids have any scores
          const rpIds = rps?.map((rp: any) => rp.id) || [];
          const rpIdsWithScores = new Set<number>();
          if (rpIds.length > 0) {
            const { data: scoreData } = await supabase
              .from("scores")
              .select("round_player_id")
              .in("round_player_id", rpIds);
            scoreData?.forEach((s: any) => rpIdsWithScores.add(s.round_player_id));
          }

          // Build team map with per-team hasScores flag
          const teamMap: Record<number, { players: string[]; hasScores: boolean }> = {};
          rps?.forEach((rp: any) => {
            const tNum = rp.team_number;
            if (!tNum) return;
            const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
            if (!teamMap[tNum]) teamMap[tNum] = { players: [], hasScores: false };
            teamMap[tNum].players.push(playerRow?.display_name || playerRow?.full_name || "?");
            if (rpIdsWithScores.has(rp.id)) teamMap[tNum].hasScores = true;
          });

          const teamList: TeamInfo[] = Object.entries(teamMap)
            .map(([num, info]) => ({ number: parseInt(num), players: info.players, hasScores: info.hasScores }))
            .sort((a, b) => a.number - b.number);

          const hasAnyScores = teamList.some(t => t.hasScores);

          return {
            ...round,
            isYesterday: round.played_on === yesterday,
            teams: teamList,
            hasAnyScores,
          };
        })
      );
      setRecentRounds(roundsWithTeams);
    }
    setLoading(false);
  }, [loadTodayRoundPlayers]);

  useEffect(() => {
    load();
  }, [load]);

  // Phase E: check the write queue on homepage mount. If terminal failures
  // exist and the user hasn't dismissed the prompt this session, surface
  // them. We mount this on the homepage only (not on every route) — per
  // D9, frequent re-checks would be noise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(STALE_SUPPRESS_KEY) === "1") return;
    } catch {
      // sessionStorage disabled — fall through; we'll still show the prompt.
    }
    const queue = getWriteQueue();
    const terminal = queue.getItems({ state: "terminal_failure" });
    if (terminal.length > 0) setStaleItems(terminal);
  }, []);

  // ── Upsert a player into round_players at the given team number ────────────
  // Insert if the player is not yet in the round; update team_number if they
  // are and currently unassigned (team_number = 0). Skips already-assigned rows
  // so a create_new result never clobbers an existing team assignment.
  async function upsertPlayerToTeam(roundId: number, playerId: number, teamNumber: number) {
    const { data: existing } = await supabase
      .from("round_players")
      .select("id, team_number")
      .eq("round_id", roundId)
      .eq("player_id", playerId)
      .maybeSingle();

    if (!existing) {
      await supabase.from("round_players").insert({
        round_id: roundId,
        player_id: playerId,
        team_number: teamNumber,
        tee_id: null,
      });
    } else if (existing.team_number === 0) {
      await supabase
        .from("round_players")
        .update({ team_number: teamNumber })
        .eq("round_id", roundId)
        .eq("player_id", playerId);
    }
  }

  // ── Open the player picker (ensures a round shell exists first) ───────────
  const handleOpenPicker = useCallback(async () => {
    let roundId = todayRoundId;
    if (!roundId) {
      try {
        roundId = await ensureRoundShell(todayLocal());
        setTodayRoundId(roundId);
        setTodayRoundPlayers([]);
      } catch (err) {
        console.error("[teamFormation] ensureRoundShell failed", err);
        return;
      }
    }
    setPickerOpen(true);
  }, [todayRoundId]);

  // ── SmartJoin resolution handler (called from PlayerPickerSheet.onResolve) ─
  const handleResolve = useCallback(async (result: SmartJoinResult) => {
    const roundId = todayRoundId;
    if (!roundId) return;

    if (result.kind === "create_new") {
      setPickerOpen(false);
      for (const playerId of result.playerIds) {
        enqueuePlayerWrite(playerId, () =>
          upsertPlayerToTeam(roundId, playerId, result.nextTeamNumber)
        );
      }
      await drainWrites();
      const names = result.playerIds
        .map((id) => {
          const p = activePlayers.find((a) => a.id === id);
          return p?.display_name || p?.full_name || "?";
        })
        .join(", ");
      showToast(`Team ${result.nextTeamNumber} created — ${names}.`);
      await loadTodayRoundPlayers(roundId);
      router.push(`/round/${roundId}/scorecard?team=${result.nextTeamNumber}`);
    } else if (result.kind === "silent_join") {
      setPickerOpen(false);
      await drainWrites();
      const teamRoster = todayRoundPlayers.filter(
        (rp) => rp.team_number === result.teamNumber
      );
      const names = teamRoster
        .map((rp) => rp.players.display_name || rp.players.full_name)
        .join(", ");
      showToast(`You're on Team ${result.teamNumber} with ${names}.`);
      router.push(`/round/${roundId}/scorecard?team=${result.teamNumber}`);
    } else if (result.kind === "confirm_join") {
      // Keep picker open (mounted beneath modal) so selection is preserved on cancel
      setConfirmJoinModal(result);
    } else if (result.kind === "mixed_teams_error") {
      // Keep picker open beneath modal; dismiss returns to picker with selection intact
      setMixedTeamsModal(result);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRoundId, activePlayers, todayRoundPlayers, loadTodayRoundPlayers, router]);

  const handleConfirmJoin = useCallback(async () => {
    const roundId = todayRoundId;
    if (!roundId || !confirmJoinModal) return;
    for (const playerId of confirmJoinModal.playerIdsToAdd) {
      enqueuePlayerWrite(playerId, () =>
        upsertPlayerToTeam(roundId, playerId, confirmJoinModal.teamNumber)
      );
    }
    await drainWrites();
    setConfirmJoinModal(null);
    setPickerOpen(false);
    showToast(`Added to Team ${confirmJoinModal.teamNumber}.`);
    await loadTodayRoundPlayers(roundId);
    router.push(`/round/${roundId}/scorecard?team=${confirmJoinModal.teamNumber}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRoundId, confirmJoinModal, loadTodayRoundPlayers, router]);

  const handleStaleRetry = useCallback(async (): Promise<boolean> => {
    const queue = getWriteQueue();
    const ids = staleItems.map(i => i.id);
    if (ids.length === 0) return true;
    await queue.retryTerminal(ids);
    await queue.drain({ ignoreBackoff: true });
    // After retry: items either succeeded (gone from queue) or are
    // pending again with backoff (still failing). Mark any still-pending
    // ones terminal so the dialog has a stable item list to show.
    const stillPending = queue
      .getItems()
      .filter(i => ids.includes(i.id) && (i.state === "pending" || i.state === "in_flight"));
    if (stillPending.length > 0) {
      queue.markAsTerminal(
        stillPending.map(i => i.id),
        "stale_failure_retry_timeout",
      );
    }
    const stillStuck = queue
      .getItems({ state: "terminal_failure" })
      .filter(i => ids.includes(i.id));
    setStaleItems(stillStuck);
    return stillStuck.length === 0;
  }, [staleItems]);

  const handleStaleForget = useCallback(() => {
    const queue = getWriteQueue();
    queue.forget(
      staleItems.map(i => i.id),
      "user_forget_stale",
    );
    setStaleItems([]);
  }, [staleItems]);

  const handleStaleCopy = useCallback(async () => {
    const text = formatStaleItemsForClipboard(
      staleItems.map(i => ({
        hole_label: i.display.hole_label,
        player_name: i.display.player_name,
        strokes: i.payload.strokes,
        round_id: i.payload.round_id,
        round_date: i.display.round_date ?? null,
      })),
    );
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand?.("copy");
        document.body.removeChild(ta);
      }
      setStaleCopyState("copied");
      setTimeout(() => setStaleCopyState("idle"), 2000);
    } catch {
      // Silent failure — user can still read the list in the dialog.
    }
  }, [staleItems]);

  const handleStaleDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(STALE_SUPPRESS_KEY, "1");
    } catch {
      // sessionStorage disabled — best-effort; dialog will re-appear on
      // next mount within this session, but that's better than crashing.
    }
    setStaleItems([]);
  }, []);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  const F = {
    font: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  };

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto", fontFamily: F.font, color: "#1e293b", paddingBottom: "140px" }}>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: 0, right: 0, zIndex: 2000,
          display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{
            background: "#1f2937", color: "white",
            padding: "10px 18px", borderRadius: 10,
            fontSize: "0.85rem", fontWeight: 500,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            maxWidth: 400, textAlign: "center",
            fontFamily: F.font,
          }}>
            {toast}
          </div>
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg, #0c3057, #0f4a7a)", borderRadius: "16px", padding: "24px", color: "white", marginBottom: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Good Ole Boys</h2>
        <p style={{ opacity: 0.8, fontSize: "0.85rem", marginBottom: "20px", marginTop: "4px" }}>{playerCount} Players · Semiahmoo GCC</p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link href="/round/new" style={{ backgroundColor: "white", color: "#0c3057", padding: "10px 16px", borderRadius: "8px", fontWeight: 700, textDecoration: "none", fontSize: "0.85rem" }}>
            + Start a Scorecard
          </Link>
          <Link href="/admin" style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "white", padding: "10px 16px", borderRadius: "8px", fontWeight: 600, textDecoration: "none", fontSize: "0.85rem", border: "1px solid rgba(255,255,255,0.25)" }}>
            Admin
          </Link>
        </div>
      </div>

      <h3 style={{ color: "#0c3057", fontSize: "1rem", marginBottom: "14px", fontWeight: 700 }}>Today's Scorecards / Teams</h3>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>Loading…</div>
      ) : recentRounds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8", fontSize: "0.9rem" }}>
          <p style={{ marginBottom: 16 }}>No rounds today. Set one up in Admin.</p>
          <button
            onClick={handleOpenPicker}
            style={{
              padding: "14px 24px",
              background: "#e8a800", color: "#1a1a1a",
              border: "none", borderRadius: 10,
              fontSize: "1rem", fontWeight: 700,
              cursor: "pointer", fontFamily: F.font,
            }}
          >
            Form a team
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {recentRounds.map((round) => {
            // Determine overall round status
            const status = round.is_complete ? "Complete"
              : round.isYesterday ? "Unfinished"
              : round.hasAnyScores ? "In Progress"
              : "Not Started";

            const statusBg = round.is_complete ? "#f1f5f9"
              : round.isYesterday ? "#fef3c7"
              : round.hasAnyScores ? "#dcfce7"
              : "#fef3c7";

            const statusColor = round.is_complete ? "#475569"
              : round.isYesterday ? "#92400e"
              : round.hasAnyScores ? "#166534"
              : "#92400e";

            return (
              <div key={round.id} style={{ background: "white", borderRadius: "14px", border: "1px solid rgba(0,0,0,0.07)", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{formatDate(round.played_on)}</span>
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                    padding: "3px 10px", borderRadius: "999px",
                    background: statusBg, color: statusColor,
                  }}>
                    {status}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                  {round.teams.map((team) => {
                    const tc = getTeamColor(team.number);
                    return (
                      <Link
                        key={team.number}
                        href={`/round/${round.id}/scorecard?team=${team.number}`}
                        style={{
                          display: "flex", flexDirection: "column", padding: "10px 12px",
                          backgroundColor: tc.bg, borderRadius: "10px", textDecoration: "none",
                          border: `1px solid ${tc.border}`, borderLeft: `3px solid ${tc.border}`,
                        }}
                      >
                        <span style={{ fontSize: "0.62rem", fontWeight: 800, color: tc.pillText, marginBottom: "5px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Team {team.number}
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                          {team.players.map((name, i) => (
                            <span key={i} style={{ fontSize: "0.75rem", color: "#64748b" }}>{name}</span>
                          ))}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {round.id === todayRoundId && !round.is_complete && (
                  <button
                    onClick={handleOpenPicker}
                    style={{
                      display: "block", width: "100%", textAlign: "center", marginTop: "10px",
                      padding: "10px 16px", borderRadius: 10,
                      background: "white", color: "#0b2d50",
                      border: "1.5px solid #e8a800",
                      fontSize: "0.9rem", fontWeight: 700,
                      cursor: "pointer", fontFamily: F.font,
                    }}
                  >
                    Form a new team
                  </button>
                )}

                {round.is_complete && (
                  <Link href={`/round/${round.id}/summary`} style={{
                    display: "block", textAlign: "center", marginTop: "10px",
                    padding: "8px", borderRadius: "8px", background: "#f0fdf4",
                    color: "#166534", fontSize: "0.82rem", fontWeight: 700,
                    textDecoration: "none", border: "1px solid #bbf7d0",
                  }}>
                    View Summary →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Player picker sheet ────────────────────────────────────────────── */}
      {pickerOpen && (
        <PlayerPickerSheet
          mode="form_team"
          activePlayers={activePlayers}
          roundPlayers={todayRoundPlayers}
          onResolve={handleResolve}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* ── Confirm join modal (rendered on top of picker) ────────────────── */}
      {confirmJoinModal && (
        <JoinTeamConfirmModal
          teamNumber={confirmJoinModal.teamNumber}
          existingRoster={confirmJoinModal.existingRoster}
          playerIdsToAdd={confirmJoinModal.playerIdsToAdd}
          playerNamesToAdd={confirmJoinModal.playerIdsToAdd.map((id) => {
            const p = activePlayers.find((a) => a.id === id);
            return p?.display_name || p?.full_name || "?";
          })}
          onConfirm={handleConfirmJoin}
          onCancel={() => setConfirmJoinModal(null)}
        />
      )}

      {/* ── Mixed teams error modal (rendered on top of picker) ──────────── */}
      {mixedTeamsModal && (
        <MixedTeamsErrorModal
          teamA={mixedTeamsModal.teamA}
          teamB={mixedTeamsModal.teamB}
          playersA={mixedTeamsModal.playersA}
          playersB={mixedTeamsModal.playersB}
          onDismiss={() => setMixedTeamsModal(null)}
        />
      )}

      {staleItems.length > 0 && (
        <StaleFailureDialog
          items={staleItems}
          onRetry={handleStaleRetry}
          onForget={handleStaleForget}
          onCopyDetails={handleStaleCopy}
          onDismiss={handleStaleDismiss}
          copyState={staleCopyState}
        />
      )}
    </div>
  );
}
