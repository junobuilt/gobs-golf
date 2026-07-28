"use client";

// C7 — read-only 18-hole review of a single match, reached from the dashboard's
// expanded pairing row. Same info as the editable scorecard's "Review 18 holes"
// expander (the exact MatchReviewGrid component), but with NO score entry — so a
// spectator following along on the scoreboard can't accidentally edit a card.
// Reads the canonical LoadedMatch via loadMatch; computes nothing of its own.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  loadMatch,
  MixedTeesInMatchError,
  MatchHolesMissingError,
  MatchNotFoundError,
  MatchLoadError,
} from "@/lib/tournament/loadMatch";
import type { LoadedMatch } from "@/lib/tournament/types";
import { initOptimisticScores } from "@/lib/tournament/matchScorecard";
import MatchReviewGrid from "../MatchReviewGrid";

const FORMAT_LABEL: Record<LoadedMatch["session"]["format"], string> = {
  greensomes: "Alternate Shot",
  four_ball_match: "Best Ball",
  singles_match: "Singles",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; loaded: LoadedMatch }
  | { kind: "setup_error" }
  | { kind: "not_found" }
  | { kind: "offline" }
  | { kind: "error" };

async function loadOne(matchId: number): Promise<LoadState> {
  try {
    const loaded = await loadMatch(matchId);
    return { kind: "ready", loaded };
  } catch (e) {
    if (e instanceof MixedTeesInMatchError || e instanceof MatchHolesMissingError) return { kind: "setup_error" };
    if (e instanceof MatchNotFoundError) return { kind: "not_found" };
    if (e instanceof MatchLoadError) return { kind: "offline" };
    return { kind: "error" };
  }
}

export default function MatchReviewPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = Number(params?.matchId);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    if (!Number.isFinite(matchId)) {
      setState({ kind: "not_found" });
      return;
    }
    loadOne(matchId).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [matchId]);

  return (
    <Shell>
      <Link
        href="/tournament/dashboard"
        data-testid="review-back-scoreboard"
        style={{ display: "inline-block", marginBottom: "12px", fontSize: "0.82rem", fontWeight: 700, color: "#1a5a8c", textDecoration: "none" }}
      >
        ← Back to scoreboard
      </Link>

      {state.kind === "loading" && <FriendlyError>Loading…</FriendlyError>}
      {state.kind === "not_found" && <FriendlyError>That match couldn’t be found.</FriendlyError>}
      {state.kind === "setup_error" && <FriendlyError>This match isn’t set up yet — ask the admin.</FriendlyError>}
      {state.kind === "offline" && <FriendlyError>Couldn’t load this match — check your connection and try again.</FriendlyError>}
      {state.kind === "error" && <FriendlyError>Something went wrong loading this match.</FriendlyError>}

      {state.kind === "ready" && <ReviewBody loaded={state.loaded} />}
    </Shell>
  );
}

function ReviewBody({ loaded }: { loaded: LoadedMatch }) {
  // Read-only: seed the optimistic scores once from the canonical loaded match;
  // MatchReviewGrid reads outcomes from loaded.state (no recompute needed).
  const scores = initOptimisticScores(loaded);
  return (
    <div>
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0c3057" }}>
          {loaded.tournament.sideAName} v {loaded.tournament.sideBName}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
          {loaded.session.name} · {FORMAT_LABEL[loaded.session.format]} · Review only
        </div>
      </div>
      <MatchReviewGrid
        loaded={loaded}
        scores={scores}
        state={loaded.state}
        flaggedHole={loaded.match.flagged_hole ?? null}
      />
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
        paddingBottom: "96px",
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
    <div style={{ background: "white", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "10px", padding: "20px", fontSize: "0.9rem", color: "#374151" }}>
      {children}
    </div>
  );
}
