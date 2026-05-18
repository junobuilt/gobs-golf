"use client";

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import DangerModal from "@/app/thomas-admin/components/DangerModal";
import {
  computeCourseHandicap,
  computeHoleResult,
  computeRoundResult,
  getHandicapStrokes,
} from "@/lib/scoring";
import type { HoleInfo as EngineHoleInfo, Format, FormatConfig } from "@/lib/scoring";
import ScorecardLockNotice from "@/components/format/ScorecardLockNotice";
import FormatChip from "@/components/format/FormatChip";
import { getScoringBasis, getOverrideHoles } from "@/lib/format/helpers";
import { formatTeamTotal } from "@/lib/format/copy";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { getWriteQueue } from "@/lib/writeQueue";
import type { QueueItem } from "@/lib/writeQueue";
import ReconciliationDialog, {
  type StuckScoreItem,
} from "@/components/scorecard/ReconciliationDialog";
import FinishingSpinner from "@/components/scorecard/FinishingSpinner";
import { formatStuckItemsForClipboard } from "@/components/scorecard/stuckItemsClipboard";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import PlayerOverflowMenu from "@/components/round/PlayerOverflowMenu";

// --- TYPES ---
interface RoundPlayer {
  id: number;
  tee_id: number | null;
  display_name: string;
  handicap_index: number | null;
  course_handicap: number | null;
  preferred_tee_id: number | null;
  dropped_after_hole: number | null;
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

// F9 / B9 leg ranges for the team-net pill cumulative row.
const F9_HOLES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const B9_HOLES = [10, 11, 12, 13, 14, 15, 16, 17, 18];

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
  const [roundFormatConfig, setRoundFormatConfig] = useState<FormatConfig | null>(null);
  const [roundFormatLockedAt, setRoundFormatLockedAt] = useState<string | null>(null);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endRoundModal, setEndRoundModal] = useState(false);
  const [removePlayerModal, setRemovePlayerModal] = useState<number | null>(null);

  // --- Phase D: End-Round reconciliation state ---
  // null = no end-round flow active; otherwise the dialog/spinner phase.
  const [endRoundPhase, setEndRoundPhase] = useState<
    null | "draining" | "first-dialog" | "second-dialog"
  >(null);
  // Shown ~15s into the hail-mary drain — see D9.
  const [showSkipDuringDrain, setShowSkipDuringDrain] = useState(false);
  // Items surfaced in the reconciliation dialog (post-drain stuck writes).
  const [stuckItems, setStuckItems] = useState<QueueItem[]>([]);
  // "Copied ✓" feedback on the second-attempt dialog's clipboard button.
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  // Disables dialog buttons while a retry drain is mid-flight.
  const [retryBusy, setRetryBusy] = useState(false);
  // Resolves the Promise.race when the user taps "Skip and finish" during
  // the spinner. Set/cleared by the hail-mary orchestrator.
  const skipResolveRef = useRef<(() => void) | null>(null);
  // Date the round was played, surfaced in the clipboard payload.
  const [roundPlayedOn, setRoundPlayedOn] = useState<string | null>(null);

  // D.1 — auto-finalize state. `finalizePending` gates the useEffect so we
  // only attempt the RPC once per locally-complete state; it resets when the
  // predicate flips back false (admin undoes a dropout, score gets cleared,
  // etc.). `finalizedToast` shows S5's confirmation; `poolErrorVisible`
  // shows the S4 defensive-abort message.
  const [finalizePending, setFinalizePending] = useState(false);
  const [autoFinalizing, setAutoFinalizing] = useState(false);
  const [finalizedToastVisible, setFinalizedToastVisible] = useState(false);
  const [poolErrorVisible, setPoolErrorVisible] = useState(false);
  // D.1 S2 — true when every team other than this one has all required
  // scores entered. Combined with "this team on hole 17/18" + round not yet
  // complete, drives the yellow pre-fire banner. Refreshed on mount + on
  // every score write + after dropout state changes.
  const [otherTeamsComplete, setOtherTeamsComplete] = useState(false);

  // D.1 S6 read-only scorecard. After finalize, dropout fills pair with the
  // dropped player by holeRangeStart = droppedAfterHole + 1. Keyed by
  // round_players.id so the per-hole big number + expanded PlayerHoleGrid
  // can render the drawn player's scores in the post-drop range, with
  // a 🎲 (blind draw) caption.
  const [fillsByRpId, setFillsByRpId] = useState<
    Record<number, { drawnPlayerName: string; drawnScores: (number | null)[]; holeRangeStart: number; holeRangeEnd: number }>
  >({});

  // Inline handicap entry for players without one
  const [tempHandicaps, setTempHandicaps] = useState<Record<number, string>>({});

  // Per-hole manual overrides: which 2 round_player ids count
  const [countingOverrides, setCountingOverrides] = useState<Record<number, number[]>>({});

  // D.1 auto-fire effect. Locally compute completion; if the predicate flips
  // true and we haven't already attempted, kick off the drain + RPC. The
  // pending flag prevents the effect from re-entering during the async call.
  // It resets when the predicate flips false again (admin undid a dropout,
  // a score got cleared, etc.) so a later legitimate completion still fires.
  useEffect(() => {
    if (isRoundComplete) return;
    if (autoFinalizing) return;
    const localComplete = isRoundLocallyComplete();
    if (!localComplete) {
      if (finalizePending) setFinalizePending(false);
      return;
    }
    if (finalizePending) return;
    setFinalizePending(true);
    void autoFinalizeIfReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, roundPlayers, isRoundComplete]);

  // A1.7: player rows expanded to show the per-player hole-by-hole grid.
  // Multi-expand — tapping one player does not collapse the others.
  const [expandedPlayers, setExpandedPlayers] = useState<Set<number>>(new Set());
  const toggleExpandedPlayer = (rpId: number) => {
    setExpandedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(rpId)) next.delete(rpId);
      else next.add(rpId);
      return next;
    });
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setTeamFilter(urlParams.get("team"));

    async function load() {
      const { data: roundRow } = await supabase
        .from("rounds")
        .select("format, format_config, format_locked_at, is_complete, played_on")
        .eq("id", roundId)
        .maybeSingle();
      const roundIsComplete = !!roundRow?.is_complete;
      if (roundRow) {
        setRoundFormat((roundRow.format ?? null) as Format | null);
        setRoundFormatConfig((roundRow.format_config ?? null) as FormatConfig | null);
        setRoundFormatLockedAt((roundRow.format_locked_at ?? null) as string | null);
        setIsRoundComplete(roundIsComplete);
        setRoundPlayedOn((roundRow.played_on ?? null) as string | null);
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
        .select(`id, tee_id, course_handicap, dropped_after_hole, players ( full_name, display_name, handicap_index, preferred_tee_id )`)
        .eq("round_id", roundId);

      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        let playersData: RoundPlayer[] = rp.map((r: any) => ({
          id: r.id,
          tee_id: r.tee_id,
          display_name: r.players?.display_name || r.players?.full_name || "?",
          handicap_index: r.players?.handicap_index != null ? Number(r.players.handicap_index) : null,
          course_handicap: r.course_handicap != null ? Number(r.course_handicap) : null,
          preferred_tee_id: r.players?.preferred_tee_id ?? null,
          dropped_after_hole: r.dropped_after_hole ?? null,
        }));

        // LT1 fix (2026-05-09): recompute Course Handicap on every load from
        // the player's current handicap_index + selected tee. The stored
        // round_players.course_handicap is a snapshot captured at round-
        // creation and goes stale if admin edits HI after the round is
        // created (the original LT1 symptom on Kevin/Wayne, May 8 round).
        // Self-healing per page load. Single source of truth in this file:
        // row CH display, dots, and engine all read rp.course_handicap from
        // state, so updating playersData here corrects all three sites.
        // Skip on completed rounds (frozen historical data) and on players
        // missing HI or tee. DB writeback is fire-and-forget so downstream
        // consumers (summary, leaderboard, season) read the corrected value
        // on their next load — they don't currently recompute themselves.
        if (!roundIsComplete) {
          playersData = playersData.map(p => {
            if (p.handicap_index == null || p.tee_id == null) return p;
            const tee = formattedTees.find(t => t.id === p.tee_id);
            if (!tee) return p;
            const expected = computeCourseHandicap(
              p.handicap_index, tee.slope_rating, tee.course_rating, tee.par,
            );
            if (expected === p.course_handicap) return p;
            // Fire-and-forget DB writeback. Local state already corrected
            // above; the write is for downstream consumers (summary,
            // leaderboard, season) that read the cached value directly.
            void supabase.from("round_players")
              .update({ course_handicap: expected })
              .eq("id", p.id)
              .then(() => { /* swallow; reload will retry on next mount */ });
            return { ...p, course_handicap: expected };
          });
        }

        setRoundPlayers(playersData);

        const allSet = playersData.every(p => p.tee_id !== null && p.tee_id !== 0);
        setNeedsSetup(!allSet);

        // Phase C: drain the write queue before rehydrating from the DB.
        // Any items left from a previous session (offline scores, failed
        // writes) need to land in Supabase before we fetch the canonical
        // scores; otherwise the DB rehydrate would mask the pending
        // writes. drain() returns immediately if offline — see overlay
        // below for that case.
        try {
          await getWriteQueue().drain();
        } catch {
          // Queue drain failures shouldn't block the page from loading.
        }

        const { data: s } = await supabase
          .from("scores")
          .select("*")
          .in("round_player_id", rp.map((r: any) => r.id));

        const scoreMap: Record<number, Record<number, number>> = {};
        s?.forEach(item => {
          if (!scoreMap[item.round_player_id]) scoreMap[item.round_player_id] = {};
          scoreMap[item.round_player_id][item.hole_number] = item.strokes;
        });

        // Phase C: overlay any queue items still pending or in-flight for
        // this round. Drain may have skipped (offline) or items may have
        // failed retry; either way, the user's optimistic state should
        // survive across mount cycles. This is the core Bug 1 fix —
        // without the overlay, the DB-rehydrate path replaces the
        // optimistic value with whatever Supabase has (often nothing).
        const queueItems = getWriteQueue().getItems();
        for (const item of queueItems) {
          if (item.state === "terminal_failure") continue;
          if (item.payload.round_id !== Number(roundId)) continue;
          if (!scoreMap[item.payload.round_player_id]) {
            scoreMap[item.payload.round_player_id] = {};
          }
          scoreMap[item.payload.round_player_id][item.payload.hole_number] = item.payload.strokes;
        }

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
      // D.1 S2 — initial fetch for the pre-fire banner. Subsequent updates
      // come from setScore / refreshDropoutStates.
      void refreshOtherTeamsState();
      // D.1 S6 — load dropout fills for the read-only post-finalize view.
      // Safe to run pre-finalize too: returns no rows.
      void refreshBlindDrawFills();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const ensureFormatLocked = async () => {
    if (roundFormatLockedAt !== null) return;
    const { data } = await supabase
      .from("rounds")
      .update({ format_locked_at: new Date().toISOString() })
      .eq("id", roundId)
      .is("format_locked_at", null)
      .select("format_locked_at")
      .maybeSingle();
    if (data?.format_locked_at) {
      setRoundFormatLockedAt(data.format_locked_at as string);
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

    // Phase C: enqueue the write rather than awaiting Supabase directly.
    // Optimistic state is already set above; the queue handles persistence,
    // retry, backoff, and tab-eviction durability. Phase A's upsert path
    // is now the queue's writer (src/lib/writeQueue/instance.ts), so the
    // DB conflict resolution stays the same. End-Round reconciliation
    // (Phase D) and the stale-failure prompt (Phase E) will surface any
    // items that fail to drain — for now, the queue retries silently in
    // the background.
    const player = roundPlayers.find(p => p.id === rpId);
    getWriteQueue().enqueue(
      {
        round_id: Number(roundId),
        round_player_id: rpId,
        hole_number: hole,
        strokes,
      },
      {
        player_name: player?.display_name ?? "Player",
        hole_label: `Hole ${hole}`,
        // Phase E: included so the stale-failure prompt can render which
        // round each stuck item came from. Falls back to the queue
        // item's enqueued_at if absent (older items pre-dating this).
        round_date: roundPlayedOn,
      },
    );

    // First successful score for this round locks the format. Idempotent:
    // skipped on subsequent calls via the local short-circuit, and the DB
    // UPDATE guards with `WHERE format_locked_at IS NULL` as a safety net.
    void ensureFormatLocked();

    // D.1 S2 — refresh other-teams completion so the pre-fire banner picks
    // up another group finishing as we score. Cheap and async; doesn't
    // block the score entry.
    void refreshOtherTeamsState();
  };

  const removePlayer = async (rpId: number) => {
    await supabase.from("round_players").update({ team_number: 0 }).eq("id", rpId);
    setRoundPlayers(prev => prev.filter(p => p.id !== rpId));
    setRemovePlayerModal(null);
  };

  // D.1: refresh dropped_after_hole values after the overflow menu writes.
  // Cheaper than a full reload — only round_players state for this round
  // needs updating; scores, tees, holes are unchanged.
  const refreshDropoutStates = async () => {
    const { data } = await supabase
      .from("round_players")
      .select("id, dropped_after_hole")
      .eq("round_id", roundId);
    if (!data) return;
    const map: Record<number, number | null> = {};
    (data as any[]).forEach(r => { map[r.id] = r.dropped_after_hole ?? null; });
    setRoundPlayers(prev =>
      prev.map(p => ({ ...p, dropped_after_hole: map[p.id] ?? null }))
    );
    // Dropout state of OTHER teams could have changed (admin marks a player
    // dropped from the admin tab; refreshDropoutStates fires here). Re-
    // evaluate the banner.
    void refreshOtherTeamsState();
  };

  // D.1: local mirror of the RPC's server-side completion check. Every non-
  // dropped player must have 18 holes scored; every dropped player must have
  // scores through their dropped_after_hole. Predicate flipping true triggers
  // the auto-finalize effect.
  const isRoundLocallyComplete = (): boolean => {
    if (roundPlayers.length === 0) return false;
    return roundPlayers.every(rp => {
      const required = rp.dropped_after_hole ?? 18;
      const rpScores = scores[rp.id] ?? {};
      for (let h = 1; h <= required; h++) {
        if (rpScores[h] == null) return false;
      }
      return true;
    });
  };

  // D.1 S6 — load all dropout fills for this round and pair each with its
  // dropped player (by droppedAfterHole = holeRangeStart - 1). Round-start
  // fills (holeRangeStart=1) don't pair to a scorecard slot since the team
  // has no round_players row for them; those surfaces live in the summary
  // view's pseudo-player rows.
  const refreshBlindDrawFills = async () => {
    const { data: fills } = await supabase
      .from("blind_draws")
      .select(`
        short_team_number, drawn_player_id, hole_range_start, hole_range_end,
        players ( display_name, full_name )
      `)
      .eq("round_id", roundId)
      .gt("hole_range_start", 1);
    if (!fills || fills.length === 0) {
      setFillsByRpId({});
      return;
    }
    // Pair each dropout fill to a round_players row in this team filter
    // (or the whole round if no filter). Fetch fresh data: rp.id +
    // droppedAfterHole + scores for the drawn player.
    const { data: localRps } = await supabase
      .from("round_players")
      .select("id, team_number, dropped_after_hole")
      .eq("round_id", roundId)
      .gt("team_number", 0);
    if (!localRps) return;
    // Look up the drawn player's round_players row to get their 18-hole
    // scores. The drawn player is on another team in the same round.
    const drawnPlayerIds = (fills as any[]).map(f => f.drawn_player_id as number);
    const { data: drawnRps } = await supabase
      .from("round_players")
      .select("id, player_id")
      .eq("round_id", roundId)
      .in("player_id", drawnPlayerIds);
    const drawnRpIdByPlayer: Record<number, number> = {};
    (drawnRps ?? []).forEach((r: any) => { drawnRpIdByPlayer[r.player_id] = r.id; });
    const { data: drawnScoreRows } = await supabase
      .from("scores")
      .select("round_player_id, hole_number, strokes")
      .in("round_player_id", Object.values(drawnRpIdByPlayer));
    const drawnScoresByRp: Record<number, Record<number, number>> = {};
    (drawnScoreRows ?? []).forEach((s: any) => {
      if (!drawnScoresByRp[s.round_player_id]) drawnScoresByRp[s.round_player_id] = {};
      drawnScoresByRp[s.round_player_id][s.hole_number] = s.strokes;
    });

    const next: typeof fillsByRpId = {};
    const droppedPool = (localRps as any[]).filter(
      r => r.dropped_after_hole != null,
    );
    for (const fill of fills as any[]) {
      const target = (fill.hole_range_start as number) - 1;
      const idx = droppedPool.findIndex(
        r => r.team_number === fill.short_team_number && r.dropped_after_hole === target,
      );
      if (idx < 0) continue;
      const matched = droppedPool[idx];
      droppedPool.splice(idx, 1);
      const drawnRpId = drawnRpIdByPlayer[fill.drawn_player_id];
      const drawnScoresMap = drawnRpId != null ? (drawnScoresByRp[drawnRpId] || {}) : {};
      const drawnScores: (number | null)[] = Array.from(
        { length: 18 }, (_, i) => drawnScoresMap[i + 1] ?? null,
      );
      const drawnPlayerRow = Array.isArray(fill.players) ? fill.players[0] : fill.players;
      const drawnName = drawnPlayerRow?.display_name || drawnPlayerRow?.full_name || "?";
      next[matched.id] = {
        drawnPlayerName: drawnName,
        drawnScores,
        holeRangeStart: fill.hole_range_start,
        holeRangeEnd: fill.hole_range_end,
      };
    }
    setFillsByRpId(next);
  };

  // D.1 S2 — refetches completion state for every team OTHER than the one
  // shown by this scorecard view. Cheap (~2 queries) and runs only on
  // score-write or dropout-change events, so the once-mounted cost is bounded.
  // When `teamFilter` is null (whole-round view), the banner does not apply
  // and we leave the flag false.
  const refreshOtherTeamsState = async () => {
    if (!teamFilter) {
      setOtherTeamsComplete(false);
      return;
    }
    const myTeam = parseInt(teamFilter, 10);
    const { data: rps } = await supabase
      .from("round_players")
      .select("id, team_number, dropped_after_hole")
      .eq("round_id", roundId)
      .gt("team_number", 0)
      .neq("team_number", myTeam);
    if (!rps || rps.length === 0) {
      // Lone team — there's no "other" team to wait on. Banner doesn't apply.
      setOtherTeamsComplete(false);
      return;
    }
    const otherRpIds = (rps as any[]).map(r => r.id as number);
    const { data: scoreRows } = await supabase
      .from("scores")
      .select("round_player_id, hole_number")
      .in("round_player_id", otherRpIds);
    const holesByRp: Record<number, Set<number>> = {};
    (scoreRows ?? []).forEach((s: any) => {
      if (!holesByRp[s.round_player_id]) holesByRp[s.round_player_id] = new Set();
      holesByRp[s.round_player_id].add(s.hole_number);
    });
    const allComplete = (rps as any[]).every(rp => {
      const required = rp.dropped_after_hole ?? 18;
      const got = holesByRp[rp.id] ?? new Set<number>();
      for (let h = 1; h <= required; h++) {
        if (!got.has(h)) return false;
      }
      return true;
    });
    setOtherTeamsComplete(allComplete);
  };

  // D.1 auto-fire (S3 + S5). Drains the queue so the latest score lands
  // server-side before the RPC reads it, then calls
  // finalize_round_with_blind_draws. Branches:
  //   'finalized'       → toast (S5), flip local is_complete
  //   'already_complete' → silent (another tab raced and won)
  //   'pool_too_small'  → red banner (S4 defensive abort)
  //   'not_yet'         → silent (a write hasn't reached the DB yet; the
  //                       useEffect will re-fire on the next state change)
  const autoFinalizeIfReady = async () => {
    if (autoFinalizing) return;
    setAutoFinalizing(true);
    try {
      try { await getWriteQueue().drain(); } catch { /* offline; try anyway */ }
      const { data, error } = await supabase.rpc(
        "finalize_round_with_blind_draws",
        { p_round_id: Number(roundId) },
      );
      if (error) {
        // Unexpected RPC failure. Don't redirect; surface in console for
        // debugging. The next score-state change will retry.
        console.warn("[D.1] finalize RPC error", error);
        // Allow retry on next change.
        setFinalizePending(false);
        return;
      }
      const status = (data ?? "") as string;
      if (status === "finalized") {
        setIsRoundComplete(true);
        setFinalizedToastVisible(true);
        setTimeout(() => setFinalizedToastVisible(false), 4000);
        // D.1 S6 — pick up freshly written blind_draws rows so the read-only
        // view shows the fills without a page reload.
        void refreshBlindDrawFills();
      } else if (status === "already_complete") {
        // Silent — but reflect the DB state locally.
        setIsRoundComplete(true);
        void refreshBlindDrawFills();
      } else if (status === "pool_too_small") {
        setPoolErrorVisible(true);
        setTimeout(() => setPoolErrorVisible(false), 6000);
      } else if (status === "not_yet") {
        // Likely a write was still in flight. Let the effect retry.
        setFinalizePending(false);
      }
    } finally {
      setAutoFinalizing(false);
    }
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
    if (!roundFormat || !roundFormatConfig) return null;
    const override = countingOverrides[holeNumber];
    // B3.2 trick: when admin selected "gross" as the persistent scoring basis,
    // zero out handicaps before passing to the engine. Net == gross for every
    // format including Stableford (which has no internal `basis` branch).
    const useGross = getScoringBasis(roundFormatConfig) === "gross";
    return computeHoleResult({
      format: roundFormat,
      formatConfig: { ...roundFormatConfig, basis: mode },
      hole,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        grossScore: scores[rp.id]?.[holeNumber] ?? null,
        courseHandicap: useGross ? 0 : rp.course_handicap,
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
    const useGross = getScoringBasis(roundFormatConfig) === "gross";
    return computeRoundResult({
      format: roundFormat!,
      formatConfig: { ...roundFormatConfig!, basis: mode },
      holes,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        courseHandicap: useGross ? 0 : rp.course_handicap,
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

  // A1.6: cumulative net delta for a subset of holes (F9 / B9 / Tot on the
  // team-net pill). Returns null when no hole in the range has a team score
  // yet — caller renders "—". For best-N this is teamScoreSubtotal -
  // teamParSubtotal (same convention as the headline `teamNet - teamPar`).
  // For Stableford-family teamParAtScored is 0 by engine contract, so the
  // value collapses to absolute points and `formatTeamTotal` renders "X pts".
  // Passing all 18 holes here equals the headline delta — Nassau payouts
  // care about all three legs.
  const getTeamNetDeltaForHoles = (holeNumbers: number[]): number | null => {
    if (!roundFormat || !roundFormatConfig) return null;
    const inRange = new Set(holeNumbers);
    const isBestN =
      roundFormat === "2_ball" ||
      roundFormat === "3_ball" ||
      roundFormat === "best_ball";
    const input = buildRoundInput("net");
    const activeTeeId = roundPlayers[0]?.tee_id || 0;
    const holesForTee = holesByTee[activeTeeId] || [];
    let teamScoreSubtotal = 0;
    let teamParSubtotal = 0;
    let scored = 0;
    for (const { holeNumber, result } of input.perHole) {
      if (!inRange.has(holeNumber)) continue;
      if (result.teamScore == null) continue;
      teamScoreSubtotal += result.teamScore;
      if (isBestN) {
        const hole = holesForTee.find(h => h.hole_number === holeNumber);
        if (hole) teamParSubtotal += hole.par * result.contributingPlayerIds.length;
      }
      scored++;
    }
    if (scored === 0) return null;
    return teamScoreSubtotal - teamParSubtotal;
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

  // Phase D — End-Round reconciliation flow (D9 step 2 onward).
  //
  // Sequence per the design doc:
  //   1. Show "Finishing up…" spinner.
  //   2. Hail-mary drain (queue.drain({ ignoreBackoff: true })).
  //   3. Race against a 30s timeout, with a "Skip and finish" button
  //      surfacing at 15s.
  //   4. If everything drained → finalize normally.
  //   5. Otherwise → mark remaining items terminal, show reconciliation
  //      dialog with [Retry sync] / [Skip and finish].
  //   6. On Retry: retryTerminal + another hail-mary; if it works finalize,
  //      else escalate to second-attempt dialog.
  //
  // The DangerModal confirmation step ("Finalize this round?") stays as
  // the entry point — it's UX-protective against an accidental Finish-
  // Round tap and consistent with the rest of the app's dangerous-action
  // pattern. The "disable End Round button" requirement from D9 step 1
  // is satisfied implicitly by the modal overlay (button is unreachable
  // while any modal/spinner is up) and additionally by the existing
  // `disabled={saving}` guard.

  const queueItemsForThisRound = (states: QueueItem["state"][]) => {
    return getWriteQueue()
      .getItems()
      .filter(
        i =>
          states.includes(i.state) && i.payload.round_id === Number(roundId),
      );
  };

  const runHailMaryWithTimeout = async (
    timeoutMs: number,
    skipButtonDelayMs: number,
  ): Promise<void> => {
    setShowSkipDuringDrain(false);

    const skipButtonTimer = setTimeout(
      () => setShowSkipDuringDrain(true),
      skipButtonDelayMs,
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>(resolve => {
      timeoutHandle = setTimeout(resolve, timeoutMs);
    });

    let skipResolve!: () => void;
    const skipPromise = new Promise<void>(r => {
      skipResolve = r;
    });
    skipResolveRef.current = skipResolve;

    try {
      await Promise.race([
        getWriteQueue().drain({ ignoreBackoff: true }),
        timeoutPromise,
        skipPromise,
      ]);
    } finally {
      clearTimeout(skipButtonTimer);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      skipResolveRef.current = null;
      setShowSkipDuringDrain(false);
    }
  };

  const startEndRoundFlow = async () => {
    setEndRoundModal(false);
    setEndRoundPhase("draining");

    await runHailMaryWithTimeout(30_000, 15_000);

    const remaining = queueItemsForThisRound(["pending", "in_flight"]);
    if (remaining.length === 0) {
      await finalizeRound();
      return;
    }

    // D9: items still failing get marked terminal_failure so Phase E can
    // surface them on the next app open and so the dialog has stable
    // items to show.
    getWriteQueue().markAsTerminal(
      remaining.map(i => i.id),
      "end_round_timeout",
    );
    setStuckItems(queueItemsForThisRound(["terminal_failure"]));
    setEndRoundPhase("first-dialog");
  };

  const handleRetrySync = async () => {
    setRetryBusy(true);
    setEndRoundPhase("draining");

    const queue = getWriteQueue();
    const ids = stuckItems.map(i => i.id);
    await queue.retryTerminal(ids);
    await runHailMaryWithTimeout(30_000, 15_000);

    const stillStuck = queueItemsForThisRound(["pending", "in_flight"]);
    if (stillStuck.length === 0) {
      setRetryBusy(false);
      await finalizeRound();
      return;
    }
    // Still failing — re-mark and escalate to the second-attempt dialog.
    queue.markAsTerminal(
      stillStuck.map(i => i.id),
      "end_round_retry_timeout",
    );
    setStuckItems(queueItemsForThisRound(["terminal_failure"]));
    setRetryBusy(false);
    setEndRoundPhase("second-dialog");
  };

  const handleSkipAndFinalize = async () => {
    setEndRoundPhase(null);
    await finalizeRound();
  };

  const handleCopyDetails = async () => {
    const text = formatStuckItemsForClipboard(
      stuckItems.map(i => ({
        hole_label: i.display.hole_label,
        player_name: i.display.player_name,
        strokes: i.payload.strokes,
      })),
      roundId,
      roundPlayedOn,
    );
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / iOS Safari without clipboard
        // permission. Best-effort: render the text in a textarea, select,
        // execCommand("copy"). Some browsers no longer support this — if
        // it fails the user can still read the dialog list directly.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand?.("copy");
        document.body.removeChild(ta);
      }
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // If the copy genuinely failed we leave copyState as idle so the
      // user sees no false confirmation. They can still read the list.
    }
  };

  // D.1: replaces the pre-D.1 client-side completion check + manual
  // `UPDATE rounds SET is_complete = true`. The RPC owns completion (which
  // is now stricter: every non-dropped player needs every required hole),
  // randomization, and the atomic flip. Branches:
  //   'finalized' / 'already_complete' → redirect to summary
  //   'pool_too_small'                  → red banner, stay on scorecard
  //   'not_yet'                          → stay on scorecard (missing scores)
  const finalizeRound = async () => {
    setSaving(true);

    const { data, error } = await supabase.rpc(
      "finalize_round_with_blind_draws",
      { p_round_id: Number(roundId) },
    );

    setSaving(false);
    setEndRoundPhase(null);

    if (error) {
      console.warn("[D.1] manual finalize RPC error", error);
      return;
    }
    const status = (data ?? "") as string;
    if (status === "pool_too_small") {
      setPoolErrorVisible(true);
      setTimeout(() => setPoolErrorVisible(false), 6000);
      return;
    }
    if (status === "not_yet") {
      // Missing scores. Stay on the scorecard so the user can fill them.
      return;
    }
    // finalized | already_complete → both mean the round is done in the DB.
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
                  <span style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "block" }}>Course Handicap</span>
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
                      placeholder="Enter Handicap Index"
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
                  // Pre-select the player's preferred tee (or the app default)
                  // when no tee has been committed yet, so the picker opens
                  // pre-filled rather than empty. Tapping START ROUND commits
                  // the pre-selection if the player never taps a tee button.
                  const effectiveTeeId = rp.tee_id ?? rp.preferred_tee_id ?? DEFAULT_TEE_ID;
                  const isSelected = effectiveTeeId === t.id;
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

        <button onClick={async () => {
          // Bulk-commit the pre-selected default for any player who never
          // tapped a tee button. Sequential so each updatePlayerTee can see
          // local state from the prior one (handicap recompute + holes
          // fetch). Tapping a tee earlier already wrote to DB, so those
          // rows are skipped here.
          for (const p of roundPlayers) {
            if (p.tee_id === null || p.tee_id === 0) {
              const fallbackTee = p.preferred_tee_id ?? DEFAULT_TEE_ID;
              await updatePlayerTee(p.id, fallbackTee);
            }
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
  const isBestNFormat = roundFormat === "2_ball" || roundFormat === "3_ball" || roundFormat === "best_ball";
  const isOverrideHole = getOverrideHoles(roundFormatConfig).includes(currentHole);
  const playerToRemove = removePlayerModal !== null ? roundPlayers.find(p => p.id === removePlayerModal) : null;

  return (
    <div style={{ padding: "15px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        {teamFilter && (
          <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: "#0c3057" }}>TEAM {teamFilter}</p>
        )}
        {roundFormat && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
            <FormatChip
              roundId={Number(roundId)}
              currentFormat={roundFormat}
              currentConfig={roundFormatConfig}
              formatLocked={roundFormatLockedAt !== null}
            />
          </div>
        )}
        <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: "0.75rem", fontWeight: "bold" }}>
          PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS
        </p>
      </div>

      {/* D.1 S2 — pre-fire warning banner. Only on team-filtered scorecards
          (?team=N) where every OTHER team is complete and this team has at
          least one player scored on hole 17 or 18. Disappears the moment
          the round actually finalizes or another team becomes incomplete. */}
      {!isRoundComplete && !!teamFilter && otherTeamsComplete && (
        roundPlayers.some(rp => {
          const rpScores = scores[rp.id] ?? {};
          return rpScores[17] != null || rpScores[18] != null;
        })
      ) && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: "#fef9c3",
            border: "1px solid #fde68a",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: "0.82rem",
            color: "#713f12",
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          Last team finishing up. Round will finalize when hole 18 is scored —
          check earlier holes for typos first.
        </div>
      )}

      {/* B3.3: All-scores-count banner — only fires for best-N formats since
          Stableford ignores override_holes (every player already contributes). */}
      {isOverrideHole && isBestNFormat && (
        <div style={{
          background: "#fef9e7",
          border: "1px solid #f7e3a3",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: "12px",
          fontSize: "0.78rem",
          color: "#7a5a14",
          fontWeight: 600,
          textAlign: "center",
        }}>
          All scores count on this hole
        </div>
      )}

      {/* Team score summary bar */}
      {scoredHoles > 0 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <div style={{ flex: 1, background: "#1e40af", borderRadius: "12px", padding: "10px 14px", color: "white", textAlign: "center" }}>
            <div style={{ fontSize: "0.6rem", fontWeight: 800, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>Team Net</div>
            <div style={{ fontSize: "2rem", fontWeight: 900 }}>
              {/* C3: helper handles both stroke delta and Stableford "X pts".
                  For Stableford, teamPar (teamParAtScored) is 0 by engine
                  contract, so teamNet - teamPar collapses to teamNet (the
                  absolute points total) — the helper's Stableford branch
                  expects an absolute value, and this naturally provides it. */}
              {roundFormat ? formatTeamTotal(teamNet - teamPar, roundFormat) : ""}
            </div>
            {/* F9 / B9 cumulative net beneath the headline delta. Tot was
                redundant with the big headline number (Nassau settles each
                leg separately; total = headline by construction). */}
            {roundFormat && (() => {
              const fmt = (v: number | null) =>
                v == null ? "—" : formatTeamTotal(v, roundFormat);
              const f9 = getTeamNetDeltaForHoles(F9_HOLES);
              const b9 = getTeamNetDeltaForHoles(B9_HOLES);
              const labelStyle = { opacity: 0.65 };
              const valueStyle = { fontWeight: 500 };
              const sepStyle = { opacity: 0.65, margin: "0 6px" };
              return (
                <div style={{ fontSize: "13px", marginTop: "4px", lineHeight: 1.2 }}>
                  <span style={labelStyle}>F9 </span>
                  <span style={valueStyle}>{fmt(f9)}</span>
                  <span style={sepStyle}>·</span>
                  <span style={labelStyle}>B9 </span>
                  <span style={valueStyle}>{fmt(b9)}</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Hole navigation dots */}
      {/* touchAction: pan-x on the rail and manipulation on each dot mitigate
          iOS Safari's scroll-into-tap behavior — a horizontal flick to scroll
          the rail was firing setCurrentHole on whichever dot the touch landed
          on (Bug 2 contributor). 44px targets hit the WCAG 2.1 AA minimum and
          reduce adjacent-dot mis-taps. */}
      <div style={{ display: "flex", overflowX: "auto", gap: "6px", marginBottom: "20px", paddingBottom: "10px", touchAction: "pan-x" }}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hasScores = roundPlayers.some(rp => scores[rp.id]?.[h] != null);
          const hasOverride = !!countingOverrides[h];
          return (
            <button key={h} onClick={() => setCurrentHole(h)} style={{
              minWidth: "44px", height: "44px", borderRadius: "50%",
              border: h === currentHole ? "2px solid #0c3057" : hasOverride ? "2px solid #f59e0b" : "1px solid #e2e8f0",
              background: h === currentHole ? "#0c3057" : hasScores ? "#dbeafe" : "white",
              color: h === currentHole ? "white" : hasScores ? "#1e40af" : "#94a3b8",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer", touchAction: "manipulation",
            }}>
              {h}
            </button>
          );
        })}
      </div>

      {/* Tie notices */}
      {isBestNFormat && (tiedForBall1 || tiedForBall2) && (
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

        // D.1: post-dropout score entry is silently no-op'd. +/− buttons go
        // visually disabled; entered scores on holes 1..dropped stay visible
        // on the rest of the scorecard surfaces.
        const droppedHole = rp.dropped_after_hole;
        const isPostDropHole = droppedHole != null && currentHole > droppedHole;

        // D.1 S6 — read-only post-finalize. After is_complete:
        //   1. +/− buttons disappear (no more edits, period).
        //   2. For a dropped player on a hole within a paired fill, render
        //      the drawn player's score with a 🎲 (blind draw) caption.
        //   3. The expanded PlayerHoleGrid uses the merged 18-hole array.
        const fillForRp = fillsByRpId[rp.id];
        const isFillHole = fillForRp != null
          && currentHole >= fillForRp.holeRangeStart
          && currentHole <= fillForRp.holeRangeEnd;
        const fillScoreForHole = isFillHole
          ? fillForRp.drawnScores[currentHole - 1]
          : null;

        // A1.7 — per-player hole-by-hole grid data + expand state.
        const isExpanded = expandedPlayers.has(rp.id);
        const playerHoles = holesByTee[rp.tee_id || 0] || [];
        const par18 = Array.from({ length: 18 }, (_, i) =>
          playerHoles.find(ph => ph.hole_number === i + 1)?.par ?? 4
        );
        const ownScores18: (number | null)[] = Array.from({ length: 18 }, (_, i) =>
          scores[rp.id]?.[i + 1] ?? null
        );
        // D.1 S6: merge dropout fill into the 18-hole grid when present.
        const scores18: (number | null)[] = fillForRp
          ? ownScores18.map((s, i) =>
              i + 1 >= fillForRp.holeRangeStart && i + 1 <= fillForRp.holeRangeEnd
                ? fillForRp.drawnScores[i]
                : s,
            )
          : ownScores18;

        const cardBorderRadius = isExpanded ? "16px 16px 0 0" : "16px";
        const cardMarginBottom = isExpanded ? "0" : "10px";

        const expandStop = (e: React.MouseEvent) => {
          e.stopPropagation();
          toggleExpandedPlayer(rp.id);
        };

        return (
          <React.Fragment key={rp.id}>
            <div
              onClick={() => gross != null ? toggleOverride(currentHole, rp.id) : undefined}
              style={{
                background: isCounting ? countingBg : "white",
                padding: "12px 16px",
                borderRadius: cardBorderRadius,
                border: isCounting ? `2px solid ${countingBorderColor}` : "1px solid #f1f5f9",
                borderBottom: isExpanded
                  ? "1px solid #f1f5f9"
                  : isCounting ? `2px solid ${countingBorderColor}` : "1px solid #f1f5f9",
                marginBottom: cardMarginBottom,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: gross != null ? "pointer" : "default",
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <div
                style={{ flex: 1, cursor: "pointer" }}
                onClick={expandStop}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  <span style={{
                    fontWeight: 800, fontSize: "0.95rem",
                    color: droppedHole != null ? "#6b7280" : undefined,
                  }}>
                    {rp.display_name}
                  </span>
                  {droppedHole != null && (
                    <span style={{
                      fontSize: "0.7rem", fontWeight: 500, color: "#6b7280",
                      fontStyle: "italic",
                    }}>
                      (left after hole {droppedHole})
                    </span>
                  )}
                  {isBestNFormat && isCounting && !isTied && (
                    <span style={{
                      fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px", borderRadius: "999px",
                      background: countingBorderColor, color: "white", textTransform: "uppercase",
                    }}>
                      {countingRank === 0 ? "Ball 1" : "Ball 2"}
                    </span>
                  )}
                  {isBestNFormat && isTied && (
                    <span style={{
                      fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px", borderRadius: "999px",
                      background: "#f59e0b", color: "white", textTransform: "uppercase",
                    }}>
                      Tied
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "2px" }}>
                  <span>Course Handicap: {rp.course_handicap ?? "?"}</span>
                  <span>·</span>
                  <span>Handicap Index: {rp.handicap_index != null ? rp.handicap_index.toFixed(1) : "?"}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }} onClick={e => e.stopPropagation()}>
                {!isRoundComplete && (
                  <button
                    onClick={() => {
                      if (isPostDropHole) return;
                      const par = holeInfo?.par ?? 4;
                      const current = scores[rp.id]?.[currentHole];
                      setScore(rp.id, currentHole, current == null ? par : current - 1);
                    }}
                    disabled={isPostDropHole}
                    style={{
                      width: "44px", height: "44px", borderRadius: "10px",
                      border: "1px solid #e2e8f0",
                      background: isPostDropHole ? "#f1f5f9" : "#f8fafc",
                      color: isPostDropHole ? "#cbd5e1" : undefined,
                      fontSize: "20px",
                      cursor: isPostDropHole ? "not-allowed" : "pointer",
                    }}
                  >
                    −
                  </button>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "35px" }}>
                  <div style={{ height: "8px", display: "flex", gap: "3px", alignItems: "center", marginBottom: "2px" }}>
                    {Array.from({ length: hcpStrokes }).map((_, i) => (
                      <span key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#1e40af" }} />
                    ))}
                  </div>
                  <div style={{
                    fontSize: "1.8rem", fontWeight: 900, textAlign: "center",
                    color: isPostDropHole && fillScoreForHole == null ? "#cbd5e1" : undefined,
                  }}>
                    {fillScoreForHole != null
                      ? fillScoreForHole
                      : (scores[rp.id]?.[currentHole] || "—")}
                  </div>
                  {fillScoreForHole != null && (
                    <div style={{
                      fontSize: "0.6rem", color: "#6b7280",
                      fontStyle: "italic", marginTop: 2, whiteSpace: "nowrap",
                    }}>
                      🎲 (blind draw)
                    </div>
                  )}
                </div>
                {!isRoundComplete && (
                  <button
                    onClick={() => {
                      if (isPostDropHole) return;
                      const par = holeInfo?.par ?? 4;
                      const current = scores[rp.id]?.[currentHole];
                      setScore(rp.id, currentHole, current == null ? par : current + 1);
                    }}
                    disabled={isPostDropHole}
                    style={{
                      width: "44px", height: "44px", borderRadius: "10px",
                      border: "1px solid #e2e8f0",
                      background: isPostDropHole ? "#f1f5f9" : "#f8fafc",
                      color: isPostDropHole ? "#cbd5e1" : undefined,
                      fontSize: "20px",
                      cursor: isPostDropHole ? "not-allowed" : "pointer",
                    }}
                  >
                    +
                  </button>
                )}
                <PlayerOverflowMenu
                  roundPlayerId={rp.id}
                  playerName={rp.display_name}
                  droppedAfterHole={rp.dropped_after_hole}
                  isRoundComplete={isRoundComplete}
                  surface="scorecard"
                  onChanged={refreshDropoutStates}
                  onRemove={() => setRemovePlayerModal(rp.id)}
                />
                <button
                  aria-label={isExpanded ? "Collapse hole-by-hole" : "Expand hole-by-hole"}
                  aria-expanded={isExpanded}
                  onClick={expandStop}
                  style={{
                    width: "32px", height: "44px", borderRadius: "8px",
                    border: "none", background: "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "#64748b", padding: 0,
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.15s ease",
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>
            {isExpanded && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: "white",
                  border: isCounting ? `2px solid ${countingBorderColor}` : "1px solid #f1f5f9",
                  borderTop: "none",
                  borderRadius: "0 0 16px 16px",
                  padding: "4px 14px 10px",
                  marginBottom: "10px",
                }}
              >
                {fillForRp && (
                  <div style={{
                    fontSize: "0.72rem", color: "#6b7280",
                    fontStyle: "italic", marginBottom: 6,
                  }}>
                    🎲 Holes {fillForRp.holeRangeStart}–{fillForRp.holeRangeEnd}:
                    {" "}blind draw from {fillForRp.drawnPlayerName}
                  </div>
                )}
                <PlayerHoleGrid
                  scores={scores18}
                  par={par18}
                  currentHoleIndex={currentHole - 1}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Tap hint when scores are entered */}
      {isBestNFormat && countingIds.length >= 2 && !tiedForBall1 && !tiedForBall2 && (
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
          onConfirm={startEndRoundFlow}
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

      {/* Phase D — hail-mary spinner + reconciliation dialogs. */}
      {endRoundPhase === "draining" && (
        <FinishingSpinner
          showSkipButton={showSkipDuringDrain}
          onSkip={() => skipResolveRef.current?.()}
        />
      )}
      {endRoundPhase === "first-dialog" && (
        <ReconciliationDialog
          variant="first-attempt"
          items={stuckItemsToDialogItems(stuckItems)}
          onRetry={handleRetrySync}
          onSkip={handleSkipAndFinalize}
          busy={retryBusy}
        />
      )}
      {endRoundPhase === "second-dialog" && (
        <ReconciliationDialog
          variant="second-attempt"
          items={stuckItemsToDialogItems(stuckItems)}
          onRetry={handleRetrySync}
          onSkip={handleSkipAndFinalize}
          onCopyDetails={handleCopyDetails}
          copyState={copyState}
          busy={retryBusy}
        />
      )}

      {/* D.1 S5 — post-fire confirmation toast. Shown only to the user who
          entered the last score. Auto-dismisses after ~4s. */}
      {finalizedToastVisible && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#0e4270",
            color: "white",
            padding: "12px 22px",
            borderRadius: 999,
            fontWeight: 600,
            fontSize: "0.92rem",
            boxShadow: "0 10px 28px rgba(0,0,0,0.25)",
            zIndex: 1100,
            fontFamily: "DM Sans, system-ui, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          ✅ Round finalized. Blind draw complete.
        </div>
      )}

      {/* D.1 S4 defensive abort — surfaces when finalize_round_with_blind_draws
          returns 'pool_too_small'. Auto-dismisses after 6s; longer than the
          success toast because the user needs time to read the escalation. */}
      {poolErrorVisible && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#7f1d1d",
            color: "white",
            padding: "12px 22px",
            borderRadius: 12,
            fontWeight: 600,
            fontSize: "0.88rem",
            boxShadow: "0 10px 28px rgba(0,0,0,0.25)",
            zIndex: 1100,
            fontFamily: "DM Sans, system-ui, sans-serif",
            maxWidth: 340,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          Not enough complete rounds to fill blind draws. Contact Jonathan.
        </div>
      )}
    </div>
  );
}

function stuckItemsToDialogItems(items: QueueItem[]): StuckScoreItem[] {
  return items.map(i => ({
    player_name: i.display.player_name,
    hole_label: i.display.hole_label,
    strokes: i.payload.strokes,
  }));
}
