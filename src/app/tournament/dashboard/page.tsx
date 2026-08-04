"use client";

// Public tournament SCOREBOARD (mock v4 "Scoreboard"). Unified cup hero
// (eyebrow + title + standardized PointsBar + "Tournament Home →") over the
// official day-by-day rows: USA │ center status │ Canada, each side's per-match
// "pts", an inline chevron expanding the colorized HoleStrip (no separate page).
//
// SSOT: every value comes from the canonical loader — the bar from deriveCupBar
// (loadDashboard → computeTournamentStandings), each row's status from
// matchStatus() and its pts from matchSidePoints(). The page computes nothing.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { todayLocal, formatDisplayDate } from "@/lib/date";
import { getActiveTournament } from "@/lib/tournament/queries";
import { loadDashboard, type DashboardData, type DashboardDay } from "@/lib/tournament/loadDashboard";
import { deriveCupBar } from "@/lib/tournament/cup";
import { matchStatus, matchSidePoints, type StatusTone } from "@/lib/tournament/matchStatus";
import { CupHero } from "@/components/tournament/CupHero";
import { HoleStrip } from "@/components/tournament/HoleStrip";
import { TOURNAMENT_TOKENS as T, SIDE_TOKENS, FOCUS_CLASS, DAY_TAG_STYLE } from "@/lib/tournament/tokens";
import { dayTag } from "@/lib/tournament/completion";
import { FORMAT_LABEL } from "@/lib/tournament/formatLabels";
import { isAdminSession } from "../adminPreview";
import type { LoadedMatch, Tournament } from "@/lib/tournament/types";

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; tournament: Tournament; data: DashboardData; preview: boolean };

// `isAdmin` lets an admin PREVIEW an unpublished tournament (migration 040);
// players are never admin, so the publish gate is unchanged for them.
export async function load(isAdmin: boolean): Promise<State> {
  const tournament = await getActiveTournament();
  if (!tournament) return { kind: "empty" };
  const preview = !tournament.is_published;
  if (preview && !isAdmin) return { kind: "empty" };
  const data = await loadDashboard(tournament.id, tournament);
  return { kind: "ready", tournament, data, preview };
}

function currentDayNumber(days: DashboardDay[], today: string): number {
  const todays = days.find((d) => d.session.played_on === today);
  if (todays) return todays.session.day_number;
  const past = days.filter((d) => (d.session.played_on ?? "") !== "" && (d.session.played_on ?? "") <= today);
  if (past.length) return Math.max(...past.map((d) => d.session.day_number));
  return days[0]?.session.day_number ?? 1;
}

export default function TournamentDashboardPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const doLoad = useCallback(async () => {
    const isAdmin = await isAdminSession();
    setState(await load(isAdmin));
  }, []);
  useEffect(() => { void doLoad(); }, [doLoad]);

  if (state.kind === "loading") {
    return <Shell><p style={{ color: T.muted }}>Loading…</p></Shell>;
  }
  if (state.kind === "empty") {
    return (
      <Shell>
        <div data-testid="dashboard-empty" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "24px 20px", textAlign: "center", color: "#374151" }}>
          <div style={{ fontSize: "1.6rem", marginBottom: 8 }}>🏆</div>
          No tournament is live right now. Check back when the next one starts.
        </div>
      </Shell>
    );
  }

  const { tournament, data, preview } = state;
  const today = todayLocal();
  const bar = deriveCupBar(data, tournament);
  const dayNo = currentDayNumber(data.days, today);

  return (
    <Shell>
      {preview && (
        <div
          data-testid="preview-banner"
          style={{ background: "#fef3c7", border: "1px solid #92400e", color: "#92400e", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: "0.82rem", fontWeight: 700 }}
        >
          👁️ Admin preview — this tournament is not published. Players can’t see it yet.
        </div>
      )}
      <CupHero
        eyebrow={`🏆 Scoreboard · Day ${dayNo} of ${data.days.length}`}
        title={tournament.name}
        bar={bar}
        showPointsInPlay
        style={{ marginBottom: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11, paddingTop: 11, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
          <Link href="/tournament" data-testid="to-landing" className={FOCUS_CLASS} style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.16)", borderRadius: 8, padding: "9px 13px", textDecoration: "none" }}>
            Tournament Home →
          </Link>
        </div>
      </CupHero>

      {data.days.map((day) => (
        <DaySection key={day.session.id} day={day} isToday={day.session.played_on === today} />
      ))}
    </Shell>
  );
}

function DaySection({ day, isToday }: { day: DashboardDay; isToday: boolean }) {
  const { session, matches, error } = day;
  return (
    <div data-testid={`dash-day-${session.id}`} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 2px 8px" }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: T.ink }}>
          {session.name} — {FORMAT_LABEL[session.format]}
          {(() => {
            const tag = dayTag(matches, isToday);
            const ts = DAY_TAG_STYLE[tag];
            return <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: ts.color, background: ts.bg, borderRadius: 6, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{tag}</span>;
          })()}
        </span>
        <span style={{ fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {formatDisplayDate(session.played_on ?? "")} · {matches.length} match{matches.length === 1 ? "" : "es"}
        </span>
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "#92400e" }}>Couldn’t load this day’s results — ask the admin.</div>
      ) : matches.length === 0 ? (
        <div style={{ fontSize: 12, color: T.muted }}>No pairings yet.</div>
      ) : (
        matches.map((m) => <ScoreboardRow key={m.match.id} m={m} />)
      )}
    </div>
  );
}

function centerColor(tone: StatusTone): string {
  if (tone === "usa") return T.usa;
  if (tone === "canada") return T.can;
  if (tone === "square") return T.ink;
  return T.muted;
}

function ScoreboardRow({ m }: { m: LoadedMatch }) {
  const [open, setOpen] = useState(false);
  const status = matchStatus(m);
  const pts = matchSidePoints(m);
  const aNames = m.sideA.players.map((p) => p.displayName).join(" / ") || m.sideA.displayName;
  const bNames = m.sideB.players.map((p) => p.displayName).join(" / ") || m.sideB.displayName;

  // Voided (migration 040): a static, greyed row — no points, no leader tint, no
  // hole strip. It stays visible so the scoreboard accounts for every pairing.
  if (m.match.is_voided) {
    return (
      <div data-testid={`dash-match-${m.match.id}`} style={{ border: `1px solid ${T.line}`, borderRadius: 13, marginBottom: 8, overflow: "hidden", background: T.soft, opacity: 0.6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "11px 12px" }}>
          <div style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, color: T.muted, textDecoration: "line-through" }}>{aNames}</div>
          <div data-testid={`dash-status-${m.match.id}`} style={{ textAlign: "center", minWidth: 76, fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", color: T.muted }}>Voided</div>
          <div style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, color: T.muted, textAlign: "right", textDecoration: "line-through" }}>{bNames}</div>
        </div>
      </div>
    );
  }

  // Leader tint (mock `.row.lead-u` / `.lead-c`) — a soft directional wash.
  const rowBg =
    status.tone === "usa"
      ? "linear-gradient(90deg, rgba(20,80,158,0.09), transparent 46%)"
      : status.tone === "canada"
        ? "linear-gradient(270deg, rgba(200,16,46,0.08), transparent 46%)"
        : undefined;

  return (
    <div data-testid={`dash-match-${m.match.id}`} style={{ border: `1px solid ${T.line}`, borderRadius: 13, marginBottom: 8, overflow: "hidden", background: T.card }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={FOCUS_CLASS}
        style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "11px 12px", cursor: "pointer", textAlign: "left", border: 0, background: rowBg ?? "transparent" }}
      >
        {/* USA (left) */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.3, fontWeight: 600, color: SIDE_TOKENS.a.ink }}>{aNames}</div>
          <div style={{ fontWeight: 700, fontSize: 21, lineHeight: 1, marginTop: 3, color: T.usa }}>{pts.a}</div>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>pts</div>
        </div>
        {/* Center status */}
        <div style={{ textAlign: "center", minWidth: 76, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div data-testid={`dash-status-${m.match.id}`} style={{ fontWeight: status.tone === "pre" ? 600 : 700, fontSize: status.tone === "pre" ? 12 : 15, letterSpacing: "0.01em", whiteSpace: "nowrap", color: centerColor(status.tone) }}>{status.text}</div>
          <div style={{ fontSize: 9.5, color: T.muted, letterSpacing: "0.03em", textTransform: "uppercase" }}>{status.thruText}</div>
          <div aria-hidden style={{ color: T.muted, fontSize: 15, marginTop: 1, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</div>
        </div>
        {/* Canada (right) */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.3, fontWeight: 600, color: SIDE_TOKENS.b.ink, textAlign: "right" }}>{bNames}</div>
          <div style={{ fontWeight: 700, fontSize: 21, lineHeight: 1, marginTop: 3, color: T.can }}>{pts.b}</div>
          <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>pts</div>
        </div>
      </button>

      {open && (
        <div data-testid={`dash-holes-${m.match.id}`} style={{ borderTop: `1px solid ${T.line}`, background: T.soft, padding: "11px 10px" }}>
          <HoleStrip outcomes={m.state.holeOutcomes} />
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: 16,
        paddingBottom: 96, // clear the fixed bottom nav (desktop widths)
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        background: T.bg,
        minHeight: "100vh",
      }}
    >
      {children}
    </main>
  );
}
