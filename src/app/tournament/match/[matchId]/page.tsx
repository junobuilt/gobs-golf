"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  loadMatch,
  loadSessionMatches,
  MixedTeesInMatchError,
  MatchHolesMissingError,
  MatchNotFoundError,
  MatchLoadError,
} from "@/lib/tournament/loadMatch";
import type { LoadedMatch, Side } from "@/lib/tournament/types";
import { getWriteQueue, getTeamWriteQueue } from "@/lib/writeQueue";
import { getStoredPlayerId } from "@/lib/deviceMemory";
import { setMatchScorer, setMatchFlag } from "@/lib/tournament/mutations";
import { getTeamColor } from "@/lib/teamColors";
import TeamHoleEntry from "@/components/scorecard/TeamHoleEntry";
import ScoreMark from "@/components/scorecard/ScoreMark";
import {
  initOptimisticScores,
  overlayPending,
  recomputeState,
  formatPoints,
  thruDisplay,
  marginWithSide,
  finishBanner,
  missingHoleGap,
  countingMarks,
  unitNet,
  strokeDots,
  type OptimisticScores,
  type PendingScore,
  type PendingTeamScore,
} from "@/lib/tournament/matchScorecard";
import { HoleDotRail, HolePrevNext } from "./MatchHoleNav";
import MatchClosedBanner from "./MatchClosedBanner";
import MatchReviewGrid from "./MatchReviewGrid";

// Side A = blue, Side B = red (shared team palette, same as the admin pairings).
const SIDE_COLOR: Record<Side, { border: string; bg: string; text: string }> = {
  a: { border: getTeamColor(4).border, bg: getTeamColor(4).pillBg, text: getTeamColor(4).pillText },
  b: { border: getTeamColor(6).border, bg: getTeamColor(6).pillBg, text: getTeamColor(6).pillText },
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; group: LoadedMatch[] }
  | { kind: "setup_error" }
  | { kind: "not_found" }
  | { kind: "offline" } // transient network/read failure — retryable, NOT "not found"
  | { kind: "error" };

// Load the target match and — for singles — its foursome sibling (same
// group_number). Known loader throws map to friendly states, never a crash.
async function loadGroup(matchId: number): Promise<LoadState> {
  try {
    const target = await loadMatch(matchId);
    let group: LoadedMatch[] = [target];
    if (target.session.format === "singles_match" && target.match.group_number != null) {
      const all = await loadSessionMatches(target.session.id);
      const g = all
        .filter((m) => m.match.group_number === target.match.group_number)
        .sort((a, b) => a.match.match_number - b.match.match_number);
      if (g.length > 0) group = g;
    }
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

// The opposing side's "flag this hole" marker (Commit B). Like the claim it lives
// on the match row (tournament_matches.flagged_hole, migration 036) so it rides
// the same refresh — the scorer's device sees the flag within the poll interval.
function seedFlags(group: LoadedMatch[]): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const m of group) out[m.match.id] = m.match.flagged_hole ?? null;
  return out;
}

export default function MatchScorecardPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = Number(params?.matchId);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [scoresByMatch, setScoresByMatch] = useState<Record<number, OptimisticScores>>({});
  const [scorerByMatch, setScorerByMatch] = useState<Record<number, string | null>>({});
  const [flagByMatch, setFlagByMatch] = useState<Record<number, number | null>>({});
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
  const flagRef = React.useRef<Record<number, number | null>>({});
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

  // Flag / clear a hole (Commit B). Optimistic + persist (best-effort; refresh
  // reconciles). Metadata only — never touches a score. `clearFlag` is called
  // both by the scorer's dismiss tap and automatically when the flagged hole's
  // score is corrected.
  const setFlag = useCallback((mId: number, hole: number | null) => {
    flagRef.current = { ...flagRef.current, [mId]: hole };
    setFlagByMatch((prev) => ({ ...prev, [mId]: hole }));
    void setMatchFlag(mId, hole).catch(() => {
      /* soft signal — self-heals on the next refresh */
    });
  }, []);

  // The scorer corrected a score on a hole that was flagged → the flag has served
  // its purpose; clear it.
  const clearFlagIfOnHole = useCallback(
    (mId: number, hole: number) => {
      if ((flagRef.current[mId] ?? null) === hole) setFlag(mId, null);
    },
    [setFlag],
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
  const anyScoreAtHole = (h: number): boolean =>
    group.some((m) => {
      const s = scoresByMatch[m.match.id];
      if (!s) return false;
      for (const pid of Object.keys(s.byPlayer)) if (s.byPlayer[Number(pid)]?.[h] != null) return true;
      return s.teamGross.a[h] != null || s.teamGross.b[h] != null;
    });

  const header = group[0];
  return (
    <Shell>
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0c3057" }}>
          {header.tournament.sideAName} v {header.tournament.sideBName}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
          {header.session.name} · {FORMAT_LABEL[header.session.format]}
        </div>
      </div>

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

      <HoleDotRail currentHole={currentHole} onSelect={setCurrentHole} hasScore={anyScoreAtHole} />

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
            compact={group.length > 1}
            iAmScorer={iAmScorer}
            claimantName={claimantName}
            onTakeOver={() => takeOver(m.match.id)}
            flaggedHole={flagByMatch[m.match.id] ?? null}
            onFlagHole={() => setFlag(m.match.id, currentHole)}
            onClearFlag={() => setFlag(m.match.id, null)}
            onSetPlayer={setPlayerScore}
            onSetTeam={setTeamScore}
            onJumpToHole={setCurrentHole}
          />
        );
      })}

      <HolePrevNext currentHole={currentHole} onSelect={setCurrentHole} />
    </Shell>
  );
}

const FORMAT_LABEL: Record<LoadedMatch["session"]["format"], string> = {
  greensomes: "Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
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
  compact,
  iAmScorer,
  claimantName,
  onTakeOver,
  flaggedHole,
  onFlagHole,
  onClearFlag,
  onSetPlayer,
  onSetTeam,
  onJumpToHole,
}: {
  loaded: LoadedMatch;
  scores: OptimisticScores;
  hole: number;
  compact: boolean;
  iAmScorer: boolean;
  claimantName: string | null; // resolved name of whoever holds the claim, or null
  onTakeOver: () => void;
  flaggedHole: number | null;
  onFlagHole: () => void;
  onClearFlag: () => void;
  onSetPlayer: (m: LoadedMatch, playerId: number, roundPlayerId: number, hole: number, value: number) => void;
  onSetTeam: (m: LoadedMatch, side: Side, teamNumber: number, hole: number, value: number) => void;
  onJumpToHole: (hole: number) => void;
}) {
  // Single source of truth: recompute the canonical state locally from the same
  // pure engine the loader calls, over the optimistic scores. Never our own math.
  const state = useMemo(() => recomputeState(loaded, scores), [loaded, scores]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const holeMeta = loaded.holes[hole - 1];
  const gap = missingHoleGap(state);
  const banner = finishBanner(state, loaded);
  const outcome = state.holeOutcomes[hole - 1];

  const pad = compact ? "10px 12px" : "14px 16px";
  return (
    <div
      data-testid={`match-card-${loaded.match.id}`}
      style={{
        background: "white",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "10px",
        padding: pad,
        marginBottom: "12px",
      }}
    >
      {/* Header (§3): points — margin · thru (thru = closedOutHole ?? thru). */}
      <div
        data-testid={`match-header-${loaded.match.id}`}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: compact ? "6px" : "10px",
        }}
      >
        <span style={{ fontWeight: 800, color: "#0c3057", fontSize: compact ? "0.95rem" : "1.05rem" }}>
          <span style={{ color: SIDE_COLOR.a.text }}>{loaded.sideA.displayName} {formatPoints(state.pointsA)}</span>
          {" — "}
          <span style={{ color: SIDE_COLOR.b.text }}>{loaded.sideB.displayName} {formatPoints(state.pointsB)}</span>
        </span>
        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#374151" }}>
          {state.thru === 0 && !marginWithSide(state, loaded)
            ? "not started"
            : `${marginWithSide(state, loaded)}${marginWithSide(state, loaded) ? " · " : ""}thru ${thruDisplay(state)}`}
        </span>
      </div>

      {/* Flag marker (§B). Metadata only — a hole the opposing side flagged for a
          second look; it never changes a score/status. Visible to everyone (the
          scorer especially); tap to jump to the hole; the scorer dismisses it or
          it auto-clears when that hole's score is corrected. */}
      {flaggedHole != null && (
        <div
          data-testid={`flag-marker-${loaded.match.id}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            background: "#fef3c7",
            border: "1px solid #b45309",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "10px",
          }}
        >
          <button
            type="button"
            onClick={() => onJumpToHole(flaggedHole)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              textAlign: "left",
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "#92400e",
              cursor: "pointer",
            }}
          >
            ⚑ Hole {flaggedHole} flagged — check this score
          </button>
          {iAmScorer && (
            <button
              type="button"
              aria-label="Dismiss flag"
              data-testid={`flag-dismiss-${loaded.match.id}`}
              onClick={onClearFlag}
              style={{
                background: "none",
                border: "none",
                color: "#92400e",
                fontSize: "1rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
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

      {/* Missing-hole amber (§6 + Decision E): carried on every hole; inputs stay live. */}
      {gap != null && (
        <button
          data-testid={`missing-hole-${loaded.match.id}`}
          onClick={() => onJumpToHole(gap)}
          style={{
            width: "100%",
            textAlign: "left",
            background: "#fef3c7",
            border: "1px solid #92400e",
            color: "#92400e",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "10px",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {gap <= 1
            ? "Hole 1 has no score — enter it to score the match."
            : `Hole ${gap} has no score — the match can’t be scored past hole ${gap - 1}.`}
        </button>
      )}

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
      {loaded.session.format === "greensomes"
        ? renderGreensomes(loaded, scores, hole, holeMeta, onSetTeam, !iAmScorer)
        : renderIndividual(loaded, scores, hole, holeMeta, state, onSetPlayer, !iAmScorer)}
      {/* Hole outcome line (§4.4): nothing when a side has no score. */}
      {outcome != null && (
        <div
          data-testid={`hole-outcome-${loaded.match.id}`}
          style={{ marginTop: "10px", fontWeight: 700, color: "#0c3057", fontSize: "0.9rem" }}
        >
          →{" "}
          {outcome === "halved"
            ? "Halved"
            : `${outcome === "side_a" ? loaded.sideA.displayName : loaded.sideB.displayName} wins the hole`}
        </div>
      )}

      {/* §C — read-only 18-hole review grid (paper verification at the turn/end).
          Collapsed by default; no entry here. */}
      <div style={{ marginTop: "12px" }}>
        <button
          type="button"
          data-testid={`review-toggle-${loaded.match.id}`}
          aria-expanded={reviewOpen}
          onClick={() => setReviewOpen((v) => !v)}
          style={{
            background: "none",
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#0c3057",
            cursor: "pointer",
          }}
        >
          {reviewOpen ? "Hide 18-hole review" : "Review 18 holes"}
        </button>
        {reviewOpen && (
          <MatchReviewGrid loaded={loaded} scores={scores} state={state} flaggedHole={flaggedHole} />
        )}
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
  onSetTeam: (m: LoadedMatch, side: Side, teamNumber: number, hole: number, value: number) => void,
  readOnly: boolean,
) {
  const row = (side: Side) => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    const gross = scores.teamGross[side][hole];
    const ms = ls.sideMatchStrokes ?? 0;
    const net = unitNet(ms, holeMeta.strokeIndex, gross ?? null);
    const names = ls.players.map((p) => p.displayName).join(" / ") || "—";
    return (
      <SideBlock key={side} side={side} title={names} subtitle={`Team CH ${ls.collapsedHandicap ?? "—"}`}>
        <ScoreBox
          testid={`greensomes-${side}`}
          balls={[gross ?? undefined]}
          par={holeMeta.par}
          dots={strokeDots(ms, holeMeta.strokeIndex)}
          net={net}
          disabled={readOnly}
          onSet={(v) => onSetTeam(loaded, side, ls.teamNumber, hole, v)}
        />
      </SideBlock>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {row("a")}
      {row("b")}
    </div>
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
  onSetPlayer: (m: LoadedMatch, playerId: number, roundPlayerId: number, hole: number, value: number) => void,
  readOnly: boolean,
) {
  const sideRow = (side: Side) => {
    const ls = side === "a" ? loaded.sideA : loaded.sideB;
    const present = ls.players.map((p) => scores.byPlayer[p.playerId]?.[hole] != null);
    const marks = countingMarks(
      side === "a" ? state.countingUnitA : state.countingUnitB,
      hole,
      present,
    );
    return (
      <SideBlock key={side} side={side} title={ls.displayName}>
        {ls.players.map((p, i) => {
          const gross = scores.byPlayer[p.playerId]?.[hole];
          const net = unitNet(p.matchStrokes, holeMeta.strokeIndex, gross ?? null);
          return (
            <div key={p.playerId} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ minWidth: "84px", fontWeight: 600, color: "#111827", fontSize: "0.9rem" }}>
                {p.displayName}
              </span>
              <ScoreBox
                testid={`player-${p.playerId}`}
                balls={[gross ?? undefined]}
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
      </SideBlock>
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {sideRow("a")}
      {sideRow("b")}
    </div>
  );
}

function SideBlock({
  side,
  title,
  subtitle,
  children,
}: {
  side: Side;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const c = SIDE_COLOR[side];
  return (
    <div style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: "8px", padding: "8px 10px" }}>
      {/* Two-weight hierarchy, sentence case: bold side name (700), light meta (500). */}
      <div style={{ fontSize: "0.82rem", fontWeight: 700, color: c.text }}>
        {title}
        {subtitle && <span style={{ marginLeft: "8px", fontWeight: 500, color: "#6b7280" }}>{subtitle}</span>}
      </div>
      <div style={{ marginTop: "6px" }}>{children}</div>
    </div>
  );
}

// One stepper (reused TeamHoleEntry) + its stroke dots, net, and counting mark.
function ScoreBox({
  testid,
  balls,
  par,
  dots,
  net,
  counting,
  disabled,
  onSet,
}: {
  testid: string;
  balls: (number | undefined)[];
  par: number;
  dots: number;
  net: number | null;
  counting?: boolean;
  disabled?: boolean;
  onSet: (value: number) => void;
}) {
  // Polish (§D): stroke dots ABOVE the number (league dot-above-score pattern),
  // the reused +/− stepper unchanged, then the net score cell carrying the
  // traditional circle/square notation (ScoreMark, net vs par) with the
  // counting-ball arrow inline. Presentation only — no score arithmetic here.
  return (
    <div data-testid={testid} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <div data-testid={`${testid}-dots`} style={{ height: "8px", display: "flex", gap: "3px", alignItems: "center" }}>
          {Array.from({ length: dots }).map((_, i) => (
            <span key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#1e40af" }} />
          ))}
        </div>
        <TeamHoleEntry ballCount={1} balls={balls} par={par} disabled={disabled} onSet={(_, v) => onSet(v)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", color: "#374151" }}>
        <span style={{ fontWeight: 500 }}>Net</span>
        <span style={{ fontWeight: 700, color: "#0c3057", display: "inline-flex", alignItems: "center", minHeight: "22px" }}>
          {net == null ? "—" : <ScoreMark delta={net - par} score={net} />}
        </span>
        {counting && (
          <span data-testid={`${testid}-counting`} title="Counting ball" style={{ color: "#276e34", fontWeight: 900 }}>
            ←
          </span>
        )}
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
