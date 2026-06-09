"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useParams } from "next/navigation";
import DangerModal from "@/app/admin/components/DangerModal";
import { useIsAdmin, useIsRoundEditMode } from "@/lib/admin";
import {
  computeCourseHandicap,
  computeHoleResult,
  computeRoundResult,
  getHandicapStrokes,
  computeAdjustedHoleScores,
} from "@/lib/scoring";
import type { HoleInfo as EngineHoleInfo, Format, FormatConfig, BlindDrawInput } from "@/lib/scoring";
import ScorecardLockNotice from "@/components/format/ScorecardLockNotice";
import FormatChip from "@/components/format/FormatChip";
import { getScoringBasis, getOverrideHoles, getHandicapAllowance, getPlayingCourseHandicap, allowsIncompleteClose } from "@/lib/format/helpers";
import { formatTeamTotal } from "@/lib/format/copy";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { getWriteQueue } from "@/lib/writeQueue";
import { computeAndPersistRoundPayouts } from "@/lib/payouts/persistRoundPayouts";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";
import PlayerOverflowMenu from "@/components/round/PlayerOverflowMenu";
import type { Player } from "@/app/admin/page";
import ManageTeamSheet from "@/components/teamFormation/ManageTeamSheet";
import { getDisplayName, type PlayerLike } from "@/lib/players/displayName";

// --- TYPES ---
interface RoundPlayer {
  id: number;
  player_id: number;
  tee_id: number | null;
  // Raw full name (kept for re-disambiguation in child sheets). `display_name`
  // below holds the render-ready disambiguated short name ("Wayne H").
  full_name: string;
  display_name: string;
  handicap_index: number | null;
  handicap_index_snapshot: number | null;
  course_handicap: number | null;
  preferred_tee_id: number | null;
  dropped_after_hole: number | null;
  // D.1 hotfix follow-up: needed for the client-side post-submit score-
  // write guard. The whole-round view (no ?team=N) mixes players from
  // multiple teams, so the per-row check has to be per-player.
  team_number: number;
  // Phase D.2: row provenance + per-row HI verification timestamp.
  // created_at vs rounds.played_on drives the historical-add chip
  // ("Verify HI for [date]"); hi_verified_at dismisses it on save.
  created_at: string | null;
  hi_verified_at: string | null;
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

// Phase D.2: chip-render predicate. A round_player row whose created_at is
// more than one day after the round's played_on was added long after the
// round itself — either by admin reopen-and-add or by the H.5 historical
// import. In both cases the snapshot HI may not reflect the player's true
// HI at round time, so the admin needs to verify it. Treats played_on as
// noon UTC to dodge TZ off-by-one for the +1 day boundary.
// Render-ready disambiguating short name ("Wayne H" / "Wayne V") against the
// full active roster, so a player's name matches every other surface. Derived
// from full_name only (display_name is intentionally ignored).
function disambiguatedName(
  playerId: number,
  fullName: string | null | undefined,
  roster: PlayerLike[],
): string {
  const fn = fullName ?? "";
  if (!fn) return "?";
  return getDisplayName({ id: playerId, full_name: fn }, roster);
}

// D.1 (display): one blind-draw fill, in render-ready shape for the read-only
// scorecard's 🎲 pseudo-row. `scores` is 18-length with out-of-range holes set
// to null (rendered blank, not zero / not the dropped player's score).
type BlindDrawFillRowData = {
  playerId: number;
  fullName: string;
  scores: (number | null)[];
  par: number[];
  holeRangeStart: number;
  holeRangeEnd: number;
};

// D.1 (display): a 🎲 pseudo-row on the read-only scorecard, mirroring a roster
// player card (current-hole big number + expandable PlayerHoleGrid) with muted
// styling and a "Blind draw:" label so the viewer sees why the team total moved.
// Renders only post-finalize (the source array is empty otherwise).
function BlindDrawFillRow({
  name,
  scores,
  par,
  holeRangeStart,
  holeRangeEnd,
  currentHole,
}: {
  name: string;
  scores: (number | null)[];
  par: number[];
  holeRangeStart: number;
  holeRangeEnd: number;
  currentHole: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFull = holeRangeStart === 1 && holeRangeEnd === 18;
  const inRange = currentHole >= holeRangeStart && currentHole <= holeRangeEnd;
  const bigScore = inRange ? scores[currentHole - 1] : null;
  const cardRadius = expanded ? "16px 16px 0 0" : "16px";

  return (
    <React.Fragment>
      <div
        data-testid="blind-draw-fill-row"
        style={{
          background: "#f8fafc",
          padding: "12px 16px",
          borderRadius: cardRadius,
          border: "1px dashed #cbd5e1",
          borderBottom: expanded ? "1px solid #f1f5f9" : "1px dashed #cbd5e1",
          marginBottom: expanded ? "0" : "10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(v => !v)}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1rem" }}>🎲</span>
            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#475569" }}>
              Blind draw: {name}
            </span>
            {!isFull && (
              <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#6b7280", fontStyle: "italic" }}>
                (holes {holeRangeStart}–{holeRangeEnd})
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", marginTop: "2px" }}>
            Added to this team&apos;s total
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "35px" }}>
            <div style={{
              fontSize: "1.8rem", fontWeight: 900, textAlign: "center",
              color: bigScore == null ? "#cbd5e1" : "#475569",
            }}>
              {bigScore ?? "—"}
            </div>
          </div>
          <button
            aria-label={expanded ? "Collapse hole-by-hole" : "Expand hole-by-hole"}
            aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}
            style={{
              width: "32px", height: "44px", borderRadius: "8px",
              border: "none", background: "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#64748b", padding: 0,
            }}
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{
          background: "white",
          border: "1px dashed #cbd5e1",
          borderTop: "none",
          borderRadius: "0 0 16px 16px",
          padding: "4px 14px 10px",
          marginBottom: "10px",
        }}>
          <PlayerHoleGrid
            scores={scores}
            par={par}
            currentHoleIndex={currentHole - 1}
            showRunningTotal={false}
          />
        </div>
      )}
    </React.Fragment>
  );
}

function isHistoricalAdd(createdAt: string | null, playedOn: string | null): boolean {
  if (!createdAt || !playedOn) return false;
  const createdMs = new Date(createdAt).getTime();
  const playedMs = new Date(playedOn + "T12:00:00Z").getTime();
  if (Number.isNaN(createdMs) || Number.isNaN(playedMs)) return false;
  return createdMs - playedMs > 86_400_000;
}

// G2: persist payouts after finalize. Swallows errors (logs only) so a payout
// persistence failure never blocks the finalize UX — the round is finalized and
// re-running heals it (the RPC is idempotent).
async function persistPayoutsAfterFinalize(roundId: number): Promise<void> {
  try {
    await computeAndPersistRoundPayouts(roundId);
  } catch (e) {
    console.warn("[G2] payout persistence failed (round finalized; recoverable)", e);
  }
}

export default function ScorecardPage() {
  const params = useParams();
  const roundId = params.id as string;
  const isAdmin = useIsAdmin();
  const isRoundEditMode = useIsRoundEditMode();

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  // Full active roster — the disambiguation universe for player short names.
  // Loaded once on mount so the per-player rows match every other surface.
  const [allActivePlayers, setAllActivePlayers] = useState<Player[]>([]);
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
  const [removePlayerModal, setRemovePlayerModal] = useState<number | null>(null);
  const [roundPlayedOn, setRoundPlayedOn] = useState<string | null>(null);

  // D.1 hotfix (2026-05-18) — per-team submission gate replaces the original
  // auto-fire-on-last-score trigger. Each team taps "Submit Final Scores"
  // when their card is done; the blind-draw RPC fires only once every team
  // in the round appears in `submittedTeams`. Old auto-fire raced A6's
  // first-tap-commits-par on hole 18 and locked rounds before players
  // could adjust.
  const [submittedTeams, setSubmittedTeams] = useState<number[]>([]);
  const [allTeamNumbers, setAllTeamNumbers] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitModal, setSubmitModal] = useState(false);
  // S5 post-fire toast (still useful: when MY submit is the one that
  // completes the set, I see the confirmation).
  const [finalizedToastVisible, setFinalizedToastVisible] = useState(false);
  // S4 defensive abort — surfaced when finalize_round_with_blind_draws
  // returns 'pool_too_small' on the all-teams-now-submitted attempt.
  const [poolErrorVisible, setPoolErrorVisible] = useState(false);
  // Gates re-entry into the "all teams submitted → call RPC" effect.
  // Reset by submittedTeams membership changes; not user-visible.
  const [allSubmittedRpcInFlight, setAllSubmittedRpcInFlight] = useState(false);

  // D.1 S6 read-only scorecard. After finalize, dropout fills pair with the
  // dropped player by holeRangeStart = droppedAfterHole + 1. Keyed by
  // round_players.id so the per-hole big number + expanded PlayerHoleGrid
  // can render the drawn player's scores in the post-drop range, with
  // a 🎲 (blind draw) caption.
  const [fillsByRpId, setFillsByRpId] = useState<
    Record<number, { drawnPlayerName: string; drawnScores: (number | null)[]; holeRangeStart: number; holeRangeEnd: number }>
  >({});

  // Blind-draw fills for the displayed team, in the engine's BlindDrawInput
  // shape, so the headline team total / F9-B9-Total pill match the
  // leaderboard + summary (which run the same engine via loadRoundResults).
  // Empty pre-finalize (blind_draws has no rows yet) → no behavior change.
  // Loaded by refreshBlindDrawInputs(); consumed by buildRoundInput().
  const [blindDrawInputs, setBlindDrawInputs] = useState<BlindDrawInput[]>([]);

  // D.1 (display): render-ready blind-draw fill rows for the read-only
  // scorecard's 🎲 pseudo-rows. Built alongside blindDrawInputs in
  // refreshBlindDrawInputs (same fetch), so it's empty pre-finalize. The name
  // is disambiguated at render time via getDisplayName + allActivePlayers.
  const [blindDrawFillRows, setBlindDrawFillRows] = useState<BlindDrawFillRowData[]>([]);

  // Inline handicap entry for players without one
  const [tempHandicaps, setTempHandicaps] = useState<Record<number, string>>({});

  // Phase D.2: Edit HI modal — open when admin (in edit mode) taps "Edit HI"
  // on a player's metadata row. Holds the round_player being edited; null
  // means the modal is closed.
  const [editHiRpId, setEditHiRpId] = useState<number | null>(null);
  const [editHiValue, setEditHiValue] = useState<string>("");
  const [editHiSaving, setEditHiSaving] = useState(false);

  // Manage Team sheet
  const [manageTeamOpen, setManageTeamOpen] = useState(false);
  const [manageTeamActivePlayers, setManageTeamActivePlayers] = useState<Player[]>([]);
  const [manageTeamUnassigned, setManageTeamUnassigned] = useState<Player[]>([]);
  const [manageTeamUndoToast, setManageTeamUndoToast] = useState<{
    message: string;
    onUndo: (() => void) | null;
  } | null>(null);
  const manageTeamUndoRef = useRef<RoundPlayer | null>(null);
  const manageTeamToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-player write queue — CLAUDE.md locked pattern (same shape as src/app/page.tsx)
  const writeQueueRef = useRef<Map<number, Promise<void>>>(new Map());
  const enqueuePlayerWrite = useCallback((playerId: number, fn: () => Promise<void>) => {
    const prev = writeQueueRef.current.get(playerId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => console.error("[ManageTeam]", err));
    writeQueueRef.current.set(playerId, next);
  }, []);
  const drainWrites = useCallback(async () => {
    await Promise.all([...writeQueueRef.current.values()]);
  }, []);

  // D.1 hotfix: trigger the finalize RPC any time submittedTeams (or the
  // roster) changes such that every team has submitted. Multiple firing
  // entry points (my submit, refresh-from-another-tab) collapse into this
  // single effect.
  useEffect(() => {
    void tryFinalizeIfAllSubmitted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedTeams, allTeamNumbers, isRoundComplete]);

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
        const cfg = (roundRow.format_config ?? null) as FormatConfig | null;
        setRoundFormat((roundRow.format ?? null) as Format | null);
        setRoundFormatConfig(cfg);
        setRoundFormatLockedAt((roundRow.format_locked_at ?? null) as string | null);
        setIsRoundComplete(roundIsComplete);
        setRoundPlayedOn((roundRow.played_on ?? null) as string | null);
        // D.1 hotfix: read the team-submission gate. Undefined on rounds
        // created before the hotfix → treated as [] (no one submitted yet).
        setSubmittedTeams(Array.isArray(cfg?.submitted_teams) ? cfg!.submitted_teams! : []);
      }

      // D.1 hotfix: load every team_number in the round so we can compute
      // "this team is the last one not in submitted_teams" for the banner
      // and "all teams now submitted → fire RPC" for the trigger.
      const { data: allRps } = await supabase
        .from("round_players")
        .select("team_number")
        .eq("round_id", roundId)
        .gt("team_number", 0);
      const teamSet = new Set<number>();
      (allRps ?? []).forEach((r: any) => teamSet.add(r.team_number as number));
      setAllTeamNumbers(Array.from(teamSet).sort((a, b) => a - b));

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

      // Full active roster for player-name disambiguation. Fetched here so the
      // per-player rows can render consistent short names on first paint.
      const { data: activePlayerRows } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index, is_active, preferred_tee_id")
        .eq("is_active", true)
        .order("full_name");
      const activeRoster = (activePlayerRows ?? []) as Player[];
      setAllActivePlayers(activeRoster);

      const team = new URLSearchParams(window.location.search).get("team");
      let query = supabase
        .from("round_players")
        .select(`id, player_id, tee_id, team_number, course_handicap, dropped_after_hole, handicap_index_snapshot, created_at, hi_verified_at, players ( full_name, display_name, handicap_index, preferred_tee_id )`)
        .eq("round_id", roundId);

      if (team) query = query.eq("team_number", parseInt(team));
      const { data: rp } = await query.order("id");

      if (rp && rp.length > 0) {
        let playersData: RoundPlayer[] = rp.map((r: any) => ({
          id: r.id,
          player_id: r.player_id,
          tee_id: r.tee_id,
          full_name: r.players?.full_name ?? "",
          display_name: disambiguatedName(r.player_id, r.players?.full_name, activeRoster),
          handicap_index: r.players?.handicap_index != null ? Number(r.players.handicap_index) : null,
          handicap_index_snapshot: r.handicap_index_snapshot != null ? Number(r.handicap_index_snapshot) : null,
          course_handicap: r.course_handicap != null ? Number(r.course_handicap) : null,
          preferred_tee_id: r.players?.preferred_tee_id ?? null,
          dropped_after_hole: r.dropped_after_hole ?? null,
          team_number: r.team_number ?? 0,
          created_at: r.created_at ?? null,
          hi_verified_at: r.hi_verified_at ?? null,
        }));

        // LT1 fix (2026-05-09): recompute Course Handicap on every load from
        // round_players.handicap_index_snapshot + selected tee. The snapshot
        // stores the HI in effect at round-creation time and is updated by
        // the H2.5.5 cascade if admin edits HI while a round is still active.
        // Gated on !roundIsComplete (H2.5.4): finalized rounds are frozen.
        // Self-healing per page load. Single source of truth in this file:
        // row CH display, dots, and engine all read rp.course_handicap from
        // state, so updating playersData here corrects all three sites.
        // DB writeback is fire-and-forget so downstream consumers (summary,
        // leaderboard, season) read the corrected value on their next load.
        if (!roundIsComplete) {
          playersData = playersData.map(p => {
            if (p.handicap_index_snapshot == null || p.tee_id == null) return p;
            const tee = formattedTees.find(t => t.id === p.tee_id);
            if (!tee) return p;
            const expected = computeCourseHandicap(
              p.handicap_index_snapshot, tee.slope_rating, tee.course_rating, tee.par,
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
      // D.1 S6 — load dropout fills for the read-only post-finalize view.
      // Safe to run pre-finalize too: returns no rows.
      void refreshBlindDrawFills();
      // Load best-N fills for the headline team total (matches leaderboard/
      // summary). Also a no-op pre-finalize.
      void refreshBlindDrawInputs();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const updatePlayerTee = async (rpId: number, teeId: number) => {
    const player = roundPlayers.find(p => p.id === rpId);
    const tee = allTees.find(t => t.id === teeId);
    if (!player || !tee) return;

    const hcIndex = player.handicap_index_snapshot ?? (tempHandicaps[rpId] !== undefined ? parseFloat(tempHandicaps[rpId]) : null);
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
      current.map(p => p.id === rpId ? { ...p, handicap_index: hcIndex, handicap_index_snapshot: hcIndex, course_handicap: newCH } : p)
    );
    // Write snapshot + CH in one round_players update.
    await supabase.from("round_players").update({
      handicap_index_snapshot: hcIndex,
      ...(newCH !== null ? { course_handicap: newCH } : {}),
    }).eq("id", rpId);
    // Persist HC index to player record (best-effort)
    const { data: playerRef } = await supabase
      .from("round_players").select("player_id").eq("id", rpId).single();
    if (playerRef) {
      await supabase.from("players").update({ handicap_index: hcIndex }).eq("id", playerRef.player_id);
    }
  };

  // Phase D.2: open the Edit HI modal for a specific round_player. Used by
  // the "Edit HI" link on the per-player metadata row and by the HI
  // verification chip.
  const openEditHiModal = (rp: RoundPlayer) => {
    setEditHiRpId(rp.id);
    setEditHiValue(rp.handicap_index_snapshot != null ? String(rp.handicap_index_snapshot) : "");
  };

  // Phase D.2: save the modal. Writes ONLY this round_player's
  // handicap_index_snapshot + course_handicap + hi_verified_at. Does NOT
  // touch players.handicap_index or any other round. Recomputes CH
  // explicitly because the LT1 self-heal at line 263 only fires on round
  // mount, not on snapshot changes (preflight finding 2026-05-27).
  const saveEditHi = async () => {
    if (editHiRpId == null) return;
    const trimmed = editHiValue.trim();
    if (trimmed === "") return;
    const hcIndex = parseFloat(trimmed);
    if (isNaN(hcIndex) || hcIndex < 0 || hcIndex > 54) return;
    const rp = roundPlayers.find(p => p.id === editHiRpId);
    if (!rp) return;

    setEditHiSaving(true);
    try {
      let newCH: number | null = rp.course_handicap ?? null;
      if (rp.tee_id != null) {
        const tee = allTees.find(t => t.id === rp.tee_id);
        if (tee) {
          newCH = computeCourseHandicap(hcIndex, tee.slope_rating, tee.course_rating, tee.par);
        }
      }
      const nowIso = new Date().toISOString();

      setRoundPlayers(current =>
        current.map(p => p.id === editHiRpId
          ? { ...p, handicap_index_snapshot: hcIndex, course_handicap: newCH, hi_verified_at: nowIso }
          : p,
        ),
      );

      const update: Record<string, unknown> = {
        handicap_index_snapshot: hcIndex,
        hi_verified_at: nowIso,
      };
      if (newCH !== null) update.course_handicap = newCH;
      const { error } = await supabase.from("round_players").update(update).eq("id", editHiRpId);
      if (error) {
        alert("Error saving HI: " + error.message);
        return;
      }
      setEditHiRpId(null);
      setEditHiValue("");
    } finally {
      setEditHiSaving(false);
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
    const player = roundPlayers.find(p => p.id === rpId);
    setScores(prev => ({ ...prev, [rpId]: { ...prev[rpId], [hole]: strokes } }));

    // Phase C: enqueue the write rather than awaiting Supabase directly.
    // Optimistic state is already set above; the queue handles persistence,
    // retry, backoff, and tab-eviction durability. Phase A's upsert path
    // is now the queue's writer (src/lib/writeQueue/instance.ts), so the
    // DB conflict resolution stays the same. End-Round reconciliation
    // (Phase D) and the stale-failure prompt (Phase E) will surface any
    // items that fail to drain — for now, the queue retries silently in
    // the background.
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

    // D.1 hotfix: refresh submission state so the pre-fire banner picks up
    // another group submitting on another device. Cheap single-row read;
    // async, doesn't block the score entry.
    void refreshSubmittedTeams();
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
    // Submission gate on another team could also have advanced (admin
    // working on the admin tab from a different device). Re-sync.
    void refreshSubmittedTeams();
  };

  // D.1: local mirror of the RPC's server-side completion check. Every non-
  // dropped player must have 18 holes scored; every dropped player must have
  // scores through their dropped_after_hole. Predicate flipping true triggers
  // the auto-finalize effect.
  //
  // Wave 1B follow-up: relaxed-close formats (Shambles) mirror
  // finalize_round_relaxed instead — the team needs >=1 present score on every
  // hole 1..18; individual players may have gaps (they picked up). When a team
  // is filtered, `roundPlayers` holds only that team's roster (see load query),
  // so this is exactly the per-team floor the RPC enforces.
  const isRoundLocallyComplete = (): boolean => {
    if (roundPlayers.length === 0) return false;
    if (allowsIncompleteClose(roundFormat)) {
      return firstUnscoredTeamHole() == null;
    }
    return roundPlayers.every(rp => {
      const required = rp.dropped_after_hole ?? 18;
      const rpScores = scores[rp.id] ?? {};
      for (let h = 1; h <= required; h++) {
        if (rpScores[h] == null) return false;
      }
      return true;
    });
  };

  // Wave 1B follow-up: first hole (1..18) on the filtered team with NO score
  // from any roster player, or null if every hole has at least one. Drives the
  // relaxed-close gate above and the "Team N has no score on hole H" block
  // caption. Only meaningful for relaxed-close formats (Shambles).
  const firstUnscoredTeamHole = (): number | null => {
    for (let h = 1; h <= 18; h++) {
      const anyScored = roundPlayers.some(rp => (scores[rp.id] ?? {})[h] != null);
      if (!anyScored) return h;
    }
    return null;
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

  // Build engine-shaped BlindDrawInput[] for the displayed team so the headline
  // team total (and F9/B9/Total) include the drawn player's scores, matching
  // the leaderboard + summary. Self-contained (re-reads team filter, scoring
  // basis, and the drawn player's row/scores/tee-holes from the DB) so it does
  // not depend on render-state that may be stale at mount. Unlike
  // refreshBlindDrawFills (dropout fills only, for the merged grid), this loads
  // ALL fills for the team, including round-start fills. No-op pre-finalize:
  // blind_draws returns no rows → setBlindDrawInputs([]).
  const refreshBlindDrawInputs = async () => {
    const team = new URLSearchParams(window.location.search).get("team");

    let bdQuery = supabase
      .from("blind_draws")
      .select("short_team_number, drawn_player_id, hole_range_start, hole_range_end")
      .eq("round_id", roundId);
    if (team) bdQuery = bdQuery.eq("short_team_number", parseInt(team));
    const { data: bdRows } = await bdQuery.order("id");
    if (!bdRows || bdRows.length === 0) {
      setBlindDrawInputs([]);
      setBlindDrawFillRows([]);
      return;
    }

    // Scoring basis decides whether the drawn player's CH is zeroed (gross).
    // Re-read it rather than trust possibly-stale roundFormatConfig state.
    const { data: roundRow } = await supabase
      .from("rounds")
      .select("format_config")
      .eq("id", roundId)
      .maybeSingle();
    const cfg = (roundRow?.format_config ?? null) as FormatConfig | null;
    const useGross = getScoringBasis(cfg) === "gross";

    // The drawn player is on another team — look up their round_players row
    // (id, tee, CH), scores, and tee holes directly (not in `roundPlayers`,
    // which is scoped to the displayed team).
    const drawnPlayerIds = [...new Set((bdRows as any[]).map(b => b.drawn_player_id as number))];
    const { data: drawnRps } = await supabase
      .from("round_players")
      .select("id, player_id, tee_id, course_handicap, players ( full_name )")
      .eq("round_id", roundId)
      .in("player_id", drawnPlayerIds);
    const drawnByPlayer: Record<number, { id: number; tee_id: number; ch: number | null; fullName: string }> = {};
    (drawnRps ?? []).forEach((r: any) => {
      const playerRow = Array.isArray(r.players) ? r.players[0] : r.players;
      drawnByPlayer[r.player_id] = {
        id: r.id,
        tee_id: r.tee_id,
        ch: r.course_handicap != null ? Number(r.course_handicap) : null,
        fullName: playerRow?.full_name ?? "",
      };
    });

    const drawnRpIds = Object.values(drawnByPlayer).map(d => d.id);
    const { data: drawnScoreRows } = drawnRpIds.length
      ? await supabase
          .from("scores")
          .select("round_player_id, hole_number, strokes")
          .in("round_player_id", drawnRpIds)
      : { data: [] as any[] };
    const drawnScoresByRp: Record<number, Record<number, number>> = {};
    (drawnScoreRows ?? []).forEach((s: any) => {
      if (!drawnScoresByRp[s.round_player_id]) drawnScoresByRp[s.round_player_id] = {};
      drawnScoresByRp[s.round_player_id][s.hole_number] = s.strokes;
    });

    // Drawn player's net uses THEIR OWN tee SI/par — load any drawn tee holes
    // not already in holesByTee state.
    const drawnTeeIds = [...new Set(Object.values(drawnByPlayer).map(d => d.tee_id).filter(Boolean))] as number[];
    const drawnHolesByTee: Record<number, EngineHoleInfo[]> = {};
    for (const teeId of drawnTeeIds) {
      const cached = holesByTee[teeId];
      if (cached && cached.length > 0) {
        drawnHolesByTee[teeId] = cached.map(h => ({
          holeNumber: h.hole_number, par: h.par, strokeIndex: h.stroke_index,
        }));
      } else {
        const { data: h } = await supabase
          .from("holes")
          .select("hole_number, par, stroke_index")
          .eq("tee_id", teeId)
          .order("hole_number");
        drawnHolesByTee[teeId] = (h ?? []).map((r: any) => ({
          holeNumber: r.hole_number, par: r.par, strokeIndex: r.stroke_index,
        }));
      }
    }

    const inputs: BlindDrawInput[] = (bdRows as any[]).map(b => {
      const drawn = drawnByPlayer[b.drawn_player_id as number];
      const drawnRpId = drawn?.id;
      return {
        drawnPlayerId: String(drawnRpId ?? b.drawn_player_id),
        // 2026-06-09: drawn player's CH scaled via the same single-source accessor.
        drawnPlayerCourseHandicap: useGross ? 0 : getPlayingCourseHandicap(drawn?.ch ?? null, cfg),
        drawnPlayerScores: drawnRpId != null ? (drawnScoresByRp[drawnRpId] ?? {}) : {},
        drawnPlayerHoles: drawn ? (drawnHolesByTee[drawn.tee_id] ?? []) : [],
        holeRangeStart: b.hole_range_start as number,
        holeRangeEnd: b.hole_range_end as number,
      };
    });
    setBlindDrawInputs(inputs);

    // Render-ready rows for the read-only 🎲 pseudo-rows. Scores/par are built
    // to 18-length from the same fetched data; holes outside [start,end] are
    // null so they render blank (not zero). The name is disambiguated at
    // render time against allActivePlayers.
    const fillRows: BlindDrawFillRowData[] = (bdRows as any[]).map(b => {
      const drawn = drawnByPlayer[b.drawn_player_id as number];
      const drawnRpId = drawn?.id;
      const scoresMap = drawnRpId != null ? (drawnScoresByRp[drawnRpId] ?? {}) : {};
      const teeHoles = drawn ? (drawnHolesByTee[drawn.tee_id] ?? []) : [];
      const start = b.hole_range_start as number;
      const end = b.hole_range_end as number;
      const scores18: (number | null)[] = Array.from({ length: 18 }, (_, i) => {
        const hole = i + 1;
        if (hole < start || hole > end) return null;
        return scoresMap[hole] ?? null;
      });
      const par18: number[] = Array.from({ length: 18 }, (_, i) =>
        teeHoles.find(h => h.holeNumber === i + 1)?.par ?? 4,
      );
      return {
        playerId: b.drawn_player_id as number,
        fullName: drawn?.fullName ?? "",
        scores: scores18,
        par: par18,
        holeRangeStart: start,
        holeRangeEnd: end,
      };
    });
    setBlindDrawFillRows(fillRows);
  };

  // D.1 hotfix: re-read `format_config.submitted_teams` from the DB so this
  // scorecard picks up another team submitting on another device. Cheap
  // single-row read. Called after every score write + after my own submit.
  const refreshSubmittedTeams = async () => {
    const { data } = await supabase
      .from("rounds")
      .select("format_config, is_complete")
      .eq("id", roundId)
      .maybeSingle();
    if (!data) return;
    const cfg = (data.format_config ?? null) as FormatConfig | null;
    setSubmittedTeams(Array.isArray(cfg?.submitted_teams) ? cfg!.submitted_teams! : []);
    if (data.is_complete) setIsRoundComplete(true);
  };

  // D.1 hotfix: submit MY team. Appends my team_number to
  // format_config.submitted_teams (read-modify-write — race-prone in theory
  // but the league plays in person and submissions are essentially serial).
  // Drains the WriteQueue first so any in-flight scores land before the
  // team is marked submitted. Subsequent all-teams-now-submitted RPC call
  // is triggered by the useEffect below, which re-runs when submittedTeams
  // changes.
  const submitTeam = async (teamNum: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      try { await getWriteQueue().drain(); } catch { /* offline; continue */ }
      // Read latest config (another team may have submitted between mount
      // and now) then merge.
      const { data: row } = await supabase
        .from("rounds")
        .select("format_config")
        .eq("id", roundId)
        .maybeSingle();
      const currentCfg = (row?.format_config ?? roundFormatConfig ?? {}) as FormatConfig & Record<string, unknown>;
      const existing: number[] = Array.isArray(currentCfg.submitted_teams)
        ? currentCfg.submitted_teams as number[]
        : [];
      if (existing.includes(teamNum)) {
        setSubmittedTeams(existing);
        return;
      }
      const nextSubmitted = [...existing, teamNum].sort((a, b) => a - b);
      const nextCfg = { ...currentCfg, submitted_teams: nextSubmitted };
      const { error } = await supabase
        .from("rounds")
        .update({ format_config: nextCfg })
        .eq("id", roundId);
      if (error) {
        console.warn("[D.1 hotfix] submit team update failed", error);
        return;
      }
      setRoundFormatConfig(nextCfg as FormatConfig);
      setSubmittedTeams(nextSubmitted);
    } finally {
      setSubmitting(false);
      setSubmitModal(false);
    }
  };

  // D.1 hotfix: fire the finalize RPC when every team in the round has
  // submitted. Replaces the old auto-fire-on-last-score trigger. Each
  // submit updates `submittedTeams`; this effect inspects the new value
  // and, if every entry of `allTeamNumbers` is present, calls the RPC.
  // RPC is concurrency-safe (SELECT ... FOR UPDATE on rounds), so multiple
  // tabs detecting "all submitted" simultaneously is fine — one wins and
  // returns 'finalized', the others return 'already_complete'.
  const tryFinalizeIfAllSubmitted = async () => {
    if (allSubmittedRpcInFlight) return;
    if (isRoundComplete) return;
    if (allTeamNumbers.length === 0) return;
    const allIn = allTeamNumbers.every(t => submittedTeams.includes(t));
    if (!allIn) return;
    setAllSubmittedRpcInFlight(true);
    try {
      try { await getWriteQueue().drain(); } catch { /* offline; try anyway */ }
      // Wave 1B follow-up: relaxed-close formats (Shambles) finalize via the
      // gaps-tolerant RPC (>=1 score per hole per team, no blind draw). Every
      // other format keeps the blind-draw RPC. The status handling below —
      // including the client-side payout persistence — is SHARED across both
      // paths; only the blind-draw refreshes are skipped for the relaxed path
      // (no fills are ever written there).
      const relaxed = allowsIncompleteClose(roundFormat);
      const { data, error } = await supabase.rpc(
        relaxed ? "finalize_round_relaxed" : "finalize_round_with_blind_draws",
        { p_round_id: Number(roundId) },
      );
      if (error) {
        console.warn("[D.1 hotfix] finalize RPC error", error);
        return;
      }
      const status = (data ?? "") as string;
      if (status === "finalized") {
        setIsRoundComplete(true);
        setFinalizedToastVisible(true);
        setTimeout(() => setFinalizedToastVisible(false), 4000);
        if (!relaxed) {
          void refreshBlindDrawFills();
          void refreshBlindDrawInputs();
        }
        // G2: persist payouts + fund movements. Non-fatal — the round is
        // already finalized; re-running heals a failure (RPC is idempotent).
        void persistPayoutsAfterFinalize(Number(roundId));
      } else if (status === "already_complete") {
        setIsRoundComplete(true);
        if (!relaxed) {
          void refreshBlindDrawFills();
          void refreshBlindDrawInputs();
        }
        // G2: idempotent recovery if a prior persist never completed.
        void persistPayoutsAfterFinalize(Number(roundId));
      } else if (status === "pool_too_small") {
        setPoolErrorVisible(true);
        setTimeout(() => setPoolErrorVisible(false), 6000);
      } else if (status === "not_yet") {
        // Shouldn't happen — all teams submitted implies all scores in.
        // Score still propagating from another tab maybe; the effect will
        // retry when refreshSubmittedTeams next runs.
        console.warn("[D.1 hotfix] all submitted but RPC said not_yet");
      }
    } finally {
      setAllSubmittedRpcInFlight(false);
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
    // B3.2 trick: when admin selected "gross" as the persistent scoring basis,
    // zero out handicaps before passing to the engine. Net == gross for every
    // format including Stableford (which has no internal `basis` branch).
    const useGross = getScoringBasis(roundFormatConfig) === "gross";
    // Wave 1A: scale CH by the per-round allowance before the engine allocates
    // strokes (no-op at 100%). 2026-06-09: routed through getPlayingCourseHandicap
    // — the single source the dots + CH number now also read.
    return computeHoleResult({
      format: roundFormat,
      formatConfig: { ...roundFormatConfig, basis: mode },
      hole,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        grossScore: scores[rp.id]?.[holeNumber] ?? null,
        courseHandicap: useGross ? 0 : getPlayingCourseHandicap(rp.course_handicap, roundFormatConfig),
      })),
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
    const useGross = getScoringBasis(roundFormatConfig) === "gross";
    return computeRoundResult({
      format: roundFormat!,
      formatConfig: { ...roundFormatConfig!, basis: mode },
      holes,
      players: roundPlayers.map(rp => ({
        playerId: String(rp.id),
        courseHandicap: useGross ? 0 : getPlayingCourseHandicap(rp.course_handicap, roundFormatConfig),
        grossScores: scores[rp.id] || {},
      })),
      // Best-N: include the displayed team's blind-draw fill(s) in the per-hole
      // pool so the headline total matches the leaderboard/summary. Empty
      // pre-finalize → no change. Stableford ignores this field (engine
      // accrues fills via blindDrawTotal instead).
      blindDraws: blindDrawInputs,
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

  // --- MANAGE TEAM HANDLERS ---

  const showManageTeamToast = (message: string, onUndo: (() => void) | null) => {
    if (manageTeamToastTimerRef.current) clearTimeout(manageTeamToastTimerRef.current);
    setManageTeamUndoToast({ message, onUndo });
    manageTeamToastTimerRef.current = setTimeout(() => {
      setManageTeamUndoToast(null);
      manageTeamUndoRef.current = null;
    }, 5000);
  };

  const openManageTeam = async () => {
    const roundIdNum = Number(roundId);
    let activePlayers = manageTeamActivePlayers;
    if (activePlayers.length === 0) {
      const { data } = await supabase
        .from("players")
        .select("id, full_name, display_name, handicap_index, is_active, preferred_tee_id")
        .eq("is_active", true)
        .order("full_name");
      activePlayers = (data ?? []) as Player[];
      setManageTeamActivePlayers(activePlayers);
    }
    const { data: allRps } = await supabase
      .from("round_players")
      .select("player_id, team_number")
      .eq("round_id", roundIdNum)
      .gt("team_number", 0);
    const assignedIds = new Set((allRps ?? []).map((r: any) => r.player_id as number));
    setManageTeamUnassigned(activePlayers.filter((p) => !assignedIds.has(p.id)));
    setManageTeamOpen(true);
  };

  const closeManageTeam = async () => {
    await drainWrites();
    setManageTeamOpen(false);
  };

  const handleManageTeamRemove = (roundPlayerId: number) => {
    const rp = roundPlayers.find((p) => p.id === roundPlayerId);
    if (!rp) return;
    const teamNum = teamFilter ? parseInt(teamFilter, 10) : 0;
    setRoundPlayers((prev) => prev.filter((p) => p.id !== roundPlayerId));
    enqueuePlayerWrite(rp.player_id, async () => {
      await supabase.from("round_players").update({ team_number: 0 }).eq("id", roundPlayerId);
    });
    manageTeamUndoRef.current = rp;
    showManageTeamToast(
      `${rp.display_name} removed from Team ${teamNum}. Undo.`,
      () => {
        const removed = manageTeamUndoRef.current;
        if (!removed) return;
        setRoundPlayers((prev) => [...prev, removed]);
        enqueuePlayerWrite(removed.player_id, async () => {
          await supabase
            .from("round_players")
            .update({ team_number: teamNum })
            .eq("id", removed.id);
        });
        if (manageTeamToastTimerRef.current) clearTimeout(manageTeamToastTimerRef.current);
        setManageTeamUndoToast(null);
        manageTeamUndoRef.current = null;
      },
    );
  };

  const handleManageTeamAdd = async (playerIds: number[]) => {
    const roundIdNum = Number(roundId);
    const teamNum = teamFilter ? parseInt(teamFilter, 10) : 0;
    if (!teamNum) return;
    for (const pid of playerIds) {
      enqueuePlayerWrite(pid, async () => {
        const { data: existing } = await supabase
          .from("round_players")
          .select("id, team_number")
          .eq("round_id", roundIdNum)
          .eq("player_id", pid)
          .maybeSingle();
        if (existing) {
          if (existing.team_number !== teamNum) {
            await supabase
              .from("round_players")
              .update({ team_number: teamNum })
              .eq("id", existing.id);
          }
        } else {
          const hi = manageTeamActivePlayers.find(p => p.id === pid)?.handicap_index ?? null;
          await supabase.from("round_players").insert({
            round_id: roundIdNum,
            player_id: pid,
            team_number: teamNum,
            tee_id: null,
            handicap_index_snapshot: hi,
          });
        }
      });
    }
    await drainWrites();
    const { data: refreshed } = await supabase
      .from("round_players")
      .select(
        `id, player_id, tee_id, team_number, course_handicap, dropped_after_hole, handicap_index_snapshot, created_at, hi_verified_at, players ( full_name, display_name, handicap_index, preferred_tee_id )`,
      )
      .eq("round_id", roundId)
      .eq("team_number", teamNum)
      .order("id");
    if (refreshed) {
      setRoundPlayers(
        refreshed.map((r: any) => ({
          id: r.id,
          player_id: r.player_id,
          tee_id: r.tee_id,
          full_name: r.players?.full_name ?? "",
          display_name: disambiguatedName(r.player_id, r.players?.full_name, allActivePlayers),
          handicap_index:
            r.players?.handicap_index != null ? Number(r.players.handicap_index) : null,
          handicap_index_snapshot: r.handicap_index_snapshot != null ? Number(r.handicap_index_snapshot) : null,
          course_handicap: r.course_handicap != null ? Number(r.course_handicap) : null,
          preferred_tee_id: r.players?.preferred_tee_id ?? null,
          dropped_after_hole: r.dropped_after_hole ?? null,
          team_number: r.team_number ?? 0,
          created_at: r.created_at ?? null,
          hi_verified_at: r.hi_verified_at ?? null,
        })),
      );
      setManageTeamUnassigned((prev) => prev.filter((p) => !playerIds.includes(p.id)));
      const addedNames = playerIds
        .map((id) => manageTeamActivePlayers.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => disambiguatedName(p!.id, p!.full_name, allActivePlayers))
        .join(", ");
      showManageTeamToast(`${addedNames} added to Team ${teamNum}.`, null);
    }
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
          // H.2.5.7: read HI from snapshot, not live players.handicap_index.
          // Snapshot is the value in effect at round-creation time and is
          // the column the math layer uses; the display must agree.
          const noHC = rp.handicap_index_snapshot == null;
          const applyDisabled = !tempHandicaps[rp.id] || tempHandicaps[rp.id].trim() === "";
          // 2026-06-09: the tee-setup card's CH number reads the same scaled
          // playing CH as every other surface (orange when an allowance < 100
          // is in effect; raw + navy at 100%).
          const setupPlayingCH = getPlayingCourseHandicap(rp.course_handicap, roundFormatConfig);
          const setupScaled = getHandicapAllowance(roundFormatConfig) < 100;
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
                    Handicap Index: {rp.handicap_index_snapshot ?? "Not on file"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "block" }}>Course Handicap</span>
                  <span style={{ fontSize: "1.2rem", fontWeight: 900, color: setupScaled ? "#c2410c" : "#0c3057" }}>
                    {setupPlayingCH !== null ? setupPlayingCH : "?"}
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
  // Bug #2 (Wave 1A): assign sequential ball numbers 1..N to the counting balls,
  // ordered by net rank (best = Ball 1), ties broken by roster order. N = the
  // number of balls counting on THIS hole — 3 on a normal 3-Ball hole, up to
  // the full team on an "all scores count" override hole, 1 for Best Ball. The
  // engine returns contributingPlayerIds in roster order on override holes, so
  // we re-rank here for display rather than relying on that order. Each number
  // is used exactly once (the prior indexOf-based label stamped "Ball 2" on
  // every counting ball past the first).
  // TODO(I16): label order follows the hole's selection rule (worst-first on
  // worst-counts holes); currently always best-first.
  const ballNumberByRp: Map<number, number> = (() => {
    const rosterIndex = (id: number) => roundPlayers.findIndex(p => p.id === id);
    const ordered = [...countingIds].sort((a, b) => {
      const rpA = roundPlayers.find(p => p.id === a);
      const rpB = roundPlayers.find(p => p.id === b);
      const va = rpA ? (getNetScore(rpA, currentHole) ?? Infinity) : Infinity;
      const vb = rpB ? (getNetScore(rpB, currentHole) ?? Infinity) : Infinity;
      if (va !== vb) return va - vb;
      return rosterIndex(a) - rosterIndex(b);
    });
    const m = new Map<number, number>();
    ordered.forEach((id, i) => m.set(id, i + 1));
    return m;
  })();
  const isBestNFormat = roundFormat === "2_ball" || roundFormat === "3_ball" || roundFormat === "best_ball";
  const isOverrideHole = getOverrideHoles(roundFormatConfig).includes(currentHole);
  const playerToRemove = removePlayerModal !== null ? roundPlayers.find(p => p.id === removePlayerModal) : null;

  // D.1 hotfix — derived booleans for the submit-gate UI:
  //   myTeamSubmitted: my team is locked (read-only) but round may not be
  //                    finalized yet (other teams still scoring).
  //   isLocked:        any reason to render fully read-only (round-finalized
  //                    OR my team submitted). Used to gate +/− buttons and
  //                    the ⋯ overflow menu.
  //   canSubmit:       my team has all required holes scored and hasn't yet
  //                    submitted. Enables the Submit Final Scores button.
  const myTeamNum = teamFilter ? parseInt(teamFilter, 10) : null;
  const myTeamSubmitted = myTeamNum != null && submittedTeams.includes(myTeamNum);
  // 2026-06-09: Manage Team stays visible through the whole round (the old
  // A2.5 hide-on-first-score gate was removed — vanishing mid-round was
  // confusing, and Shambles has mid-round pickups / late-noticed wrong tees).
  // Still hidden once the round is finalized. Does NOT add change-tee (I14).
  const showManageTeam = !isRoundComplete;
  // Admin edit mode bypasses the read-only gate on finalized rounds only.
  // A stray ?edit=1 on a live round is a no-op — the per-team submit gate
  // still applies. Same for non-admin views.
  const adminEditModeActive = isAdmin && isRoundEditMode && isRoundComplete;
  const isLocked = !adminEditModeActive && (isRoundComplete || myTeamSubmitted);
  const canSubmit =
    !isLocked &&
    !adminEditModeActive &&
    myTeamNum != null &&
    isRoundLocallyComplete();

  return (
    <div style={{ padding: "15px", maxWidth: "500px", margin: "0 auto", fontFamily: "sans-serif", paddingBottom: "160px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "15px" }}>
        {teamFilter && (
          <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 900, color: "#0c3057" }}>TEAM {teamFilter}</p>
        )}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          {roundFormat && (
            <FormatChip
              roundId={Number(roundId)}
              currentFormat={roundFormat}
              currentConfig={roundFormatConfig}
              formatLocked={roundFormatLockedAt !== null}
            />
          )}
          {showManageTeam && teamFilter && (
            <button
              onClick={() => void openManageTeam()}
              style={{
                padding: "6px 14px",
                background: "white",
                color: "#0b2d50",
                border: "1.5px solid #0b2d50",
                borderRadius: 999,
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              Manage Team
            </button>
          )}
        </div>
        {/* Wave 1A: round-level handicap-allowance caption. Sits directly under
            the FORMAT chip per 1A mockup; hidden at 100% (the default). Orange
            #c2410c is the shared allowance accent — each player row's scaled CH
            number is tinted the same orange so the two read as one signal. */}
        {getHandicapAllowance(roundFormatConfig) !== 100 && (
          <div style={{
            fontSize: "0.75rem", fontWeight: 700, color: "#c2410c",
            letterSpacing: "0.02em", marginBottom: "8px",
          }}>
            Course Handicap at {getHandicapAllowance(roundFormatConfig)}%
          </div>
        )}
        <div style={{ fontSize: "2.2rem", fontWeight: 900 }}>Hole {currentHole}</div>
        <p style={{ opacity: 0.5, fontSize: "0.75rem", fontWeight: "bold" }}>
          PAR {currentHoleInfo?.par || "?"} • {currentHoleInfo?.yardage || "?"} YDS
        </p>
        {/* D.1 hotfix: lock indicator near the top so it reads before any
            score row. Renders for both submitted-but-round-live and
            round-finalized states. */}
        {myTeamSubmitted && (
          <div style={{
            marginTop: 8,
            display: "inline-block",
            background: "#dcfce7",
            color: "#166534",
            border: "1px solid #bbf7d0",
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Final scores submitted
          </div>
        )}
      </div>

      {/* D.1 hotfix pre-fire banner — render when this team is the last
          one not in submitted_teams AND has all 18 holes scored. The Submit
          button below the player rows is the CTA; the banner just nudges
          the final group. NOT shown when this team is still mid-round. */}
      {(() => {
        if (isRoundComplete) return null;
        if (!teamFilter) return null;
        const myTeam = parseInt(teamFilter, 10);
        if (submittedTeams.includes(myTeam)) return null;
        if (allTeamNumbers.length === 0) return null;
        const everyOtherSubmitted = allTeamNumbers
          .filter(t => t !== myTeam)
          .every(t => submittedTeams.includes(t));
        if (!everyOtherSubmitted) return null;
        if (!isRoundLocallyComplete()) return null;
        return (
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
            All other teams have submitted. Tap Submit Final Scores when ready.
          </div>
        );
      })()}

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
          return (
            <button key={h} onClick={() => setCurrentHole(h)} style={{
              minWidth: "44px", height: "44px", borderRadius: "50%",
              border: h === currentHole ? "2px solid #0c3057" : "1px solid #e2e8f0",
              background: h === currentHole ? "#0c3057" : hasScores ? "#dbeafe" : "white",
              color: h === currentHole ? "white" : hasScores ? "#1e40af" : "#94a3b8",
              fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer", touchAction: "manipulation",
            }}>
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
        const gross = scores[rp.id]?.[currentHole];
        const net = getNetScore(rp, currentHole);
        const holeInfo = holesByTee[rp.tee_id || 0]?.find(h => h.hole_number === currentHole);
        // Wave 1A: dots reflect the allowance-reduced playing strokes (no-op at
        // 100%). 2026-06-09: dots + the CH number on the meta row below now read
        // the SAME getPlayingCourseHandicap value — single source, no drift.
        const playingCH = getPlayingCourseHandicap(rp.course_handicap, roundFormatConfig);
        // 2026-06-09: when an allowance < 100 is in effect the CH number is the
        // SCALED playing value, tinted the same orange as the "Course Handicap
        // at N%" caption so players link the two. At 100% it stays raw + navy.
        const allowanceScaled = getHandicapAllowance(roundFormatConfig) < 100;
        const hcpStrokes = holeInfo
          ? getHandicapStrokes(playingCH, holeInfo.stroke_index)
          : 0;
        // 18-length stroke allocation for the expanded grid's dot row, from the
        // same adjusted playing CH + each hole's stroke index.
        const strokeAllocation18 = Array.from({ length: 18 }, (_, i) => {
          const si = holesByTee[rp.tee_id || 0]?.find(h => h.hole_number === i + 1)?.stroke_index;
          return si == null ? 0 : getHandicapStrokes(playingCH, si);
        });

        const ballNumber = ballNumberByRp.get(rp.id) ?? 0; // 0 = not counting
        const isCounting = ballNumber > 0;

        const countingBorderColor = ballNumber === 1 ? "#0c3057" : "#1e40af";
        const countingBg = "#eff6ff";

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
        // Wave 1A: GHIN Adjusted scores for this player's own grid. ALWAYS at
        // 100% handicap (raw rp.course_handicap) — the GHIN cap ignores the
        // round's allowance by design. Skipped when a dropout fill is merged in
        // (post-drop holes belong to the drawn player's CH/SI, not this row's).
        const si18 = Array.from({ length: 18 }, (_, i) =>
          playerHoles.find(ph => ph.hole_number === i + 1)?.stroke_index ?? null
        );
        const adjScores18: (number | null)[] | undefined = fillForRp
          ? undefined
          : computeAdjustedHoleScores(ownScores18, par18, si18, rp.course_handicap);

        const cardBorderRadius = isExpanded ? "16px 16px 0 0" : "16px";
        const cardMarginBottom = isExpanded ? "0" : "10px";

        const expandStop = (e: React.MouseEvent) => {
          e.stopPropagation();
          toggleExpandedPlayer(rp.id);
        };

        return (
          <React.Fragment key={rp.id}>
            <div
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
                cursor: "default",
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
                  {isBestNFormat && isCounting && (
                    <span style={{
                      fontSize: "0.6rem", fontWeight: 800, padding: "1px 6px", borderRadius: "999px",
                      background: countingBorderColor, color: "white", textTransform: "uppercase",
                    }}>
                      Ball {ballNumber}
                    </span>
                  )}
                  {/* Phase D.2: HI verification chip. Renders only in admin
                      edit mode, when this row was added > 1 day after the
                      round was played and HI hasn't been verified yet. */}
                  {isAdmin && isRoundEditMode && rp.hi_verified_at == null && isHistoricalAdd(rp.created_at, roundPlayedOn) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditHiModal(rp); }}
                      data-testid={`hi-verify-chip-${rp.id}`}
                      style={{
                        fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: "999px",
                        background: "#fef3c7", color: "#92400e", textTransform: "uppercase",
                        border: "1px solid #fcd34d", cursor: "pointer",
                      }}
                    >
                      Verify HI for {roundPlayedOn}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: "0.65rem", fontWeight: "bold", color: "#94a3b8", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "2px" }}>
                  <span style={allowanceScaled ? { color: "#c2410c", fontWeight: 800 } : undefined}>
                    Course Handicap: {playingCH ?? "?"}
                  </span>
                  <span>·</span>
                  {/* H.2.5.7: per-round HI display reads the snapshot, not
                      players.handicap_index. Keeps finalized rounds visually
                      consistent with their locked CH and net scores. */}
                  <span>Handicap Index: {rp.handicap_index_snapshot != null ? rp.handicap_index_snapshot.toFixed(1) : "?"}</span>
                  {/* Phase D.2: Edit HI link — admin in edit mode only.
                      Available on every player (newly added or pre-existing). */}
                  {isAdmin && isRoundEditMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditHiModal(rp); }}
                      data-testid={`hi-edit-link-${rp.id}`}
                      style={{
                        background: "none", border: "none", padding: 0,
                        color: "#0c3057", fontSize: "0.65rem", fontWeight: 700,
                        textDecoration: "underline", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      Edit HI
                    </button>
                  )}
                  {teeColor && (
                    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: teeColor.bg, border: "1px solid #cbd5e1" }} />
                  )}
                  {/* Bug #3 (Wave 1A): always render Net when a score exists,
                      even when net === gross (no stroke on this hole). The old
                      `net !== gross` clause suppressed it, making no-stroke rows
                      look like missing data next to rows that showed Net. */}
                  {gross != null && net != null && (
                    <span style={{ color: "#0c3057" }}>Net: {net}</span>
                  )}
                  {playerTotal > 0 && (
                    <span style={{ color: "#64748b" }}>Tot: {playerTotal}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }} onClick={e => e.stopPropagation()}>
                {!isLocked && (
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
                {!isLocked && (
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
                  isRoundComplete={isLocked}
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
                  adjScores={adjScores18}
                  // Dots from the adjusted playing CH. Skipped on dropout-merged
                  // grids — post-drop holes are the drawn player's scores under
                  // THEIR CH/SI, so this row's allocation wouldn't line up (same
                  // exclusion as adjScores18 above).
                  strokeAllocation={fillForRp ? undefined : strokeAllocation18}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* D.1 (display): 🎲 blind-draw pseudo-rows. One per round-start fill on
          the displayed team (holeRangeStart === 1) — these have no roster slot,
          so without this the read-only scorecard shows a moved total with no
          visible explanation. Dropout fills (holeRangeStart > 1) are already
          shown merged into the dropped player's row above (fillsByRpId), so
          they're excluded here to avoid a duplicate. Empty pre-finalize. */}
      {blindDrawFillRows
        .filter(r => r.holeRangeStart === 1)
        .map((r, i) => (
          <BlindDrawFillRow
            key={`bd-fill-${r.playerId}-${i}`}
            name={r.fullName ? disambiguatedName(r.playerId, r.fullName, allActivePlayers) : "Drawn player"}
            scores={r.scores}
            par={r.par}
            holeRangeStart={r.holeRangeStart}
            holeRangeEnd={r.holeRangeEnd}
            currentHole={currentHole}
          />
        ))}

      {/* Navigation buttons. D.1 hotfix: hole-18 no longer shows a
          "Finish Round" button — finalize happens through the Submit
          Final Scores section below, which gates on the completion
          predicate AND requires explicit user intent. */}
      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <button onClick={() => setCurrentHole(h => Math.max(1, h - 1))} disabled={currentHole === 1}
          style={{
            flex: 1, padding: "18px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white",
            cursor: currentHole === 1 ? "default" : "pointer", opacity: currentHole === 1 ? 0.4 : 1,
            fontFamily: "sans-serif",
          }}>
          ← Back
        </button>
        <button onClick={() => setCurrentHole(h => Math.min(18, h + 1))} disabled={currentHole === 18} style={{
          flex: 2, padding: "18px", borderRadius: "12px",
          background: currentHole === 18 ? "#94a3b8" : "#0c3057",
          color: "white", border: "none", fontWeight: 900,
          cursor: currentHole === 18 ? "default" : "pointer",
          opacity: currentHole === 18 ? 0.6 : 1,
          fontFamily: "sans-serif",
        }}>
          Next Hole →
        </button>
      </div>

      {/* D.1 hotfix: Submit Final Scores. Per-team commit gate that
          replaced the old auto-fire-on-last-score trigger. Disabled until
          this team's completion predicate is true; tap opens a DangerModal
          (1.5s confirm delay, same as the rest of the app). After submit
          the button hides entirely — section disappears for the rest of
          this team's session. Only renders on team-filtered scorecard
          views (?team=N); the whole-round view has no team to submit. */}
      {teamFilter && !isRoundComplete && !myTeamSubmitted && (
        <div style={{ marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => setSubmitModal(true)}
            disabled={!canSubmit || submitting}
            style={{
              width: "100%", padding: "18px", borderRadius: "12px",
              background: canSubmit && !submitting ? "#15803d" : "#cbd5e1",
              color: "white", border: "none", fontWeight: 900,
              fontSize: "1rem",
              cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              fontFamily: "sans-serif",
            }}
          >
            {submitting ? "Submitting…" : "Submit Final Scores"}
          </button>
          {!canSubmit && (
            <p style={{
              margin: "8px 0 0", textAlign: "center",
              fontSize: "0.72rem", color: "#94a3b8",
            }}>
              {/* Wave 1B follow-up: relaxed-close formats (Shambles) only need
                  one score per hole on this team — name the first blocking hole
                  rather than asking for every player. */}
              {allowsIncompleteClose(roundFormat)
                ? (() => {
                    const h = firstUnscoredTeamHole();
                    return h != null && myTeamNum != null
                      ? `Team ${myTeamNum} has no score on hole ${h}.`
                      : "Available once this team has a score on every hole.";
                  })()
                : "Available once every player on this team has scores entered."}
            </p>
          )}
        </div>
      )}

      {submitModal && myTeamNum != null && (
        <DangerModal
          title={`Submit Team ${myTeamNum}'s final scores?`}
          description="You won't be able to edit these scores after submitting."
          cannotBeUndone
          confirmLabel="Submit"
          onConfirm={() => void submitTeam(myTeamNum)}
          onCancel={() => setSubmitModal(false)}
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

      {/* Phase D.2: Edit HI modal. Two save buttons:
            Save     — writes the entered value.
            Verify   — writes the prefilled value unchanged (admin
                       confirms it's correct without retyping).
          Both set hi_verified_at, which dismisses the verification
          chip. CH recomputes in the save handler (self-heal does not
          re-fire on snapshot changes — preflight 2026-05-27). */}
      {editHiRpId !== null && (() => {
        const rp = roundPlayers.find(p => p.id === editHiRpId);
        if (!rp) return null;
        const trimmed = editHiValue.trim();
        const parsed = trimmed === "" ? NaN : parseFloat(trimmed);
        const valid = !isNaN(parsed) && parsed >= 0 && parsed <= 54;
        const close = () => { setEditHiRpId(null); setEditHiValue(""); };
        return (
          <div
            data-testid="edit-hi-modal"
            style={{
              position: "fixed", inset: 0, zIndex: 1000,
              background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "24px",
            }}
            onClick={close}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "white", borderRadius: "16px", padding: "28px 24px",
                maxWidth: "380px", width: "100%",
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                fontFamily: "DM Sans, system-ui, sans-serif",
              }}
            >
              <h2 style={{
                margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 700, color: "#0c3057",
              }}>
                Edit HI for {rp.display_name}
              </h2>
              <p style={{
                margin: "0 0 16px", fontSize: "0.82rem", color: "#6b7280", lineHeight: 1.4,
              }}>
                Updates the snapshot for this round only. Course Handicap and net scores recalculate automatically.
              </p>
              <input
                type="number"
                step="0.1"
                min="0"
                max="54"
                value={editHiValue}
                onChange={e => setEditHiValue(e.target.value)}
                autoFocus
                data-testid="edit-hi-input"
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: "8px",
                  border: "1px solid #cbd5e1", fontSize: "1rem",
                  fontFamily: "inherit", outline: "none", boxSizing: "border-box",
                  marginBottom: "16px",
                }}
              />
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={close}
                  disabled={editHiSaving}
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px",
                    border: "1.5px solid #d1d5db", background: "white",
                    fontSize: "0.92rem", fontWeight: 600, color: "#374151",
                    cursor: editHiSaving ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveEditHi()}
                  disabled={editHiSaving || !valid}
                  data-testid="edit-hi-save"
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px", border: "none",
                    background: (editHiSaving || !valid) ? "#e5e7eb" : "#0c3057",
                    color: (editHiSaving || !valid) ? "#9ca3af" : "white",
                    fontSize: "0.92rem", fontWeight: 700,
                    cursor: (editHiSaving || !valid) ? "not-allowed" : "pointer",
                  }}
                >
                  {editHiSaving ? "Saving…" : "Save"}
                </button>
              </div>
              {/* Verify (no change) — writes the prefilled value as-is
                  and stamps hi_verified_at, so admin can confirm an
                  already-correct HI without retyping. */}
              <button
                onClick={() => void saveEditHi()}
                disabled={editHiSaving || !valid}
                data-testid="edit-hi-verify"
                style={{
                  width: "100%", marginTop: "10px", padding: "9px",
                  borderRadius: "10px", border: "1px solid #cbd5e1",
                  background: "transparent", color: "#0c3057",
                  fontSize: "0.85rem", fontWeight: 600,
                  cursor: (editHiSaving || !valid) ? "not-allowed" : "pointer",
                  opacity: (editHiSaving || !valid) ? 0.5 : 1,
                }}
              >
                Verify (no change)
              </button>
            </div>
          </div>
        );
      })()}

      {/* Manage Team sheet */}
      {manageTeamOpen && teamFilter && (
        <ManageTeamSheet
          teamNumber={parseInt(teamFilter, 10)}
          teamRoster={roundPlayers
            .filter((rp) => rp.team_number === parseInt(teamFilter, 10))
            .map((rp) => ({
              id: rp.id,
              player_id: rp.player_id,
              team_number: rp.team_number,
              players: { full_name: rp.full_name, display_name: rp.display_name },
            }))}
          unassignedActivePlayers={manageTeamUnassigned}
          allActivePlayers={allActivePlayers}
          onRemove={handleManageTeamRemove}
          onAdd={(ids) => void handleManageTeamAdd(ids)}
          onClose={() => void closeManageTeam()}
        />
      )}

      {/* Manage Team undo / info toast */}
      {manageTeamUndoToast && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 0,
            right: 0,
            zIndex: 1200,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "#1f2937",
              color: "white",
              padding: "10px 18px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderRadius: 10,
              fontSize: "0.85rem",
              fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              maxWidth: 400,
              pointerEvents: "auto",
              fontFamily: "sans-serif",
            }}
          >
            <span>{manageTeamUndoToast.message}</span>
            {manageTeamUndoToast.onUndo && (
              <button
                onClick={manageTeamUndoToast.onUndo}
                style={{
                  background: "none",
                  border: "none",
                  color: "#e8a800",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "0 0 0 4px",
                  fontFamily: "sans-serif",
                  whiteSpace: "nowrap",
                }}
              >
                Undo
              </button>
            )}
          </div>
        </div>
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

