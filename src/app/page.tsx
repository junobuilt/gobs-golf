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
import { ensureSeasonAndRoundShell, defaultSeasonName } from "@/lib/round/ensureSeasonAndRoundShell";
import type { Player } from "@/app/admin/page";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";
import { RoundPlayer, SmartJoinResult } from "@/lib/teamFormation/smartJoin";
import PlayerPickerSheet from "@/components/teamFormation/PlayerPickerSheet";
import SeasonStartModal from "@/components/season/SeasonStartModal";
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
  const [seasonPromptOpen, setSeasonPromptOpen] = useState(false);
  const [confirmJoinModal, setConfirmJoinModal] = useState<Extract<SmartJoinResult, { kind: "confirm_join" }> | null>(null);
  const [mixedTeamsModal, setMixedTeamsModal] = useState<Extract<SmartJoinResult, { kind: "mixed_teams_error" }> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<"dark" | "amber">("dark");
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

  function showToast(msg: string, duration = 5000, variant: "dark" | "amber" = "dark") {
    setToast(msg);
    setToastVariant(variant);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
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
            .select("id, player_id, team_number, players ( display_name, full_name )")
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
            // Disambiguating short name against the full active roster
            // (playerRows), so it matches every other surface.
            const fn = playerRow?.full_name ?? "";
            teamMap[tNum].players.push(
              fn ? getDisplayName({ id: rp.player_id, full_name: fn }, (playerRows ?? []) as PlayerLike[]) : "?",
            );
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
  async function upsertPlayerToTeam(roundId: number, playerId: number, teamNumber: number, handicapIndex: number | null) {
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
        handicap_index_snapshot: handicapIndex,
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
  // Defense-in-depth alongside the create_team_with_players RPC: the RPC
  // guarantees writes land on the right team_number even if our local view
  // is stale, but the picker still needs current "Team N" captions and the
  // smartJoin pre-resolve so a player who's already on a team routes down
  // silent_join / confirm_join rather than (mistakenly) create_new. We
  // refetch roundPlayers immediately before opening so the picker renders
  // the freshest server state.
  const openPickerForRound = useCallback(async (roundId: number) => {
    setTodayRoundId(roundId);
    setTodayRoundPlayers([]);
    await loadTodayRoundPlayers(roundId);
    setPickerOpen(true);
  }, [loadTodayRoundPlayers]);

  const handleOpenPicker = useCallback(async () => {
    if (todayRoundId) {
      await loadTodayRoundPlayers(todayRoundId);
      setPickerOpen(true);
      return;
    }
    try {
      // H3.4: season-aware. If no season is active, prompt for a name first.
      const res = await ensureSeasonAndRoundShell(todayLocal());
      if (res.status === "needs_season_name") {
        setSeasonPromptOpen(true);
        return;
      }
      await openPickerForRound(res.roundId);
    } catch (err) {
      console.error("[teamFormation] ensureSeasonAndRoundShell failed", err);
    }
  }, [todayRoundId, loadTodayRoundPlayers, openPickerForRound]);

  const handleSeasonPromptConfirm = useCallback(async (name: string) => {
    setSeasonPromptOpen(false);
    try {
      const res = await ensureSeasonAndRoundShell(todayLocal(), { seasonName: name });
      if (res.status === "ok") await openPickerForRound(res.roundId);
    } catch (err) {
      console.error("[teamFormation] create season + round failed", err);
    }
  }, [openPickerForRound]);

  // ── SmartJoin resolution handler (called from PlayerPickerSheet.onResolve) ─
  const handleResolve = useCallback(async (result: SmartJoinResult) => {
    const roundId = todayRoundId;
    if (!roundId) return;

    if (result.kind === "create_new") {
      setPickerOpen(false);
      // create_new: nextTeamNumber from smartJoin is advisory only.
      // Actual team number is assigned atomically by the RPC to
      // prevent races between concurrent devices AND stale-data
      // collisions from sequential devices that haven't refreshed.
      const handicapSnapshots = result.playerIds.map((id) => {
        const player = activePlayers.find((p) => p.id === id);
        return player?.handicap_index ?? null;
      });
      const { data: newTeamNumber, error } = await supabase.rpc(
        "create_team_with_players",
        {
          p_round_id: roundId,
          p_player_ids: result.playerIds,
          p_handicap_snapshots: handicapSnapshots,
        },
      );
      if (error || newTeamNumber == null) {
        console.error("[teamFormation] create_team_with_players RPC failed", error);
        showToast("Couldn't create team — please try again.", 4000, "amber");
        return;
      }
      const names = result.playerIds
        .map((id) => {
          const p = activePlayers.find((a) => a.id === id);
          return p?.full_name ? getDisplayName(p, activePlayers) : "?";
        })
        .join(", ");
      showToast(`Team ${newTeamNumber} created — ${names}.`);
      await loadTodayRoundPlayers(roundId);
      router.push(`/round/${roundId}/scorecard?team=${newTeamNumber}`);
    } else if (result.kind === "silent_join") {
      setPickerOpen(false);
      await drainWrites();
      const teamRoster = todayRoundPlayers.filter(
        (rp) => rp.team_number === result.teamNumber
      );
      const names = teamRoster
        .map((rp) =>
          rp.players.full_name
            ? getDisplayName({ id: rp.player_id, full_name: rp.players.full_name }, activePlayers)
            : (rp.players.display_name || "?"),
        )
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
      const hi = activePlayers.find(p => p.id === playerId)?.handicap_index ?? null;
      enqueuePlayerWrite(playerId, () =>
        upsertPlayerToTeam(roundId, playerId, confirmJoinModal.teamNumber, hi)
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

  const todayRoundComplete = recentRounds.find(r => r.id === todayRoundId)?.is_complete ?? false;

  function handleFormTeamClick() {
    if (todayRoundComplete) {
      showToast("Round is complete — new teams can't be formed.", 3000, "amber");
      return;
    }
    void handleOpenPicker();
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
            background: toastVariant === "amber" ? "#fdf0cc" : "#1f2937",
            color: toastVariant === "amber" ? "#854f0b" : "white",
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
          <button
            onClick={handleFormTeamClick}
            aria-disabled={todayRoundComplete ? "true" : undefined}
            style={{ backgroundColor: "#e8a800", color: "#1a1a1a", padding: "10px 16px", borderRadius: "8px", fontWeight: 700, border: "none", fontSize: "0.85rem", cursor: todayRoundComplete ? "default" : "pointer", fontFamily: F.font, opacity: todayRoundComplete ? 0.4 : 1 }}
          >
            + Form a Team
          </button>
          <Link href="/admin" style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "white", padding: "10px 16px", borderRadius: "8px", fontWeight: 600, textDecoration: "none", fontSize: "0.85rem", border: "1px solid rgba(255,255,255,0.25)" }}>
            Admin
          </Link>
        </div>
      </div>

      <h3 style={{ color: "#0c3057", fontSize: "1rem", marginBottom: "14px", fontWeight: 700 }}>Today's Scorecards / Teams</h3>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>Loading…</div>
      ) : recentRounds.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>⛳</div>
          <p style={{ fontSize: "0.9rem", color: "#64748b", maxWidth: 240, margin: "0 auto" }}>
            No teams exist yet. Set one up by clicking &quot;+ Form a Team&quot; above.
          </p>
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

      {/* ── Season auto-start prompt (H3.4) ───────────────────────────────── */}
      {seasonPromptOpen && (
        <SeasonStartModal
          defaultName={defaultSeasonName()}
          onConfirm={handleSeasonPromptConfirm}
          onCancel={() => setSeasonPromptOpen(false)}
        />
      )}

      {/* ── Player picker sheet ────────────────────────────────────────────── */}
      {pickerOpen && (
        <PlayerPickerSheet
          mode="form_team"
          activePlayers={activePlayers}
          allActivePlayers={activePlayers}
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
            return p?.full_name ? getDisplayName(p, activePlayers) : "?";
          })}
          allActivePlayers={activePlayers}
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
          allActivePlayers={activePlayers}
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
