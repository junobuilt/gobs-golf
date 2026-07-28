"use client";

import React from "react";
import Link from "next/link";
import type { FinishBanner } from "@/lib/tournament/matchScorecard";

// The green finish banner (§5 + Decision F). Text is built from MatchState-
// derived `banner` — no arithmetic here. `onRequestReopen` is the soft admin
// "reopen" hook: LEFT UNWIRED in Phase 3.1 (the page passes undefined so no
// button renders). Phase 4 wires the admin override to it — do not remove it.
// `resultChanged` (A1): a post-decision edit flipped the winner vs. the
// server-committed result — surface it rather than swap the banner silently.
export default function MatchClosedBanner({
  banner,
  scoredBeyond,
  resultChanged,
  onRequestReopen,
}: {
  banner: FinishBanner;
  scoredBeyond: boolean;
  resultChanged?: boolean;
  onRequestReopen?: () => void;
}) {
  const text =
    banner.kind === "halved"
      ? "Match halved — ½ point each."
      : `Match over — ${banner.sideName} wins ${banner.marginText}.`;
  // A1 — "Result changed" note. Match play decides itself, but a correction to an
  // earlier counted hole can re-decide a completed match; without a note the
  // banner would swap winners silently (and the "extra scores" note vanishes
  // because the closeout hole moves). Derived from the two MatchStates the card
  // already holds — no engine change, no stored history.
  const changedText =
    banner.kind === "halved"
      ? "Result changed after later edits — now halved (½ each)."
      : `Result changed after later edits — now ${banner.sideName} wins ${banner.marginText}.`;
  return (
    <div>
      <div
        data-testid="finish-banner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          background: "#e7f6ec",
          border: "1px solid #276e34",
          color: "#1c5228",
          borderRadius: "10px",
          padding: "14px 16px",
          fontWeight: 800,
          fontSize: "1rem",
        }}
      >
        <span>{text}</span>
        {onRequestReopen ? (
          <button
            onClick={onRequestReopen}
            style={{
              minHeight: "36px",
              padding: "0 12px",
              borderRadius: "8px",
              border: "1px solid #276e34",
              background: "white",
              color: "#276e34",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reopen
          </button>
        ) : (
          // A2 — "you're done, here's where it lives" closure. NOT a submit;
          // match play decides itself. Links to the tournament scoreboard.
          <Link
            href="/tournament/dashboard"
            data-testid="finish-view-scoreboard"
            style={{
              whiteSpace: "nowrap",
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "#1c5228",
              textDecoration: "none",
            }}
          >
            View on scoreboard →
          </Link>
        )}
      </div>
      {resultChanged ? (
        <div
          data-testid="result-changed-note"
          style={{
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#92400e",
            background: "#fef3c7",
            border: "1px solid #b45309",
            borderRadius: "8px",
            padding: "8px 10px",
            marginTop: "6px",
          }}
        >
          {changedText}
        </div>
      ) : (
        scoredBeyond && (
          <div
            data-testid="scored-beyond-note"
            style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "6px" }}
          >
            Extra scores were entered after the match was decided — they don’t change the result.
          </div>
        )
      )}
    </div>
  );
}
