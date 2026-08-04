"use client";

// Shared tournament match card (mock v4 `.mcard`) — the tappable pairing card
// used on the homepage "Your matches today" list and the Tournament Home
// schedule. Reads matchStatus() for the chip + tone (SSOT with the Scoreboard
// row), so a given match reads identically everywhere. A colored stripe encodes
// the leader; tapping opens the match scorecard.

import React from "react";
import Link from "next/link";
import { TOURNAMENT_TOKENS as T, SIDE_TOKENS, FOCUS_CLASS } from "@/lib/tournament/tokens";
import { matchStatus, type StatusTone } from "@/lib/tournament/matchStatus";
import type { LoadedMatch } from "@/lib/tournament/types";

function stripeColor(tone: StatusTone): string {
  if (tone === "usa") return T.usa;
  if (tone === "canada") return T.can;
  if (tone === "square") return `linear-gradient(${T.usa} 50%, ${T.can} 50%)`;
  return T.line; // pre / not started
}

function statusColor(tone: StatusTone): string {
  if (tone === "usa") return T.usa;
  if (tone === "canada") return T.can;
  if (tone === "square") return T.muted;
  return T.muted;
}

export function TournamentMatchCard({ m }: { m: LoadedMatch }) {
  const status = matchStatus(m);
  const aNames = m.sideA.players.map((p) => p.displayName).join(" / ") || m.sideA.displayName;
  const bNames = m.sideB.players.map((p) => p.displayName).join(" / ") || m.sideB.displayName;

  // Voided (migration 040): the row stays visible for context but reads inactive
  // — neutral stripe, greyed text, a "Voided" chip, no leader tone, not tappable
  // to score.
  const voided = m.match.is_voided;

  const inner = (
    <>
      <div aria-hidden style={{ width: 6, flexShrink: 0, background: voided ? T.line : stripeColor(status.tone) }} />
      <div style={{ flex: 1, padding: "11px 13px", display: "flex", alignItems: "center", gap: 12, opacity: voided ? 0.6 : 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: voided ? T.muted : SIDE_TOKENS.a.ink, textDecoration: voided ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{aNames}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: voided ? T.muted : SIDE_TOKENS.b.ink, textDecoration: voided ? "line-through" : "none", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bNames}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4, minWidth: 66 }}>
          {voided ? (
            <span data-testid={`tmatch-status-${m.match.id}`} style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1, color: T.muted }}>Voided</span>
          ) : (
            <>
              <span data-testid={`tmatch-status-${m.match.id}`} style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.01em", lineHeight: 1, color: statusColor(status.tone) }}>{status.text}</span>
              <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.02em", lineHeight: 1 }}>{status.thruText}</span>
            </>
          )}
        </div>
        {!voided && <span aria-hidden style={{ color: T.muted, fontSize: 17, flexShrink: 0 }}>›</span>}
      </div>
    </>
  );

  const frame: React.CSSProperties = { display: "flex", borderRadius: 13, overflow: "hidden", marginBottom: 9, border: `1px solid ${T.line}`, background: voided ? T.soft : T.card, textDecoration: "none", color: "inherit" };

  // A voided match isn't scorable, so it isn't a link — just a static card.
  if (voided) {
    return (
      <div data-testid={`tmatch-card-${m.match.id}`} style={frame}>
        {inner}
      </div>
    );
  }

  return (
    <Link href={`/tournament/match/${m.match.id}`} data-testid={`tmatch-card-${m.match.id}`} className={FOCUS_CLASS} style={frame}>
      {inner}
    </Link>
  );
}
