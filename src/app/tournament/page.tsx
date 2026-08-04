"use client";

// Public TOURNAMENT HOME (mock v4 "Tournament Home"). Unified cup hero (eyebrow
// + title + standardized PointsBar + "View Full Scoreboard →"), the device's
// "your match" CTA, then the schedule: per-day collapsible sections whose
// pairings render the shared TournamentMatchCard (identical to the homepage
// card + Scoreboard row via matchStatus()).
//
// SSOT: the bar is deriveCupBar over loadDashboard (same loader the Scoreboard
// uses); nothing here recomputes a cup point or a match status.

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { todayLocal, formatDisplayDate } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { getActiveTournament, getTournamentPlayers } from "@/lib/tournament/queries";
import { loadDashboard, type DashboardData, type DashboardDay } from "@/lib/tournament/loadDashboard";
import { findNearestMatchForPlayer, tournamentPlayersFromDays } from "@/lib/tournament/findPlayerMatch";
import { deriveCupBar } from "@/lib/tournament/cup";
import { matchStatus } from "@/lib/tournament/matchStatus";
import { CupHero } from "@/components/tournament/CupHero";
import { TournamentMatchCard } from "@/components/tournament/TournamentMatchCard";
import { TOURNAMENT_TOKENS as T, SIDE_TOKENS, FOCUS_CLASS, DAY_TAG_STYLE } from "@/lib/tournament/tokens";
import { getStoredPlayerId, getStoredPlayerName, setStoredPlayerId, clearStoredPlayerId } from "@/lib/deviceMemory";
import { FORMAT_LABEL } from "@/lib/tournament/formatLabels";
import { dayTag } from "@/lib/tournament/completion";
import type { Tournament } from "@/lib/tournament/types";

type LandingState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; tournament: Tournament; data: DashboardData };

async function loadLanding(): Promise<LandingState> {
  const tournament = await getActiveTournament();
  // Player-facing gate: only a Live (published) tournament is shown.
  if (!tournament || !tournament.is_published) return { kind: "empty" };
  const data = await loadDashboard(tournament.id, tournament);
  return { kind: "ready", tournament, data };
}

function currentDayNumber(days: DashboardDay[], today: string): number {
  const todays = days.find((d) => d.session.played_on === today);
  if (todays) return todays.session.day_number;
  const past = days.filter((d) => (d.session.played_on ?? "") !== "" && (d.session.played_on ?? "") <= today);
  if (past.length) return Math.max(...past.map((d) => d.session.day_number));
  return days[0]?.session.day_number ?? 1;
}

export default function TournamentLandingPage() {
  const [state, setState] = useState<LandingState>({ kind: "loading" });
  const [storedId, setStoredId] = useState<number | null>(null);
  const [storedName, setStoredName] = useState<string | null>(null);

  const doLoad = useCallback(async () => {
    setStoredId(getStoredPlayerId());
    setStoredName(getStoredPlayerName());
    setState(await loadLanding());
  }, []);

  useEffect(() => { void doLoad(); }, [doLoad]);

  const pickPlayer = useCallback((id: number, name?: string) => {
    setStoredPlayerId(id, name ?? null);
    setStoredId(id);
    setStoredName(name ?? null);
  }, []);
  const switchPlayer = useCallback(() => {
    clearStoredPlayerId();
    setStoredId(null);
    setStoredName(null);
  }, []);

  if (state.kind === "loading") {
    return <Shell><p style={{ color: T.muted }}>Loading…</p></Shell>;
  }
  if (state.kind === "empty") {
    return (
      <Shell>
        <div data-testid="tournament-empty" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "24px 20px", textAlign: "center", color: "#374151" }}>
          <div style={{ fontSize: "1.6rem", marginBottom: 8 }}>🏆</div>
          No tournament is live right now. Check back when the next one starts.
        </div>
      </Shell>
    );
  }

  const { tournament, data } = state;
  const today = todayLocal();
  const bar = deriveCupBar(data, tournament);
  const dayNo = currentDayNumber(data.days, today);
  // Today's day opens by default (mock); other days collapse. But if NO day is
  // today (a future- or all-past-dated tournament), open every day so pairings
  // are never hidden behind a collapsed header.
  const anyToday = data.days.some((d) => d.session.played_on === today);

  return (
    <Shell>
      <CupHero
        eyebrow={`🏁 Tournament Home · Day ${dayNo} of ${data.days.length}`}
        title={tournament.name}
        bar={bar}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11, paddingTop: 11, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
          <Link href="/tournament/dashboard" data-testid="to-dashboard" className={FOCUS_CLASS} style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.16)", borderRadius: 8, padding: "9px 13px", textDecoration: "none" }}>
            View Full Scoreboard →
          </Link>
        </div>
      </CupHero>

      <DeviceMemoryPanel days={data.days} today={today} tournamentId={tournament.id} storedId={storedId} storedName={storedName} onPick={pickPlayer} onSwitch={switchPlayer} />

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, margin: "20px 4px 9px" }}>Schedule &amp; pairings</div>
      {data.days.map((day) => (
        <DaySection key={day.session.id} day={day} isToday={day.session.played_on === today} defaultOpen={day.session.played_on === today || !anyToday} />
      ))}
    </Shell>
  );
}

// "Who are you?" (first visit) → "Your match" CTA (mock `.yourmatch`) + switch.
function DeviceMemoryPanel({
  days,
  today,
  tournamentId,
  storedId,
  storedName,
  onPick,
  onSwitch,
}: {
  days: DashboardDay[];
  today: string;
  tournamentId: number;
  storedId: number | null;
  storedName: string | null;
  onPick: (playerId: number, name?: string) => void;
  onSwitch: () => void;
}) {
  const roster = tournamentPlayersFromDays(days.map((d) => d.matches));

  const [fullRoster, setFullRoster] = useState<Array<{ playerId: number; displayName: string }> | null>(null);
  const [participantIds, setParticipantIds] = useState<Set<number>>(new Set());
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [notInMsg, setNotInMsg] = useState<string | null>(null);

  const openFullRoster = useCallback(async () => {
    setLoadingRoster(true);
    try {
      const [{ data }, participants] = await Promise.all([
        supabase.from("players").select("id, full_name, display_name, is_active").eq("is_active", true).order("full_name"),
        getTournamentPlayers(tournamentId),
      ]);
      setParticipantIds(new Set(participants.map((tp) => tp.player_id)));
      setFullRoster(
        (data ?? []).map((p: { id: number; full_name: string; display_name: string | null }) => ({
          playerId: p.id,
          displayName: p.display_name || p.full_name,
        })),
      );
    } catch {
      setFullRoster([]);
    } finally {
      setLoadingRoster(false);
    }
  }, [tournamentId]);

  const pickFromFullRoster = useCallback(
    (p: { playerId: number; displayName: string }) => {
      if (participantIds.has(p.playerId)) onPick(p.playerId, p.displayName);
      else setNotInMsg("You’re not in this tournament yet — ask the admin to add you.");
    },
    [participantIds, onPick],
  );

  if (roster.length === 0) return null;

  const cardStyle: React.CSSProperties = { background: "#eef5fc", border: `1px solid ${SIDE_TOKENS.a.base}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 };
  const nameBtn: React.CSSProperties = { minHeight: 40, padding: "0 14px", borderRadius: 8, border: `1px solid ${T.line}`, background: "white", color: T.usaInk, fontWeight: 600, cursor: "pointer" };

  if (storedId == null) {
    return (
      <div data-testid="who-are-you" style={cardStyle}>
        <div style={{ fontWeight: 800, color: T.usaInk, marginBottom: 8 }}>Who are you?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {roster.map((p) => (
            <button key={p.playerId} data-testid={`whoami-${p.playerId}`} onClick={() => onPick(p.playerId, p.displayName)} className={FOCUS_CLASS} style={nameBtn}>{p.displayName}</button>
          ))}
        </div>

        {fullRoster == null ? (
          <button data-testid="see-all-players" onClick={openFullRoster} disabled={loadingRoster} className={FOCUS_CLASS} style={{ marginTop: 10, background: "transparent", border: "none", color: "#1a5a8c", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}>
            {loadingRoster ? "Loading…" : "Don’t see your name? See all players"}
          </button>
        ) : (
          <div data-testid="all-players" style={{ marginTop: 10 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: T.muted, textTransform: "uppercase", marginBottom: 6 }}>All players</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {fullRoster.map((p) => (
                <button key={p.playerId} data-testid={`allplayers-${p.playerId}`} onClick={() => pickFromFullRoster(p)} className={FOCUS_CLASS} style={nameBtn}>{p.displayName}</button>
              ))}
            </div>
          </div>
        )}
        {notInMsg && (
          <div data-testid="not-in-tournament" style={{ marginTop: 10, fontSize: "0.82rem", color: "#92400e", background: "#fef3c7", border: "1px solid #92400e", borderRadius: 8, padding: "8px 10px" }}>{notInMsg}</div>
        )}
      </div>
    );
  }

  // Prefer the name the user tapped (device memory), then the match-roster
  // lookup; only if BOTH are absent do we drop the name entirely — never "you".
  const resolvedName = storedName ?? roster.find((p) => p.playerId === storedId)?.displayName ?? null;
  const nearest = findNearestMatchForPlayer(days, storedId, today);

  return (
    <div data-testid="device-identity" style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: T.usaInk }}>{resolvedName ? `You’re ${resolvedName}` : "You’re all set"}</span>
        <button data-testid="switch-player" onClick={onSwitch} className={FOCUS_CLASS} style={{ background: "transparent", border: "none", color: "#1a5a8c", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}>Not you? Switch player</button>
      </div>
      {nearest ? (
        <Link
          href={`/tournament/match/${nearest.match.match.id}`}
          data-testid="go-to-your-match"
          className={FOCUS_CLASS}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: T.chromeB, color: "#fff", borderRadius: 12, padding: "12px 14px", gap: 10, textDecoration: "none" }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>
            <span>
              <span style={{ color: SIDE_TOKENS.a.dark, fontWeight: 600 }}>{nearest.match.sideA.players.map((p) => p.displayName).join(" / ") || nearest.match.sideA.displayName}</span>
              <span style={{ opacity: 0.7, margin: "0 6px" }}>v</span>
              <span style={{ color: SIDE_TOKENS.b.dark, fontWeight: 600 }}>{nearest.match.sideB.players.map((p) => p.displayName).join(" / ") || nearest.match.sideB.displayName}</span>
            </span>
            <span style={{ display: "block", opacity: 0.72, fontSize: 11, marginTop: 2 }}>
              Your Day {nearest.day.session.day_number} match · {matchStatus(nearest.match).text}
              {matchStatus(nearest.match).decided ? "" : ` ${matchStatus(nearest.match).thruText}`} — tap to score
            </span>
          </span>
          <span aria-hidden style={{ fontSize: 18, flexShrink: 0 }}>→</span>
        </Link>
      ) : (
        <div data-testid="no-match" style={{ fontSize: "0.82rem", color: T.muted }}>You’re in the tournament but not matched — check the days below.</div>
      )}
    </div>
  );
}

function DaySection({ day, isToday, defaultOpen }: { day: DashboardDay; isToday: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { session, matches, error } = day;

  return (
    <div data-testid={`day-${session.id}`} style={{ border: `1px solid ${T.line}`, borderRadius: 13, marginBottom: 10, overflow: "hidden", background: T.card }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={FOCUS_CLASS}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", cursor: "pointer", textAlign: "left", border: 0, background: "transparent" }}
      >
        <span>
          <span style={{ display: "block", fontWeight: 800, fontSize: 14, color: T.ink }}>{session.name} — {FORMAT_LABEL[session.format]}</span>
          <span style={{ display: "block", fontSize: 11, color: T.muted, marginTop: 1 }}>{formatDisplayDate(session.played_on ?? "")} · {matches.length} match{matches.length === 1 ? "" : "es"}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {(() => {
            const tag = dayTag(matches, isToday);
            const ts = DAY_TAG_STYLE[tag];
            return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", borderRadius: 6, padding: "3px 8px", background: ts.bg, color: ts.color }}>{tag}</span>;
          })()}
          <span aria-hidden style={{ color: T.muted, fontSize: 15, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</span>
        </span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${T.line}`, padding: "10px 10px 4px", background: T.soft }}>
          {error ? (
            <div style={{ fontSize: 12, color: "#92400e", padding: "2px 4px 8px" }}>Couldn’t load this day’s pairings — ask the admin.</div>
          ) : matches.length === 0 ? (
            <div style={{ fontSize: 12, color: T.muted, padding: "2px 4px 8px" }}>Pairings not set yet.</div>
          ) : (
            matches.map((m) => <TournamentMatchCard key={m.match.id} m={m} />)
          )}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, paddingBottom: 96, fontFamily: "Inter, -apple-system, system-ui, sans-serif", background: T.bg, minHeight: "100vh" }}>
      {children}
    </main>
  );
}
