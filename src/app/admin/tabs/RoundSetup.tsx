"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Player } from "../page";
import DangerModal from "../components/DangerModal";
import { getTeamColor } from "@/lib/teamColors";
import FormatPicker from "@/components/format/FormatPicker";
import { FORMAT_LABELS } from "@/lib/format/copy";
import { getHandicapAllowance, isTeamCardFormat } from "@/lib/format/helpers";
import { ensureSeasonAndRoundShell, defaultSeasonName } from "@/lib/round/ensureSeasonAndRoundShell";
import { reopenRound } from "@/lib/round/reopenRound";
import { todayLocal } from "@/lib/date";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Format, FormatConfig } from "@/lib/scoring/types";
import PlayerOverflowMenu from "@/components/round/PlayerOverflowMenu";
import SeasonStartModal from "@/components/season/SeasonStartModal";

interface Props {
  allPlayers: Player[];
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

// Wave 1A: handicap-allowance dropdown choices — 100% down to 10% in steps of
// 10. No 0% (gross play is the net/gross basis toggle's job). Default 100.
const ALLOWANCE_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

type ViewMode = "none" | "active" | "edit";
type TeamScoreStatus = "not_started" | "in_progress";

export default function RoundSetup({ allPlayers }: Props) {
  const isMobile = useIsMobile();

  const [selectedDate, setSelectedDate] = useState(() => todayLocal());
  const [roster, setRoster] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Record<number, Player[]>>({});
  const [existingRoundId, setExistingRoundId] = useState<number | null>(null);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [roundFormat, setRoundFormat] = useState<Format | null>(null);
  const [roundFormatConfig, setRoundFormatConfig] = useState<FormatConfig | null>(null);
  const [roundFormatLockedAt, setRoundFormatLockedAt] = useState<string | null>(null);
  const [teamScoreStatus, setTeamScoreStatus] = useState<Record<number, TeamScoreStatus>>({});
  const [maxTeams, setMaxTeams] = useState(8);
  const [viewMode, setViewMode] = useState<ViewMode>("none");
  const [mobileStep, setMobileStep] = useState<"checkin" | "teams">("checkin");
  const [saving, setSaving] = useState(false);
  // H3.4: auto-start prompt when creating a round with no active season.
  // pendingAction records which entry button (format vs teams) to resume once
  // the new season is named.
  const [seasonPromptOpen, setSeasonPromptOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"format" | "teams" | null>(null);
  // Phase D.2: was_finalized is the latch from migration 012 that tells the
  // banner + reopen flow whether this round was ever finalized. A reopened
  // round is is_complete=false AND was_finalized=true. Used to decide
  // whether to surface the Edit Round button and to construct scorecard
  // links with ?admin=1&edit=1 so the EditModeBanner pins on navigation.
  const [wasFinalized, setWasFinalized] = useState(false);
  const [blindDrawCount, setBlindDrawCount] = useState(0);
  const [reopenModal, setReopenModal] = useState(false);
  // True from mount until the first loadRoundForDate settles, and again any
  // time the date picker changes and the new date's load is in flight. Gates
  // the Today's Format and Edit Teams buttons so a fast tap during the load
  // window can't fire ensureRoundShell with stale (null) existingRoundId —
  // the May 11 duplicate-rounds race. See migration 006 for the DB-level
  // backstop that catches this if it ever escapes the UI gate.
  const [initialLoading, setInitialLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [bottomSheetPlayer, setBottomSheetPlayer] = useState<Player | null>(null);
  const [undoAction, setUndoAction] = useState<{ player: Player; fromTeam: number; toTeam: number } | null>(null);
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);
  // Wave 1A: a pending handicap-allowance change awaiting danger-modal confirm.
  // Only set when a score already exists (roundFormatLockedAt !== null); a
  // pre-score change writes immediately. null = no pending change / modal closed.
  const [pendingAllowance, setPendingAllowance] = useState<number | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // D.1: per-player round_players row info, used by the active-view ⋯ menu.
  // Keyed by player_id (since loadedTeams uses Player[] from the allPlayers
  // join, not the round_players row). Refreshed by refreshDropoutStates()
  // after a mark/undo write.
  const [playerRpInfo, setPlayerRpInfo] = useState<
    Record<number, { rpId: number; droppedAfterHole: number | null }>
  >({});

  // Per-player serialization for round_players writes. toggleInRoster fires
  // INSERT/DELETE; assignToTeam fires UPDATE of team_number. Both used to be
  // fire-and-forget, so a fast tap pattern (check player in → drag to team
  // before the INSERT lands) raced: the UPDATE matched 0 rows and team_number
  // stayed 0, which on next read looked like "nothing got saved." Now each
  // write awaits any prior write for the same player_id. Cross-player writes
  // still run in parallel.
  const writeQueueRef = useRef<Map<number, Promise<unknown>>>(new Map());
  const enqueueWrite = useCallback(
    (playerId: number, fn: () => PromiseLike<unknown>): Promise<unknown> => {
      const prev = writeQueueRef.current.get(playerId) ?? Promise.resolve();
      const next = prev.then(() => fn()).catch((err) => {
        console.error("[RoundSetup] round_players write failed for player", playerId, err);
      });
      writeQueueRef.current.set(playerId, next);
      return next;
    },
    [],
  );
  const drainWrites = useCallback(async () => {
    await Promise.all(Array.from(writeQueueRef.current.values()));
  }, []);

  // D.1: refresh just the dropped_after_hole values for the current round
  // after the overflow menu writes. Cheaper than reloading roster + teams.
  const refreshDropoutStates = useCallback(async () => {
    if (!existingRoundId) return;
    const { data } = await supabase
      .from("round_players")
      .select("id, player_id, dropped_after_hole")
      .eq("round_id", existingRoundId);
    if (!data) return;
    setPlayerRpInfo(prev => {
      const next = { ...prev };
      (data as any[]).forEach(r => {
        next[r.player_id] = {
          rpId: r.id,
          droppedAfterHole: r.dropped_after_hole ?? null,
        };
      });
      return next;
    });
  }, [existingRoundId]);

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
    // try/finally guarantees initialLoading flips back to false on every exit
    // path, including the two "no round" early returns below. Without it, the
    // button-disable gate could stick on forever if the first DB lookup short-
    // circuits — the May 11 race fix would silently lock the admin tab.
    setInitialLoading(true);
    try {
      setExistingRoundId(null);
      setIsRoundComplete(false);
      setWasFinalized(false);
      setBlindDrawCount(0);
      setRoundFormat(null);
      setRoundFormatConfig(null);
      setRoundFormatLockedAt(null);
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
        .from("rounds").select("id, is_complete, was_finalized, format, format_config, format_locked_at").eq("played_on", date)
        .order("played_on", { ascending: false }).limit(1);

      if (!rounds || rounds.length === 0) return;

      const round = rounds[0];
      setExistingRoundId(round.id);
      setIsRoundComplete(round.is_complete);
      setWasFinalized(!!(round as any).was_finalized);
      setRoundFormat((round.format ?? null) as Format | null);
      setRoundFormatConfig(((round as any).format_config ?? null) as FormatConfig | null);
      setRoundFormatLockedAt((round.format_locked_at ?? null) as string | null);

      // Phase D.2: count blind_draws for this round so the Edit Round
      // confirmation modal can warn the admin about preserved-but-stale
      // draws if any exist. count: "exact" + head: true → returns just
      // the count, no rows.
      const { count: bdCount } = await supabase
        .from("blind_draws")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      setBlindDrawCount(bdCount ?? 0);

      // Embedded join (B7 / TD2 pattern). Previously this query selected only
      // (player_id, team_number) and resolved the player record by id against
      // `allPlayers` — which the parent filters to is_active === true. Result:
      // any player rostered for the round who'd later been deactivated via the
      // Players tab was silently dropped from the admin view, while the
      // homepage (which uses this same embedded-join pattern) kept rendering
      // them. Active/inactive is a check-in-list concern, not a display-who's-
      // already-in concern.
      const { data: rps } = await supabase
        .from("round_players")
        .select("id, player_id, team_number, dropped_after_hole, players ( id, full_name, display_name, handicap_index, is_active, preferred_tee_id )")
        .eq("round_id", round.id);

      if (!rps || rps.length === 0) {
        setViewMode("active");
        setMobileStep("teams");
        return;
      }

      const loadedRoster: Player[] = [];
      const loadedTeams: Record<number, Player[]> = {};
      const loadedRpInfo: Record<number, { rpId: number; droppedAfterHole: number | null }> = {};

      rps.forEach((rp: any) => {
        // PostgREST embed returns the joined row as either an object (single
        // parent FK) or a single-element array depending on relationship
        // metadata. Same array-vs-object guard used on homepage.
        const playerRow = Array.isArray(rp.players) ? rp.players[0] : rp.players;
        if (!playerRow) return;
        const player: Player = {
          id: playerRow.id,
          full_name: playerRow.full_name,
          display_name: playerRow.display_name,
          handicap_index: playerRow.handicap_index,
          is_active: playerRow.is_active,
          preferred_tee_id: playerRow.preferred_tee_id ?? null,
        };
        loadedRoster.push(player);
        loadedRpInfo[playerRow.id] = {
          rpId: rp.id as number,
          droppedAfterHole: rp.dropped_after_hole ?? null,
        };
        const tn = rp.team_number;
        if (tn >= 1) {
          if (!loadedTeams[tn]) loadedTeams[tn] = [];
          loadedTeams[tn].push(player);
        }
      });

      setRoster(loadedRoster);
      setTeams(loadedTeams);
      setPlayerRpInfo(loadedRpInfo);

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
    } finally {
      setInitialLoading(false);
    }
  }, [allPlayers, loadScoreStatus]);

  useEffect(() => {
    if (allPlayers.length > 0) loadRoundForDate(selectedDate);
  }, [selectedDate, allPlayers, loadRoundForDate]);

  // ── Autosave assignment to DB ──────────────────────────────────────────────
  const autosaveAssignment = useCallback(async (playerId: number, teamNum: number) => {
    if (!existingRoundId) return;
    await enqueueWrite(playerId, () =>
      supabase.from("round_players")
        .update({ team_number: teamNum })
        .eq("round_id", existingRoundId)
        .eq("player_id", playerId)
    );
  }, [existingRoundId, enqueueWrite]);

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
        enqueueWrite(player.id, () =>
          supabase.from("round_players").delete()
            .eq("round_id", existingRoundId).eq("player_id", player.id)
        );
      }
    } else {
      setRoster(prev => [...prev, player]);
      if (existingRoundId) {
        enqueueWrite(player.id, () =>
          supabase.from("round_players").insert({
            round_id: existingRoundId, player_id: player.id, team_number: 0, tee_id: null,
            handicap_index_snapshot: player.handicap_index ?? null,
          })
        );
      }
    }
  };

  // ── Auto-create round shell when admin first taps Today's Format or Edit
  // Teams (and there's no round yet for the selected date). Both buttons go
  // through here so format-setting and team-building stay independent — either
  // can come first. Returns the round id (existing or freshly created), or
  // null on error so callers can bail.
  //
  // Delegates DB find-or-create to the shared ensureRoundShellHelper (see
  // src/lib/round/ensureRoundShell.ts). The component wrapper handles UI
  // concerns: the pre-check SELECT triggers loadRoundForDate for pre-existing
  // rounds (full state hydration); the INSERT path sets state directly.
  const ensureRoundShell = useCallback(async (): Promise<number | null> => {
    if (existingRoundId) return existingRoundId;
    setSaving(true);

    // Pre-check: SELECT for an existing round on this date. If one exists,
    // hydrate full UI state via loadRoundForDate so roster/teams/format are
    // consistent with the DB — covers the "tap before initial load settles" race.
    const { data: existing } = await supabase
      .from("rounds")
      .select("id")
      .eq("played_on", selectedDate)
      .order("played_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      setSaving(false);
      await loadRoundForDate(selectedDate);
      return existing.id;
    }

    // No round yet — season-aware create. If no season is active, bail and
    // open the name prompt; the prompt's confirm handler resumes creation.
    try {
      const res = await ensureSeasonAndRoundShell(selectedDate);
      if (res.status === "needs_season_name") {
        setSaving(false);
        setSeasonPromptOpen(true);
        return null;
      }
      const id = res.roundId;
      setSaving(false);
      setExistingRoundId(id);
      // Explicit reset of format state. In a fresh-mount path these are already
      // null from loadRoundForDate, but the in-place "delete round → tap Edit
      // Teams → ensureRoundShell" path can land here with stale format values
      // still cached in React. Resetting at the same point we set the new
      // round id keeps the format strip honest for the brand-new shell.
      setRoundFormat(null);
      setRoundFormatConfig(null);
      setRoundFormatLockedAt(null);
      setViewMode("active");
      return id;
    } catch (err: unknown) {
      setSaving(false);
      alert("Error creating round: " + (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }, [existingRoundId, selectedDate, loadRoundForDate]);

  const openTodaysFormat = useCallback(async () => {
    setPendingAction("format");
    const rid = await ensureRoundShell();
    if (!rid) return; // null = error OR the season prompt opened (resumes later)
    setPendingAction(null);
    setFormatPickerOpen(true);
  }, [ensureRoundShell]);

  const openEditTeams = useCallback(async () => {
    setPendingAction("teams");
    const rid = await ensureRoundShell();
    if (!rid) return; // null = error OR the season prompt opened (resumes later)
    setPendingAction(null);
    setViewMode("edit");
    setMobileStep("checkin");
  }, [ensureRoundShell]);

  // H3.4: resume round creation after the admin names the new season.
  const handleSeasonPromptConfirm = useCallback(async (name: string) => {
    setSeasonPromptOpen(false);
    setSaving(true);
    try {
      const res = await ensureSeasonAndRoundShell(selectedDate, { seasonName: name });
      setSaving(false);
      if (res.status !== "ok") return;
      setExistingRoundId(res.roundId);
      setRoundFormat(null);
      setRoundFormatConfig(null);
      setRoundFormatLockedAt(null);
      setViewMode("active");
      if (pendingAction === "format") {
        setFormatPickerOpen(true);
      } else if (pendingAction === "teams") {
        setViewMode("edit");
        setMobileStep("checkin");
      }
      setPendingAction(null);
    } catch (err: unknown) {
      setSaving(false);
      alert("Error starting season: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [selectedDate, pendingAction]);

  // Wave 1A: persist the handicap allowance into format_config, merging onto
  // whatever config is already there so format/basis/override/point_values are
  // preserved (allowance and format are independent controls). Open scorecards
  // pick up the new value on their next load.
  const writeAllowance = useCallback(async (value: number) => {
    if (!existingRoundId) return;
    setSaving(true);
    const nextConfig = {
      ...(roundFormatConfig ?? {}),
      handicap_allowance: value,
    } as FormatConfig;
    const { error } = await supabase
      .from("rounds")
      .update({ format_config: nextConfig })
      .eq("id", existingRoundId);
    setSaving(false);
    if (error) {
      alert("Couldn't save handicap allowance: " + error.message);
      return;
    }
    setRoundFormatConfig(nextConfig);
  }, [existingRoundId, roundFormatConfig]);

  // A no-op when unchanged. If a score already exists the change routes through
  // the existing dangerous-action modal (net recalculates); otherwise it writes
  // immediately.
  const onAllowanceChange = useCallback((value: number) => {
    if (value === getHandicapAllowance(roundFormatConfig)) return;
    if (roundFormatLockedAt !== null) {
      setPendingAllowance(value);
    } else {
      void writeAllowance(value);
    }
  }, [roundFormatConfig, roundFormatLockedAt, writeAllowance]);

  // ── Mobile: transition checkin → teams ────────────────────────────────────
  // TD4 fix (2026-05-10): diff-based reconciliation instead of delete-all +
  // reinsert. Rows that exist in both sets are never touched, so a partial
  // failure can no longer wipe out team assignments. Only players removed
  // from the roster get deleted; only newly checked-in players get inserted.
  const goToTeams = async () => {
    if (!existingRoundId) return;
    setSaving(true);

    // Drain any in-flight INSERT/DELETE from toggleInRoster before reading,
    // otherwise the diff sees stale DB state and may queue duplicate INSERTs.
    await drainWrites();

    const { data: existing } = await supabase
      .from("round_players").select("player_id, team_number").eq("round_id", existingRoundId);

    const existingMap: Record<number, number> = {};
    const existingIds = new Set<number>();
    existing?.forEach((rp: any) => {
      existingMap[rp.player_id] = rp.team_number ?? 0;
      existingIds.add(rp.player_id);
    });
    const rosterIds = new Set(roster.map(p => p.id));

    const toRemove: number[] = [];
    existingIds.forEach(id => { if (!rosterIds.has(id)) toRemove.push(id); });
    const toAdd = roster.filter(p => !existingIds.has(p.id));

    if (toRemove.length > 0) {
      await supabase.from("round_players")
        .delete()
        .eq("round_id", existingRoundId)
        .in("player_id", toRemove);
    }
    if (toAdd.length > 0) {
      await supabase.from("round_players").insert(
        toAdd.map(p => ({
          round_id: existingRoundId,
          player_id: p.id,
          team_number: 0,
          tee_id: null,
          handicap_index_snapshot: p.handicap_index ?? null,
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

  // ── Phase D.2: reopen a finalized round ───────────────────────────────────
  // Stays on Round Setup tab so admin can use the existing Edit Teams flow
  // to add players. Scorecard navigation links pick up ?admin=1&edit=1
  // automatically when wasFinalized && !isRoundComplete.
  const doReopenRound = async () => {
    if (!existingRoundId) return;
    setReopenModal(false);
    setSaving(true);
    try {
      await reopenRound(existingRoundId);
      await loadRoundForDate(selectedDate);
    } catch (err) {
      alert("Error reopening round: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
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
    // Re-run the canonical load path so every piece of round-derived state
    // (including roundFormat / roundFormatConfig / roundFormatLockedAt, which
    // the old manual reset block missed) is rebuilt from a fresh DB read.
    // Single source of truth — no risk of state-reset drift between delete
    // and load.
    await loadRoundForDate(selectedDate);
    setSaving(false);
  };

  // ── Exit edit mode ─────────────────────────────────────────────────────────
  const doneEditing = async () => {
    // Drain in-flight writes so the reload reads post-write state. Without
    // this, the team-assignment UPDATE from a Done-immediately-after-drag tap
    // could still be pending when loadRoundForDate runs.
    await drainWrites();
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

  // Today's Format + Edit Teams pair sits above team cards in both empty
  // ("none") and populated ("active") view modes. Either button auto-creates a
  // round shell first if none exists — format-setting and team-building are
  // fully independent entry points.
  const formatBtnIsGold = roundFormat === null;
  const formatLabel = roundFormat === null
    ? "Pick today's format"
    : FORMAT_LABELS[roundFormat].title;
  const formatStrip = (
    <div style={{
      padding: "14px 16px 4px",
      display: "flex", flexDirection: "column", gap: "10px",
      maxWidth: "700px", margin: "0 auto", width: "100%",
      boxSizing: "border-box",
    }}>
      <button
        onClick={openTodaysFormat}
        disabled={saving || initialLoading}
        style={{
          width: "100%", padding: "11px 14px", borderRadius: "10px",
          background: formatBtnIsGold ? C.gold : "#fff",
          border: formatBtnIsGold ? "none" : `1px solid #e4e4e4`,
          color: "#1a1a1a",
          // Grey out only while the initial round-for-date load is in flight,
          // so an impatient tap can't fire ensureRoundShell with a stale null
          // existingRoundId. `saving` keeps its existing visual treatment
          // (cursor change only) to match the rest of the file.
          opacity: initialLoading ? 0.5 : 1,
          cursor: saving || initialLoading ? "default" : "pointer",
          fontFamily: C.font, textAlign: "left",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
          <span style={{
            fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
            color: formatBtnIsGold ? "#6b4e00" : "#64748b",
          }}>
            Today's Format
          </span>
          <span style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: "0.98rem", fontWeight: 700,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{formatLabel}</span>
            {roundFormatLockedAt !== null && (
              <span aria-label="locked" title="Locked — first score entered" style={{ display: "inline-flex", color: "#64748b", flexShrink: 0 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
            )}
          </span>
        </span>
        <span style={{
          fontSize: formatBtnIsGold ? "0.95rem" : "0.82rem",
          fontWeight: formatBtnIsGold ? 700 : 600,
          color: formatBtnIsGold ? "#1a1a1a" : C.navy, flexShrink: 0,
        }}>
          {formatBtnIsGold ? "→" : "Change"}
        </span>
      </button>

      {/* Wave 1A: handicap allowance selector. Sibling to Today's Format —
          writes format_config.handicap_allowance. Only meaningful once a round
          shell exists (hidden in the no-round empty state). A mid-round change
          (a score already exists) routes through the danger modal below. */}
      {existingRoundId !== null && (
        <div style={{
          width: "100%", padding: "11px 14px", borderRadius: "10px",
          background: "#fff", border: `1px solid #e4e4e4`,
          opacity: initialLoading ? 0.5 : 1,
          fontFamily: C.font,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        }}>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
            <span style={{
              fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
              color: "#64748b",
            }}>
              Handicap Allowance
            </span>
            <span style={{ fontSize: "0.98rem", fontWeight: 700, color: "#1a1a1a" }}>
              {/* Wave 1B: team-card formats (Shambles, …) are gross only — no
                  per-player handicap to scale, so the allowance is N/A and the
                  control is disabled. */}
              {isTeamCardFormat(roundFormat) ? (
                <span style={{ fontWeight: 500, color: "#64748b" }}>N/A · gross only</span>
              ) : (
                <>
                  {getHandicapAllowance(roundFormatConfig)}%
                  {getHandicapAllowance(roundFormatConfig) === 100 && (
                    <span style={{ fontWeight: 500, color: "#64748b" }}> · full</span>
                  )}
                </>
              )}
            </span>
          </span>
          <select
            aria-label="Handicap allowance percent"
            value={getHandicapAllowance(roundFormatConfig)}
            disabled={saving || initialLoading || isRoundComplete || isTeamCardFormat(roundFormat)}
            onChange={e => onAllowanceChange(Number(e.target.value))}
            style={{
              padding: "8px 10px", borderRadius: "8px",
              border: `1px solid #cbd5e1`, background: "#fff",
              fontSize: "0.95rem", fontWeight: 600, color: C.navy,
              fontFamily: C.font,
              opacity: isTeamCardFormat(roundFormat) ? 0.5 : 1,
              cursor: saving || initialLoading || isRoundComplete || isTeamCardFormat(roundFormat) ? "default" : "pointer",
            }}
          >
            {ALLOWANCE_OPTIONS.map(v => (
              <option key={v} value={v}>{v}%</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={openEditTeams}
        disabled={saving || initialLoading}
        style={{
          width: "100%", padding: "13px 14px", borderRadius: "10px",
          background: C.gold, border: "none", color: "#1a1a1a",
          fontSize: "0.95rem", fontWeight: 700,
          // Same gate + visual as Today's Format above — see comment there.
          opacity: initialLoading ? 0.5 : 1,
          cursor: saving || initialLoading ? "default" : "pointer",
          fontFamily: C.font, textAlign: "left",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span>Edit Teams</span>
        <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>→</span>
      </button>
    </div>
  );

  // Wave 1A: mid-round allowance change confirmation (reuses the shared danger
  // modal, same pattern as a post-lock format_config change in FormatPicker).
  const allowanceDangerModal = pendingAllowance !== null && (
    <DangerModal
      title="Change handicap allowance mid-round?"
      description={`Net scores will recalculate at ${pendingAllowance}% handicaps. Gross scores are unchanged.`}
      cannotBeUndone={false}
      confirmLabel="Change allowance"
      onConfirm={() => {
        const v = pendingAllowance;
        setPendingAllowance(null);
        void writeAllowance(v);
      }}
      onCancel={() => setPendingAllowance(null)}
    />
  );

  const formatPicker = (
    <FormatPicker
      open={formatPickerOpen}
      roundId={existingRoundId ?? 0}
      currentFormat={roundFormat}
      currentConfig={roundFormatConfig}
      formatLocked={roundFormatLockedAt !== null}
      onClose={() => setFormatPickerOpen(false)}
      onSaved={() => {
        setFormatPickerOpen(false);
        loadRoundForDate(selectedDate);
      }}
    />
  );

  const seasonModal = seasonPromptOpen ? (
    <SeasonStartModal
      defaultName={defaultSeasonName()}
      onConfirm={handleSeasonPromptConfirm}
      onCancel={() => { setSeasonPromptOpen(false); setPendingAction(null); }}
    />
  ) : null;

  // ── STATE 1: No round ──────────────────────────────────────────────────────
  if (viewMode === "none") {
    return (
      <div style={{ fontFamily: C.font }}>
        {hero}
        {statsRow}
        {formatStrip}
        <div style={{ padding: "32px 24px 100px", textAlign: "center", maxWidth: "400px", margin: "0 auto" }}>
          <div style={{ fontSize: "2.4rem", marginBottom: "10px", opacity: 0.55 }}>⛳</div>
          <div style={{ fontSize: "0.88rem", color: "#9ca3af", lineHeight: 1.5 }}>
            No round yet. Tap a button above to start — format and teams are independent, set either one first.
          </div>
        </div>
        {dangerModal}
        {allowanceDangerModal}
        {formatPicker}
        {seasonModal}
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
        {formatStrip}

        <div style={{ padding: "16px", maxWidth: "700px", margin: "0 auto", paddingBottom: "100px" }}>
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
                      {players.map(p => {
                        const info = playerRpInfo[p.id];
                        const dropped = info?.droppedAfterHole ?? null;
                        return (
                          <div
                            key={p.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              minHeight: 24,
                            }}
                          >
                            <span style={{
                              fontSize: "0.85rem", fontWeight: 500,
                              color: dropped != null ? "#6b7280" : "#1e293b",
                            }}>
                              {p.display_name || p.full_name}
                            </span>
                            {dropped != null && (
                              <span style={{
                                fontSize: "0.7rem", color: "#6b7280",
                                fontStyle: "italic",
                              }}>
                                left after hole {dropped}
                              </span>
                            )}
                            {info && (
                              <span style={{ marginLeft: "auto" }}>
                                <PlayerOverflowMenu
                                  roundPlayerId={info.rpId}
                                  playerName={p.display_name || p.full_name}
                                  droppedAfterHole={dropped}
                                  isRoundComplete={isRoundComplete}
                                  surface="admin"
                                  onChanged={refreshDropoutStates}
                                />
                              </span>
                            )}
                          </div>
                        );
                      })}
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
                    {existingRoundId && (() => {
                      // Phase D.2: reopened rounds (is_complete=false AND
                      // was_finalized=true) need ?admin=1&edit=1 on the
                      // scorecard URL so the EditModeBanner pins and the
                      // Edit HI affordances render.
                      const isReopened = wasFinalized && !isRoundComplete;
                      const href = isReopened
                        ? `/round/${existingRoundId}/scorecard?team=${tn}&admin=1&edit=1`
                        : `/round/${existingRoundId}/scorecard?team=${tn}`;
                      return (
                        <Link href={href} style={{
                          fontSize: "0.75rem", fontWeight: 600, color: tc.pillText, textDecoration: "none",
                        }}>
                          Open scorecard →
                        </Link>
                      );
                    })()}
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

          {/* Phase D.2: Edit Round button. Visible on every round
              (active OR finalized), any date. Reopen of an active round
              is a no-op on is_complete but still useful for clearing
              submitted_teams if a team submitted prematurely. */}
          <div style={{ marginTop: "24px" }}>
            <button onClick={() => setReopenModal(true)} disabled={saving} style={{
              width: "100%", padding: "13px", borderRadius: "9px",
              border: `1.5px solid ${C.navy}`, background: "transparent",
              color: C.navy, fontSize: "0.9rem", fontWeight: 600,
              cursor: "pointer", fontFamily: C.font,
            }} data-testid="edit-round-button">
              Edit round
            </button>
          </div>

          <div style={{ marginTop: "10px" }}>
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
        {allowanceDangerModal}
        {reopenModal && (
          <DangerModal
            title={isRoundComplete ? "Reopen this round?" : "Reset this round's submissions?"}
            description={
              blindDrawCount > 0
                ? `This round has ${blindDrawCount} blind ${blindDrawCount === 1 ? "draw" : "draws"} on file — they will be preserved and NOT recomputed against any new teams you add. Do not add players to teams that already had blind draws applied — their drawn scores will become stale.`
                : (isRoundComplete
                    ? "The round will return to active state until you finalize it again."
                    : "Cleared submitted-team flags so admin can re-submit. Scores are untouched.")
            }
            confirmLabel={isRoundComplete ? "Reopen round" : "Reset submissions"}
            cannotBeUndone={false}
            onConfirm={doReopenRound}
            onCancel={() => setReopenModal(false)}
          />
        )}
        {formatPicker}
        {seasonModal}
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
            saving ? "Saving…" : roster.length === 0 ? "Check in at least one player" : `Assign to teams → (${roster.length} players)`,
            goToTeams,
            roster.length === 0 || saving
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
