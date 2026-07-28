"use client";

import React from "react";
import type { FinishBanner } from "@/lib/tournament/matchScorecard";

// The green finish banner (§5 + Decision F). Text is built from MatchState-
// derived `banner` — no arithmetic here. `onRequestReopen` is the soft admin
// "reopen" hook: LEFT UNWIRED in Phase 3.1 (the page passes undefined so no
// button renders). Phase 4 wires the admin override to it — do not remove it.
export default function MatchClosedBanner({
  banner,
  scoredBeyond,
  onRequestReopen,
}: {
  banner: FinishBanner;
  scoredBeyond: boolean;
  onRequestReopen?: () => void;
}) {
  const text =
    banner.kind === "halved"
      ? "Match halved — ½ point each."
      : `Match over — ${banner.sideName} wins ${banner.marginText}.`;
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
        {onRequestReopen && (
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
        )}
      </div>
      {scoredBeyond && (
        <div
          data-testid="scored-beyond-note"
          style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "6px" }}
        >
          Extra scores were entered after the match was decided — they don’t change the result.
        </div>
      )}
    </div>
  );
}
