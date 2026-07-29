"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  loadMatch,
  MixedTeesInMatchError,
  MatchHolesMissingError,
  MatchNotFoundError,
  MatchLoadError,
} from "@/lib/tournament/loadMatch";
import type { LoadedMatch, Side } from "@/lib/tournament/types";
import { getWriteQueue, getTeamWriteQueue } from "@/lib/writeQueue";
import { getStoredPlayerId } from "@/lib/deviceMemory";
import { setMatchScorer, setMatchFlags } from "@/lib/tournament/mutations";
import TeamHoleEntry from "@/components/scorecard/TeamHoleEntry";
import ScoreMark from "@/components/scorecard/ScoreMark";
import {
  initOptimisticScores,
  overlayPending,
  recomputeState,
  finishBanner,
  countingMarks,
  unitNet,
  strokeDots,
  type OptimisticScores,
  type PendingScore,
  type PendingTeamScore,
} from "@/lib/tournament/matchScorecard";
import { matchStatus, type StatusTone } from "@/lib/tournament/matchStatus";
import { groupLabelFor } from "@/lib/tournament/matchScorecard";
import { holePlayOrder, resolveMatchResult } from "@/lib/tournament/matchplay";
import { TOURNAMENT_TOKENS as T, SIDE_TOKENS, CHROME_GRADIENT, FOCUS_CLASS } from "@/lib/tournament/tokens";
import { HoleStrip } from "@/components/tournament/HoleStrip";
import { HoleDotRail, HolePrevNext } from "./MatchHoleNav";
import MatchClosedBanner from "./MatchClosedBanner";
import MatchReviewGrid from "./MatchReviewGrid";

// The status-line color for a matchStatus tone (usa=blue A up, canada=red C up,
// square/pre=neutral). One mapping so the scorecard status matches the scoreboard.
function statusColor(tone: StatusTone): string {
  if (tone === "usa") return SIDE_TOKENS.a.base;
  if (tone === "canada") return SIDE_TOKENS.b.base;
  return T.ink;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; group: LoadedMatch[] }
  | { kind: "setup_error" }
  | { kind: "not_found" }
  | { kind: "offline" } // transient network/read failure — retryable, NOT "not found"
  | { kind: "error" };

// Load the target match ALONE. Every format — including singles — shows exactly
// its own card: a singles foursome is TWO separate, unlinked 1-v-1 matches (each
// its own 2-player card), reachable individually from the landing/dashboard row
// and each player's own nearest-match resolution. (Was: singles co-rendered its
// foursome sibling under one shared rail — Decision D, reversed for the 1-on-1
// split.) Known loader throws map to friendly states, never a crash.
async function loadGroup(matchId: number): Promise<LoadState> {
  try {
    const target = await loadMatch(matchId);
    const group: LoadedMatch[] = [target];
    return { kind: "ready", group };
  } catch (e) {
    if (e instanceof MixedTeesInMatchError || e instanceof MatchHolesMissingError) {
      return { kind: "setup_error" };
    }
    if (e instanceof MatchNotFoundError) return { kind: "not_found" };
    // A dead network is NOT a missing match — a read failed (transient). Never
    // route to the "not found" copy for it.
    if (e instanceof MatchLoadError) return { kind: "offline" };
    return { kind: "error" };
  }
}

// Seed the per-match soft-claim map from the loaded group. The claim (who is
// scoring) lives on tournament_matches.scorer_label — the player_id as text — so
// it rides the same loadMatch refetch as scores: every backgroundRefresh reseeds
// from server truth, which is exactly how a takeover on another device
// propagates here (the map flips to the new claimant → this device's inputs
// disable). Optimistic local claims (this device just claimed/took over) are
// re-read on the next refresh; a brief flip-back before our own write lands is
// benign — nothing is ever gated on the claim.
function seedScorers(group: LoadedMatch[]): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  for (const m of group) out[m.match.id] = m.match.scorer_label ?? null;
  return out;
}

// The opposing side's "flag this hole" markers (Commit B). Like the claim they
// live on the match row (tournament_matches.flagged_holes int[], migration 037)
// so they ride the same refresh — the scorer's device sees flags within the poll
// interval. A set of holes: the opposing side can flag several at once.
function seedFlags(group: LoadedMatch[]): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const m of group) out[m.match.id] = m.match.flagged_holes ?? [];
  return out;
}

export default function MatchScorecardPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = Number(params?.matchId);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [scoresByMatch, setScoresByMatch] = useState<Record<number, OptimisticScores>>({});
  const [scorerByMatch, setScorerByMatch] = useState<Record<number, string | null>>({});
  const [flagByMatch, setFlagByMatch] = useState<Record<number, number[]>>({});
  const [currentHole, setCurrentHole] = useState(1);
  const [syncFailed, setSyncFailed] = useState(false);

  // Device identity (Relay A). Read once on mount (window-guarded → no hydration
  // mismatch). Drives "am I the scorer" — an EXACT player_id match, not a name.
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  useEffect(() => setMyPlayerId(getStoredPlayerId()), []);

  // Mirror scorerByMatch into a ref so the score-write callbacks can read the
  // current claim synchronously (to claim-on-first-score) without stale closures
  // or re-created callbacks.
  const scorerRef = React.useRef<Record<number, string | null>>({});
  useEffect(() => {
    scorerRef.current = scorerByMatch;
  }, [scorerByMatch]);
  const flagRef = React.useRef<Record<number, number[]>>({});
  useEffect(() => {
    flagRef.current = flagByMatch;
  }, [flagByMatch]);

  // Reconcile = load-then-overlay: server truth (initOptimisticScores) as the
  // base, overlaid with each match's still-pending/in-flight queue items — so a
  // refresh picks up OTHER scorers' server writes without clobbering the local
  // scorer's un-synced entries. Same shape as the league card's mount rehydrate.
  const reconcileScores = useCallback((group: LoadedMatch[]): Record<number, OptimisticScores> => {
    const pendingScores = getWriteQueue()
      .getItems()
      .filter((i) => i.state !== "terminal_failure")
      .map((i) => i.payload as PendingScore);
    const pendingTeam = getTeamWriteQueue()
      .getItems()
      .filter((i) => i.state !== "terminal_failure")
      .map((i) => i.payload as PendingTeamScore);
    const out: Record<number, OptimisticScores> = {};
    for (const m of group) {
      out[m.match.id] = overlayPending(m, initOptimisticScores(m), pendingScores, pendingTeam);
    }
    return out;
  }, []);

  // INITIAL mount load — the ONLY path that owns the error UI.
  const initialLoad = useCallback(async () => {
    if (!Number.isFinite(matchId)) {
      setState({ kind: "not_found" });
      return;
    }
    const next = await loadGroup(matchId);
    setState(next);
    if (next.kind === "ready") {
      setScoresByMatch(reconcileScores(next.group));
      setScorerByMatch(seedScorers(next.group));
      setFlagByMatch(seedFlags(next.group));
      // Shotgun (039): open on the group's tee-off hole. INITIAL load only — a
      // background refresh must never yank the scorer off their current hole.
      const startHole = next.group[0]?.match.start_hole ?? 1;
      setCurrentHole(startHole);
    }
  }, [matchId, reconcileScores]);

  // BEST-EFFORT background refresh — never routes to the error UI, never clears a
  // live card. On a failed (non-ready) load it swallows and leaves the current
  // card + local optimistic scores untouched. On success it reconciles; it may
  // promote a transient `offline` mount back to `ready` (routes AWAY from the
  // transient UI) but NEVER demotes a live card or sets an error/not-found state.
  const backgroundRefresh = useCallback(async () => {
    if (!Number.isFinite(matchId)) return;
    const next = await loadGroup(matchId);
    if (next.kind !== "ready") return; // failure → keep whatever is shown
    setState((prev) => (prev.kind === "ready" || prev.kind === "offline" ? next : prev));
    setScoresByMatch(reconcileScores(next.group));
    setScorerByMatch(seedScorers(next.group)); // server truth → propagates takeovers
    setFlagByMatch(seedFlags(next.group)); // and the opposing side's hole flags
  }, [matchId, reconcileScores]);

  useEffect(() => {
    // Async IIFE: state updates happen after the await inside initialLoad, not
    // synchronously in the effect body.
    void (async () => {
      await initialLoad();
    })();
  }, [initialLoad]);

  // §8 refresh + self-recovery. focus/visibility so a viewer sees others' scores;
  // a 30s poll that fires while the tab is visible REGARDLESS of load state (so a
  // stuck-offline foreground card self-recovers within ~30s without a tab switch);
  // and an `online` event for near-instant recovery the moment signal returns
  // (same signal the WriteQueue drains on). All go through backgroundRefresh, so
  // a failed refresh can never destroy the live card.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    };
    const onOnline = () => void backgroundRefresh();
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const poll = setInterval(refreshIfVisible, 30_000);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      clearInterval(poll);
    };
  }, [backgroundRefresh]);

  // Surface a visible banner if any queued write went terminal (2.1a pattern).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = getWriteQueue();
    const tq = getTeamWriteQueue();
    const check = () =>
      setSyncFailed(
        q.getItems({ state: "terminal_failure" }).length > 0 ||
          tq.getItems({ state: "terminal_failure" }).length > 0,
      );
    check();
    const off1 = q.subscribe(check);
    const off2 = tq.subscribe(check);
    return () => {
      off1();
      off2();
    };
  }, []);

  // Optimistically reassign the claim to this device and persist it (best-effort;
  // refresh reconciles). Both claim-on-first-score and one-tap "Take over" route
  // here. NEVER gates a write — takeover just flips who the card shows as scoring
  // and re-enables this device's inputs instantly.
  const claimFor = useCallback(
    (mId: number, pid: number | null) => {
      const label = pid == null ? null : String(pid);
      scorerRef.current = { ...scorerRef.current, [mId]: label };
      setScorerByMatch((prev) => ({ ...prev, [mId]: label }));
      void setMatchScorer(mId, pid).catch(() => {
        /* soft signal — a failed claim self-heals on the next refresh */
      });
    },
    [],
  );

  // First score on an UNCLAIMED match soft-claims it for this device. If claimed
  // (by me or — after a takeover — someone else) it's left alone. Unidentified
  // devices (no stored id) score without claiming.
  const claimIfUnclaimed = useCallback(
    (mId: number) => {
      if (myPlayerId == null) return;
      if ((scorerRef.current[mId] ?? null) != null) return;
      claimFor(mId, myPlayerId);
    },
    [myPlayerId, claimFor],
  );

  const takeOver = useCallback(
    (mId: number) => claimFor(mId, myPlayerId),
    [myPlayerId, claimFor],
  );

  // Flag set for a match (Commit B, migration 037). Optimistic + persist the WHOLE
  // set (best-effort; refresh reconciles). Metadata only — never touches a score.
  const writeFlags = useCallback((mId: number, next: number[]) => {
    flagRef.current = { ...flagRef.current, [mId]: next };
    setFlagByMatch((prev) => ({ ...prev, [mId]: next }));
    void setMatchFlags(mId, next).catch(() => {
      /* soft signal — self-heals on the next refresh */
    });
  }, []);

  // Opposing side flags a hole (dedupe, kept sorted for a stable "Holes 5, 8" read).
  const addFlag = useCallback(
    (mId: number, hole: number) => {
      const cur = flagRef.current[mId] ?? [];
      if (!cur.includes(hole)) writeFlags(mId, [...cur, hole].sort((a, b) => a - b));
    },
    [writeFlags],
  );

  // Resolve ONE flagged hole (scorer dismiss tap, or auto-clear on correction) —
  // clears just that hole, leaving the others.
  const resolveFlag = useCallback(
    (mId: number, hole: number) => {
      const cur = flagRef.current[mId] ?? [];
      if (cur.includes(hole)) writeFlags(mId, cur.filter((h) => h !== hole));
    },
    [writeFlags],
  );

  // The scorer corrected a score on a flagged hole → that flag has served its
  // purpose; clear just that one.
  const clearFlagIfOnHole = useCallback(
    (mId: number, hole: number) => {
      if ((flagRef.current[mId] ?? []).includes(hole)) resolveFlag(mId, hole);
    },
    [resolveFlag],
  );

  const setPlayerScore = useCallback(
    (m: LoadedMatch, playerId: number, roundPlayerId: number, hole: number, value: number) => {
      claimIfUnclaimed(m.match.id);
      clearFlagIfOnHole(m.match.id, hole);
      setScoresByMatch((prev) => {
        const cur = prev[m.match.id] ?? initOptimisticScores(m);
        return {
          ...prev,
          [m.match.id]: {
            ...cur,
            byPlayer: {
              ...cur.byPlayer,
              [playerId]: { ...cur.byPlayer[playerId], [hole]: value },
            },
          },
        };
      });
      const roundId = m.session.roundId;
      if (roundId != null) {
        getWriteQueue().enqueue(
          { round_id: roundId, round_player_id: roundPlayerId, hole_number: hole, strokes: value },
          { player_name: displayForPlayer(m, playerId), hole_label: `Hole ${hole}` },
        );
      }
    },
    [claimIfUnclaimed, clearFlagIfOnHole],
  );

  const setTeamScore = useCallback(
    (m: LoadedMatch, side: Side, teamNumber: number, hole: number, value: number) => {
      claimIfUnclaimed(m.match.id);
      clearFlagIfOnHole(m.match.id, hole);
      setScoresByMatch((prev) => {
        const cur = prev[m.match.id] ?? initOptimisticScores(m);
        return {
          ...prev,
          [m.match.id]: {
            ...cur,
            teamGross: { ...cur.teamGross, [side]: { ...cur.teamGross[side], [hole]: value } },
          },
        };
      });
      const roundId = m.session.roundId;
      if (roundId != null) {
        // Greensomes: one collapsed team score per (round, team, hole) at ball 1.
        getTeamWriteQueue().enqueue(
          { round_id: roundId, team_number: teamNumber, hole_number: hole, ball_index: 1, strokes: value },
          { player_name: side === "a" ? m.sideA.displayName : m.sideB.displayName, hole_label: `Hole ${hole}` },
        );
      }
    },
    [claimIfUnclaimed, clearFlagIfOnHole],
  );

  if (state.kind === "loading") {
    return <Shell><p style={{ color: "#6b7280" }}>Loading match…</p></Shell>;
  }
  if (state.kind === "setup_error") {
    return (
      <Shell>
        <FriendlyError>
          This match isn’t set up correctly — ask the admin to check its tees and holes.
        </FriendlyError>
      </Shell>
    );
  }
  if (state.kind === "not_found") {
    return (
      <Shell>
        <FriendlyError>This match couldn’t be found. Check the link or ask the admin.</FriendlyError>
      </Shell>
    );
  }
  if (state.kind === "offline") {
    // A read failed (network/offline) — NOT a missing match. Retryable: the card
    // recovers on its own when signal returns (online event / 30s poll).
    return (
      <Shell>
        <FriendlyError>
          Couldn’t reach the server — you may be offline. This will retry on its own when your
          connection returns.
        </FriendlyError>
      </Shell>
    );
  }
  if (state.kind === "error") {
    return (
      <Shell>
        <FriendlyError>Something went wrong loading this match. Try again in a moment.</FriendlyError>
      </Shell>
    );
  }

  const group = state.group;
  const startHole = group[0]?.match.start_hole ?? 1; // shotgun (039): nav play order
  return (
    <Shell>
      {syncFailed && (
        <div
          data-testid="sync-failed-banner"
          style={{
            background: "#fef3c7",
            border: "1px solid #92400e",
            color: "#92400e",
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "12px",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}
        >
          Some scores haven’t synced yet — check your connection. They’ll retry automatically.
        </div>
      )}

      {/* Singles is unlinked (039), so `group` is always ONE match: each card is
          the full mock-v4 scorecard (hero → status → nav → blocks → next). */}
      {group.map((m) => {
        const claimant = scorerByMatch[m.match.id] ?? null;
        // Unclaimed OR claimed by this device → this device may score. Claimed by
        // someone else → read-only-styled + one-tap takeover (never a hard lock).
        const iAmScorer = claimant == null || (myPlayerId != null && String(myPlayerId) === claimant);
        const claimantName =
          claimant == null ? null : displayForPlayer(m, Number(claimant), "Someone");
        return (
          <MatchCard
            key={m.match.id}
            loaded={m}
            scores={scoresByMatch[m.match.id] ?? initOptimisticScores(m)}
            hole={currentHole}
            onSelectHole={setCurrentHole}
            startHole={startHole}
            iAmScorer={iAmScorer}
            claimantName={claimantName}
            onTakeOver={() => takeOver(m.match.id)}
            flaggedHoles={flagByMatch[m.match.id] ?? []}
            onFlagHole={() => addFlag(m.match.id, currentHole)}
            onResolveHole={(hole) => resolveFlag(m.match.id, hole)}
            onSetPlayer={setPlayerScore}
            onSetTeam={setTeamScore}
            onJumpToHole={setCurrentHole}
          />
        );
      })}
    </Shell>
  );
}

// Hero title format name (mock v4: "Day 1 · Modified Alternate Shot") + the
// uppercase sub-line under it.
const FORMAT_TITLE: Record<LoadedMatch["session"]["format"], string> = {
  greensomes: "Modified Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};
const FORMAT_SUB: Record<LoadedMatch["session"]["format"], string> = {
  greensomes: "Alternate shot · one score per team",
  four_ball_match: "Best ball · two scores per side, best net counts",
  singles_match: "Singles · one-on-one match play",
};

function displayForPlayer(m: LoadedMatch, playerId: number, fallback = "Player"): string {
  const p = [...m.sideA.players, ...m.sideB.players].find((x) => x.playerId === playerId);
  return p?.displayName ?? fallback;
}

// ── One match card: header + missing-hole prompt + inputs or finish banner ────
function MatchCard({
  loaded,
  scores,
  hole,
  onSelectHole,
  startHole,
  iAmScorer,
  claimantName,
  onTakeOver,
  flaggedHoles,
  onFlagHole,
  onResolveHole,
  onSetPlayer,
  onSetTeam,
  onJumpToHole,
}: {
  loaded: LoadedMatch;
  scores: OptimisticScores;
  hole: number;
  onSelectHole: (hole: number) => void; // shotgun nav (rail + prev/next) selection
  startHole: number;
  iAmScorer: boolean;
  claimantName: string | null; // resolved name of whoever holds the claim, or null
  onTakeOver: () => void;
  flaggedHoles: number[];
  onFlagHole: () => void;
  onResolveHole: (hole: number) => void;
  onSetPlayer: (m: LoadedMatch, playerId: number, roundPlayerId: number, hole: number, value: number) => void;
  onSetTeam: (m: LoadedMatch, side: Side, teamNumber: number, hole: number, value: number) => void;
  onJumpToHole: (hole: number) => void;
}) {
  // Single source of truth: recompute the canonical state locally from the same
  // pure engine the loader calls, over the optimistic scores. Never our own math.
  const state = useMemo(() => recomputeState(loaded, scores), [loaded, scores]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const holeMeta = loaded.holes[hole - 1];
  const banner = finishBanner(state, loaded);
  // A1 — did a post-decision edit re-decide the match? Compare the server-
  // committed result (loaded.state, from the last load/refresh) against the live
  // recompute over the optimistic scores. Both must already be COMPLETE — a normal
  // first completion is not a "change". Derived from the two MatchStates the card
  // already holds; no engine change, no stored history.
  const resultChanged =
    loaded.state.status === "complete" &&
    state.status === "complete" &&
    loaded.state.result !== state.result;
  // Status from the LIVE recompute (same helpers the loader + scoreboard use):
  // matchStatus reads .state + .resolved, so feed it the live state and a live
  // resolved (resolveMatchResult over the same match row loadMatch uses). This
  // keeps the line SSOT-identical to the scoreboard while updating offline.
  const status = matchStatus({
    ...loaded,
    state,
    resolved: resolveMatchResult(state, loaded.match),
  }); // SSOT with the scoreboard; live-aware

  return (
    <div data-testid={`match-card-${loaded.match.id}`}>
      {/* Hero (mock v4 .sc-hero): day · format, the pairing (USA left / Canada
          right), shotgun start chip + the two scoreboard/home buttons. */}
      <ScHero loaded={loaded} startHole={startHole} />

      {/* Status line (mock .sc-status) — matchStatus() text, prefixed with the
          leader's name and colored by tone. SAME helper the scoreboard uses. */}
      <div
        data-testid={`sc-status-${loaded.match.id}`}
        style={{ fontWeight: 700, fontSize: "1rem", color: statusColor(status.tone), margin: "14px 2px 9px", letterSpacing: "0.01em" }}
      >
        {status.leaderSide != null
          ? `${(status.leaderSide === "a" ? loaded.sideA.displayName : loaded.sideB.displayName)} ${status.text} · ${status.thruText}`
          : status.decided
            ? status.text
            : `${status.text}${status.thruText && status.thruText !== status.text ? ` ${status.thruText}` : ""}`}
      </div>

      {/* Hole nav (mock .holenav): shotgun play order, circles tinted by who won
          each hole (same outcomes as HoleStrip), current = gold ring. */}
      <HoleDotRail
        currentHole={hole}
        onSelect={onSelectHole}
        outcomes={state.holeOutcomes}
        startHole={startHole}
      />

      {/* Flag markers (§B, migration 037 multi-flag). Metadata only — holes the
          opposing side flagged for a second look; never a score/status. Visible to
          everyone (the scorer especially). The set is shown at once (flagging a
          new hole never replaces an earlier one); tap a hole to jump to it; the
          scorer resolves each independently (✕), or a hole auto-clears when its
          score is corrected. */}
      {flaggedHoles.length > 0 && (
        <div
          data-testid={`flag-marker-${loaded.match.id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            background: "#fef3c7",
            border: "1px solid #b45309",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "10px",
          }}
        >
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#92400e" }}>
            ⚑ {flaggedHoles.length === 1 ? "Hole" : "Holes"} {flaggedHoles.join(", ")} flagged —
            check {flaggedHoles.length === 1 ? "this score" : "these"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {flaggedHoles.map((h) => (
              <span
                key={h}
                data-testid={`flag-hole-${loaded.match.id}-${h}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "#fff7e6",
                  border: "1px solid #d9a441",
                  borderRadius: "999px",
                  padding: "2px 8px",
                }}
              >
                <button
                  type="button"
                  onClick={() => onJumpToHole(h)}
                  style={{ background: "none", border: "none", padding: 0, fontSize: "0.78rem", fontWeight: 700, color: "#92400e", cursor: "pointer" }}
                >
                  Hole {h}
                </button>
                {iAmScorer && (
                  <button
                    type="button"
                    aria-label={`Resolve hole ${h}`}
                    data-testid={`flag-resolve-${loaded.match.id}-${h}`}
                    onClick={() => onResolveHole(h)}
                    style={{ background: "none", border: "none", padding: 0, color: "#92400e", fontSize: "0.9rem", fontWeight: 800, cursor: "pointer", lineHeight: 1 }}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Soft scorer-claim (§A). Someone else scoring → read-only-styled inputs +
          one-tap "Take over" (no confirm — a scorer who walks away must hand off
          instantly). Never a hard lock: taking over is one tap and writes are
          never gated on the claim. The opposing viewer can instead "Flag this
          hole" to signal a wrong score without seizing control (§B). */}
      {claimantName != null && !iAmScorer && (
        <div
          data-testid={`scorer-claim-${loaded.match.id}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            background: "#eef2f7",
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "10px",
          }}
        >
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151" }}>
            {claimantName} is scoring
          </span>
          <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid={`flag-hole-${loaded.match.id}`}
              onClick={onFlagHole}
              style={{
                background: "white",
                color: "#92400e",
                border: "1px solid #b45309",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "0.8rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ⚑ Flag this hole
            </button>
            <button
              type="button"
              data-testid={`take-over-${loaded.match.id}`}
              onClick={onTakeOver}
              style={{
                background: "#0c3057",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "0.8rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Take over scoring
            </button>
          </span>
        </div>
      )}
      {claimantName != null && iAmScorer && (
        <div
          data-testid={`scoring-me-${loaded.match.id}`}
          style={{ marginBottom: "10px", fontSize: "0.78rem", fontWeight: 600, color: "#276e34" }}
        >
          You’re scoring
        </div>
      )}

      {/* Missing-hole amber removed (039): completion is order-agnostic, so a
          hole entered out of order is normal, not a "skipped hole" to nag about.
          The dot rail still shows which holes lack a score. */}

      {/* SOFT closeout: when the match is decided the banner shows ABOVE the
          inputs, but the inputs stay live so a stray tap that closed the match
          early is correctable in-round. The banner is derived from
          computeMatchState over the optimistic scores, so a correction that
          un-decides the match clears it automatically — no reopen path. */}
      {banner && (
        <div style={{ marginBottom: "10px" }}>
          <MatchClosedBanner
            banner={banner}
            scoredBeyond={state.scoredBeyondCloseout}
            resultChanged={resultChanged}
            onRequestReopen={undefined /* Phase 4 wires admin override to this hook */}
          />
        </div>
      )}

      {/* F1 — per-hole context, once per card, identical across all three
          formats. #/par/yardage/SI straight from the loader's HoleMeta. */}
      {holeMeta && (
        <div
          data-testid={`hole-context-${loaded.match.id}`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            alignItems: "baseline",
            marginBottom: "8px",
            fontSize: "0.8rem",
            color: "#374151",
          }}
        >
          <span style={{ fontWeight: 800, color: "#0c3057" }}>Hole {holeMeta.holeNumber}</span>
          <span>Par {holeMeta.par}</span>
          {holeMeta.yardage != null && <span>{holeMeta.yardage} yds</span>}
          <span>SI {holeMeta.strokeIndex}</span>
        </div>
      )}
      {/* Per-team entry blocks (mock .tblock). Format decides the entry area:
          greensomes = one team box; four-ball = two player boxes + counting mark;
          singles = one player box. The "USA wins the hole" line was removed — the
          nav circle + the per-block HoleStrip already show who won. */}
      {loaded.session.format === "greensomes"
        ? renderGreensomes(loaded, scores, hole, holeMeta, state, startHole, onSetTeam, !iAmScorer)
        : renderIndividual(loaded, scores, hole, holeMeta, state, startHole, onSetPlayer, !iAmScorer)}

      {/* §C — read-only 18-hole review grid (paper verification: gross + dots per
          unit, which the win/loss HoleStrip doesn't show). Collapsed by default. */}
      <div style={{ marginTop: "12px" }}>
        <button
          type="button"
          data-testid={`review-toggle-${loaded.match.id}`}
          aria-expanded={reviewOpen}
          onClick={() => setReviewOpen((v) => !v)}
          style={{
            background: "none",
            border: `1px solid ${T.line}`,
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: T.ink,
            cursor: "pointer",
          }}
        >
          {reviewOpen ? "Hide 18-hole review" : "Review 18 holes"}
        </button>
        {reviewOpen && (
          <MatchReviewGrid loaded={loaded} scores={scores} state={state} flaggedHoles={flaggedHoles} />
        )}
      </div>

      {/* Back / Next hole (mock .nextbtn) — shotgun rotation + wrap. */}
      <div style={{ marginTop: "12px" }}>
        <HolePrevNext currentHole={hole} onSelect={onSelectHole} startHole={startHole} />
      </div>
    </div>
  );
}

// Alternate shot (§4.1): one score box per side; both partner names; collapsed
// team handicap; dots from the SIDE's collapsed match strokes (Decision B).
function renderGreensomes(
  loaded: LoadedMatch,
  scores: OptimisticScores,
  hole: number,
  holeMeta: { par: number; strokeIndex: number },
  state: ReturnType<typeof recomputeState>,
  startHole: number,
  onSetTeam: (m: LoadedMatch, side: Side, teamNumber: number, hole: number, value: number) => void,
  readOnly: boolean,
) {
  const order = holePlayOrder(startHole);
  const row = (side: Side) => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    const gross = scores.teamGross[side][hole];
    const ms = ls.sideMatchStrokes ?? 0;
    const net = unitNet(ms, holeMeta.strokeIndex, gross ?? null);
    const names = ls.players.map((p) => p.displayName).join(" / ") || "—";
    // Strokes label (approved): the collapsed 60/40 team handicap.
    const sub = `${ls.displayName} · Strokes ${ls.collapsedHandicap ?? "—"}`;
    return (
      <TeamBlock key={side} side={side} title={names} sub={sub} outcomes={state.holeOutcomes} playOrder={order}>
        <EntryRow
          testid={`greensomes-${side}`}
          gross={gross ?? undefined}
          par={holeMeta.par}
          dots={strokeDots(ms, holeMeta.strokeIndex)}
          net={net}
          disabled={readOnly}
          onSet={(v) => onSetTeam(loaded, side, ls.teamNumber, hole, v)}
        />
      </TeamBlock>
    );
  };
  return (
    <>
      {row("a")}
      {row("b")}
    </>
  );
}

// Best ball / singles (§4.2 / §4.3): one box per player; four-ball marks the
// counting ball from the engine (Decision C tie rule via presence).
function renderIndividual(
  loaded: LoadedMatch,
  scores: OptimisticScores,
  hole: number,
  holeMeta: { par: number; strokeIndex: number },
  state: ReturnType<typeof recomputeState>,
  startHole: number,
  onSetPlayer: (m: LoadedMatch, playerId: number, roundPlayerId: number, hole: number, value: number) => void,
  readOnly: boolean,
) {
  const order = holePlayOrder(startHole);
  const sideRow = (side: Side) => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    const present = ls.players.map((p) => scores.byPlayer[p.playerId]?.[hole] != null);
    const marks = countingMarks(
      side === "a" ? state.countingUnitA : state.countingUnitB,
      hole,
      present,
    );
    return (
      <TeamBlock key={side} side={side} title={ls.displayName} outcomes={state.holeOutcomes} playOrder={order}>
        {ls.players.map((p, i) => {
          const gross = scores.byPlayer[p.playerId]?.[hole];
          const net = unitNet(p.matchStrokes, holeMeta.strokeIndex, gross ?? null);
          return (
            <div key={p.playerId} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: i < ls.players.length - 1 ? "8px" : 0 }}>
              <span style={{ minWidth: "92px", fontWeight: 600, color: T.ink, fontSize: "0.86rem" }}>
                {p.displayName}
                {/* Strokes label (approved): per-player match strokes. */}
                <span style={{ display: "block", fontSize: "0.66rem", fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>
                  Strokes {p.matchStrokes}
                </span>
              </span>
              <EntryRow
                testid={`player-${p.playerId}`}
                gross={gross ?? undefined}
                par={holeMeta.par}
                dots={strokeDots(p.matchStrokes, holeMeta.strokeIndex)}
                net={net}
                counting={marks[i]}
                disabled={readOnly}
                onSet={(v) => onSetPlayer(loaded, p.playerId, p.roundPlayerId, hole, v)}
              />
            </div>
          );
        })}
      </TeamBlock>
    );
  };
  return (
    <>
      {sideRow("a")}
      {sideRow("b")}
    </>
  );
}

// #RRGGBB + alpha → rgba(), for the mock's translucent country gradients.
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Net-vs-par term for the entry netlabel ("Net 4 · birdie").
function netTerm(net: number, par: number): string {
  const d = net - par;
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double bogey";
  if (d === 3) return "triple bogey";
  return `+${d}`;
}

// Mock v4 .tblock: country-gradient block, name/strokes top, entry, and a
// chevron that expands the SHARED colorized HoleStrip (same outcomes + play
// order the scoreboard/nav read). `sub` is the small right-aligned meta.
function TeamBlock({
  side,
  title,
  sub,
  outcomes,
  playOrder,
  children,
}: {
  side: Side;
  title: string;
  sub?: string;
  outcomes: ReadonlyArray<import("@/lib/tournament/types").HoleOutcome>;
  playOrder: number[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const c = SIDE_TOKENS[side];
  const grad =
    side === "a"
      ? `linear-gradient(90deg, ${hexA(c.base, 0.07)}, transparent 55%)`
      : `linear-gradient(270deg, ${hexA(c.base, 0.07)}, transparent 55%)`;
  return (
    <div style={{ border: `1px solid ${hexA(c.base, 0.22)}`, borderRadius: 13, marginBottom: 9, overflow: "hidden", background: grad }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 12px 8px" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: c.ink }}>{title}</span>
        {sub && <span style={{ fontSize: "0.66rem", color: T.muted, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{sub}</span>}
      </div>
      <div style={{ padding: "0 12px 8px" }}>{children}</div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={FOCUS_CLASS}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderTop: `1px solid ${T.line}`, padding: 8, fontSize: "0.7rem", fontWeight: 600, color: T.muted, cursor: "pointer", background: "rgba(255,255,255,0.5)", border: "none", borderTopStyle: "solid" }}
      >
        All 18 holes <span style={{ transform: open ? "rotate(180deg)" : "none", transition: ".2s" }}>⌄</span>
      </button>
      {open && (
        <div style={{ padding: "9px 10px 11px", background: T.soft, borderTop: `1px solid ${T.line}` }}>
          <HoleStrip outcomes={outcomes} holeOrder={playOrder} />
        </div>
      )}
    </div>
  );
}

// Mock v4 .entry: stroke dots ABOVE the reused +/− stepper, then the NET cell —
// the net wrapped in the league notation component (ScoreMark: circle under /
// square over) + its term + the four-ball counting-ball arrow. No math here.
function EntryRow({
  testid,
  gross,
  par,
  dots,
  net,
  counting,
  disabled,
  onSet,
}: {
  testid: string;
  gross: number | undefined;
  par: number;
  dots: number;
  net: number | null;
  counting?: boolean;
  disabled?: boolean;
  onSet: (value: number) => void;
}) {
  return (
    <div data-testid={testid} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <div data-testid={`${testid}-dots`} style={{ height: "8px", display: "flex", gap: "3px", alignItems: "center" }}>
          {Array.from({ length: dots }).map((_, i) => (
            <span key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: SIDE_TOKENS.a.base }} />
          ))}
        </div>
        <TeamHoleEntry ballCount={1} balls={[gross]} par={par} disabled={disabled} onSet={(_, v) => onSet(v)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", color: T.muted }}>
        <span>Net</span>
        <span style={{ fontWeight: 700, color: T.ink, display: "inline-flex", alignItems: "center", minHeight: "22px" }}>
          {net == null ? "—" : <ScoreMark delta={net - par} score={net} />}
        </span>
        {net != null && <span>· {netTerm(net, par)}</span>}
        {counting && (
          <span data-testid={`${testid}-counting`} title="Counting ball" style={{ color: T.ok, fontWeight: 900 }}>
            ←
          </span>
        )}
      </div>
    </div>
  );
}

// The side's strokes shown in the hero sub-line (approved): greensomes → the
// collapsed 60/40 team handicap; four-ball / singles → per-player match strokes.
function strokesForSide(loaded: LoadedMatch, side: Side): string {
  const ls = side === "a" ? loaded.sideA : loaded.sideB;
  if (loaded.session.format === "greensomes") {
    return ls.collapsedHandicap != null ? String(ls.collapsedHandicap) : "—";
  }
  return ls.players.map((p) => p.matchStrokes).join(" / ") || "—";
}

const heroBtn: React.CSSProperties = {
  width: "100%",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#fff",
  background: "rgba(255,255,255,0.16)",
  border: "none",
  borderRadius: 8,
  padding: "9px 12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textAlign: "center",
  textDecoration: "none",
  boxSizing: "border-box",
};

// Mock v4 .sc-hero (navy gradient): day · format + sub, the pairing (USA left /
// blue, Canada right / red — on-dark colors), and the foot row = shotgun start
// chip LEFT + two equal stacked buttons RIGHT.
function ScHero({ loaded, startHole: _startHole }: { loaded: LoadedMatch; startHole: number }) {
  const aNames = loaded.sideA.players.map((p) => p.displayName).join(" / ") || loaded.sideA.displayName;
  const bNames = loaded.sideB.players.map((p) => p.displayName).join(" / ") || loaded.sideB.displayName;
  const showStart = loaded.match.start_hole != null; // shotgun only
  const groupLabel = groupLabelFor(loaded.match.group_number, loaded.match.group_label);
  const small: React.CSSProperties = { fontWeight: 400, opacity: 0.72, display: "block", marginTop: 2, color: "#cdd8e8" };
  return (
    <div style={{ background: CHROME_GRADIENT, color: "#fff", borderRadius: 16, padding: "14px 15px" }}>
      <div style={{ fontWeight: 600, fontSize: "1.05rem", letterSpacing: "0.02em" }}>
        {loaded.session.name} · {FORMAT_TITLE[loaded.session.format]}
      </div>
      <div style={{ fontSize: "0.7rem", opacity: 0.72, marginTop: 1, textTransform: "uppercase", letterSpacing: "0.09em" }}>
        {FORMAT_SUB[loaded.session.format]}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 12, gap: 10, fontSize: "0.82rem" }}>
        <span style={{ color: SIDE_TOKENS.a.dark, fontWeight: 600 }}>
          {aNames}
          <small style={small}>{loaded.sideA.displayName} · Strokes {strokesForSide(loaded, "a")}</small>
        </span>
        <span style={{ fontSize: "0.7rem", opacity: 0.7, paddingTop: 2 }}>v</span>
        <span style={{ color: SIDE_TOKENS.b.dark, fontWeight: 600, textAlign: "right" }}>
          {bNames}
          <small style={small}>{loaded.sideB.displayName} · Strokes {strokesForSide(loaded, "b")}</small>
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 13, gap: 10 }}>
        {showStart ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 600, background: T.gold, color: "#3a2d00", borderRadius: 7, padding: "6px 10px" }}>
            🚩 Start: Hole {loaded.match.start_hole}
            {groupLabel ? ` · Group ${groupLabel}` : ""}
          </span>
        ) : (
          <span />
        )}
        <span style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, width: 150 }}>
          <Link href="/tournament/dashboard" data-testid="scorecard-view-scoreboard" className={FOCUS_CLASS} style={heroBtn}>
            View scoreboard →
          </Link>
          <Link href="/tournament" data-testid="scorecard-tournament-home" className={FOCUS_CLASS} style={heroBtn}>
            Tournament Home →
          </Link>
        </span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: "560px",
        margin: "0 auto",
        padding: "16px",
        paddingBottom: "96px", // clear the fixed bottom nav (mirrors dashboard/review)
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        background: "#f2f1ed",
        minHeight: "100vh",
      }}
    >
      {children}
    </main>
  );
}

function FriendlyError({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "10px",
        padding: "20px",
        color: "#374151",
        fontSize: "0.95rem",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
