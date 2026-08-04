"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DangerModal from "../components/DangerModal";
import PairingsPanel from "../components/PairingsPanel";
import MatchOverridePanel from "../components/MatchOverridePanel";
import type { Player } from "../page";
import { formatDisplayDate, todayLocal } from "@/lib/date";
import { getTeamColor } from "@/lib/teamColors";
import {
  getActiveTournament,
  getPointAdjustments,
  getSessionRoundStatus,
  getTournamentWithSessions,
} from "@/lib/tournament/queries";
import {
  addPointAdjustment,
  createSession,
  createStandardDays,
  createTournament,
  deletePointAdjustment,
  deleteSession,
  deleteTournament,
  editSession,
  endTournament,
  type FailedStandardDay,
  LeagueRoundOwnsDateError,
  setPlayerSide,
  setTournamentPublished,
  TournamentDayDateTakenError,
  updateTournament,
} from "@/lib/tournament/mutations";
import { loadSessionMatches } from "@/lib/tournament/loadMatch";
import { FORMAT_LABEL } from "@/lib/tournament/formatLabels";
import { formatPoints } from "@/lib/tournament/matchScorecard";
import Toggle from "@/components/admin/Toggle";
import type {
  LoadedMatch,
  SessionFormat,
  SessionRoundStatus,
  Side,
  Tournament as TournamentRow,
  TournamentPlayerJoined,
  TournamentPointAdjustment,
  TournamentSession,
} from "@/lib/tournament/types";

// §3 — a compact per-day pairings summary, built from loadSessionMatches (no new
// query path, no recomputation). One entry per day; `error` is set when that
// day's loader threw (mixed tees / missing holes) so ONE bad day can't blank the
// whole tab.
interface DayGroupSummary {
  groupNumber: number | null;
  lines: Array<{ a: string; b: string }>; // one line per match (singles = 2)
  incomplete: boolean;
}
interface DaySummary {
  groups: DayGroupSummary[];
  players: number;
  error: boolean;
}

function summarizeDay(matches: LoadedMatch[]): DaySummary {
  const byGroup = new Map<string, LoadedMatch[]>();
  const order: string[] = [];
  const playerIds = new Set<number>();
  for (const m of matches) {
    const key = String(m.match.group_number ?? `m${m.match.id}`);
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(m);
    for (const p of m.sideA.players) playerIds.add(p.playerId);
    for (const p of m.sideB.players) playerIds.add(p.playerId);
  }
  const groups = order.map((k) => {
    const ms = byGroup.get(k)!;
    return {
      groupNumber: ms[0].match.group_number,
      lines: ms.map((m) => ({
        a: m.sideA.players.map((p) => p.displayName).join(" / ") || "—",
        b: m.sideB.players.map((p) => p.displayName).join(" / ") || "—",
      })),
      incomplete: ms.some((m) => m.isIncomplete),
    };
  });
  return { groups, players: playerIds.size, error: false };
}

const C = {
  navy: "#0c3057",
  midNavy: "#0f4a7a",
  green: "#2a7a3a",
  red: "#a32d2d",
  amber: "#92400e",
  amberBg: "#fef3c7",
  bg: "#f5f4f0",
  border: "rgba(0,0,0,0.08)",
  muted: "#6b7280",
};
const FONT = "system-ui, sans-serif";

const FORMAT_OPTIONS: SessionFormat[] = ["greensomes", "four_ball_match", "singles_match"];

// Side A = blue, Side B = red (from the shared team palette).
const SIDE_COLOR: Record<Side, { border: string; bg: string; text: string }> = {
  a: { border: getTeamColor(4).border, bg: getTeamColor(4).pillBg, text: getTeamColor(4).pillText },
  b: { border: getTeamColor(6).border, bg: getTeamColor(6).pillBg, text: getTeamColor(6).pillText },
};

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  padding: 16,
  marginBottom: 16,
};
const sectionHeader: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "#9ca3af",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: 10,
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 8,
  border: "none",
  background: C.green,
  color: "white",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT,
  minHeight: 44,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: `1.5px solid ${C.border}`,
  fontSize: "0.95rem",
  fontFamily: FONT,
  minHeight: 44,
  boxSizing: "border-box",
};
const previewLinkStyle: React.CSSProperties = {
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 14px",
  borderRadius: 8,
  border: `1.5px solid ${C.border}`,
  background: "white",
  color: C.navy,
  fontWeight: 600,
  fontSize: "0.82rem",
  textDecoration: "none",
  fontFamily: FONT,
};

interface Props {
  allPlayers: Player[]; // active roster (from the admin shell)
  onRefresh?: () => void;
}

type SideRow = { id: number; name: string; hi: number | null; isActive: boolean };

function joinedPlayer(tp: TournamentPlayerJoined) {
  return Array.isArray(tp.players) ? tp.players[0] : tp.players;
}

export default function Tournament({ allPlayers }: Props) {
  const [loading, setLoading] = useState(true);
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [assigned, setAssigned] = useState<TournamentPlayerJoined[]>([]);
  const [sessions, setSessions] = useState<TournamentSession[]>([]);
  // Single source of truth for a player's current side (optimistic).
  const [sideMap, setSideMap] = useState<Record<number, Side | undefined>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [addDayOpen, setAddDayOpen] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<TournamentSession | null>(null);
  const [pairingTarget, setPairingTarget] = useState<TournamentSession | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { session: TournamentSession; status: SessionRoundStatus } | null
  >(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  // Phase 4 — per-day override panel target + tournament-level point adjustments.
  const [overrideTarget, setOverrideTarget] = useState<TournamentSession | null>(null);
  const [adjustments, setAdjustments] = useState<TournamentPointAdjustment[]>([]);
  // Phase 4 Commit C — self-serve teardown (type-to-confirm).
  const [teardownOpen, setTeardownOpen] = useState(false);
  const [teardownTyped, setTeardownTyped] = useState("");
  // §1 — a mutation that fails must never leave the screen unchanged. Any action
  // handler that throws sets this; it renders as a dismissible red banner.
  const [actionError, setActionError] = useState<string | null>(null);
  // §3 — days that couldn't be auto-created because a league round owns the date.
  const [dayCollisions, setDayCollisions] = useState<FailedStandardDay[]>([]);
  // §3 — per-day pairings summaries, keyed by session id.
  const [pairingsBySession, setPairingsBySession] = useState<Record<number, DaySummary>>({});
  // Migration 040 — created/voided match counts across all days, for the
  // "Planned: N · Created: M" divergence readout in the header.
  const [matchCounts, setMatchCounts] = useState<{ created: number; voided: number }>({ created: 0, voided: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const active = await getActiveTournament();
    if (!active) {
      setTournament(null);
      setAssigned([]);
      setSessions([]);
      setSideMap({});
      setLoading(false);
      return;
    }
    const full = await getTournamentWithSessions(active.id);
    setTournament(full?.tournament ?? active);
    setAssigned(full?.players ?? []);
    const sesss = full?.sessions ?? [];
    setSessions(sesss);
    const sm: Record<number, Side | undefined> = {};
    for (const tp of full?.players ?? []) sm[tp.player_id] = tp.side;
    setSideMap(sm);
    setAdjustments(await getPointAdjustments(active.id));
    setLoading(false);

    // §3 — pairings summaries per day, batched + isolated per day (allSettled) so
    // one misconfigured day can't reject the batch and blank the whole tab.
    const results = await Promise.allSettled(
      sesss.map((s) => (s.round_id != null ? loadSessionMatches(s.id) : Promise.resolve([] as LoadedMatch[]))),
    );
    const pmap: Record<number, DaySummary> = {};
    let created = 0;
    let voided = 0;
    sesss.forEach((s, i) => {
      const r = results[i];
      pmap[s.id] = r.status === "fulfilled" ? summarizeDay(r.value) : { groups: [], players: 0, error: true };
      if (r.status === "fulfilled") {
        created += r.value.length;
        voided += r.value.filter((m) => m.match.is_voided).length;
      }
    });
    setPairingsBySession(pmap);
    setMatchCounts({ created, voided });
  }, []);

  // Test/Live flip — optimistic-then-persist, reconcile via load() on failure
  // (same pattern as `assign`). One tap, reversible, admin-only → no modal.
  const togglePublished = useCallback(async () => {
    setActionError(null);
    const cur = tournament;
    if (!cur) return;
    const next = !cur.is_published;
    setTournament((prev) => (prev ? { ...prev, is_published: next } : prev));
    try {
      await setTournamentPublished(cur.id, next);
    } catch (e) {
      await load();
      setActionError(e instanceof Error ? e.message : "Couldn't update publish state.");
    }
  }, [tournament, load]);

  // Cup holder — who currently holds the cup (drives the frontend "retain" line).
  // Optimistic-then-persist, reconcile via load() on failure (same pattern as
  // togglePublished). `null` = no holder. Admin-only, reversible → no modal.
  const setHolder = useCallback(
    async (next: Side | null) => {
      setActionError(null);
      const cur = tournament;
      if (!cur) return;
      if (cur.holder_side === next) return;
      setTournament((prev) => (prev ? { ...prev, holder_side: next } : prev));
      try {
        await updateTournament(cur.id, { holder_side: next });
      } catch (e) {
        await load();
        setActionError(e instanceof Error ? e.message : "Couldn't update the cup holder.");
      }
    },
    [tournament, load],
  );

  // Planned match total (migration 040) — the declared tournament size that
  // drives the cup thresholds. Optimistic-then-persist, reconcile on failure
  // (same pattern as setHolder). Blank → null (undeclared). `raw` is the field's
  // current text; validation mirrors the DB CHECK.
  const savePlannedTotal = useCallback(
    async (raw: string) => {
      setActionError(null);
      const cur = tournament;
      if (!cur) return;
      const parsed = parsePlannedTotal(raw);
      if (parsed === "invalid") {
        setActionError("Planned match total must be a whole number between 2 and 50 (or blank).");
        return;
      }
      if ((cur.planned_match_total ?? null) === parsed) return;
      setTournament((prev) => (prev ? { ...prev, planned_match_total: parsed } : prev));
      try {
        await updateTournament(cur.id, { planned_match_total: parsed });
      } catch (e) {
        await load();
        setActionError(e instanceof Error ? e.message : "Couldn't update the planned match total.");
      }
    },
    [tournament, load],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Side list = active roster ∪ assigned-but-now-inactive players (TD2). Active
  // players come from the shell; a player assigned then deactivated is rendered
  // from the embedded join so they never silently drop off a side.
  const rows: SideRow[] = useMemo(() => {
    const byId = new Map<number, SideRow>();
    for (const p of allPlayers) {
      byId.set(p.id, { id: p.id, name: p.display_name || p.full_name, hi: p.handicap_index, isActive: true });
    }
    for (const tp of assigned) {
      if (byId.has(tp.player_id)) continue;
      const rec = joinedPlayer(tp);
      if (!rec) continue;
      byId.set(tp.player_id, {
        id: tp.player_id,
        name: rec.display_name || rec.full_name,
        hi: rec.handicap_index,
        isActive: rec.is_active,
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allPlayers, assigned]);

  const countA = rows.filter((r) => sideMap[r.id] === "a").length;
  const countB = rows.filter((r) => sideMap[r.id] === "b").length;
  const countU = rows.length - countA - countB;

  // Per-player write serialization — the locked write-queue pattern (see
  // RoundSetup.tsx). A rapid assign→unassign on the SAME player used to reorder
  // (its DELETE landing after its UPSERT); and an error-triggered full reload
  // clobbered OTHER players' not-yet-saved optimistic sides, so the banner cried
  // wolf on writes that actually persisted (bug 2). Same-player writes now
  // serialize; cross-player writes still run in parallel.
  const sideWriteQueueRef = useRef<Map<number, Promise<unknown>>>(new Map());
  const enqueueSideWrite = useCallback(
    (playerId: number, fn: () => PromiseLike<unknown>): Promise<unknown> => {
      const prev = sideWriteQueueRef.current.get(playerId) ?? Promise.resolve();
      const next = prev.then(() => fn());
      // Store an error-swallowing tail so a failed write can't wedge the chain;
      // the real error still rejects `next` for the caller's catch.
      sideWriteQueueRef.current.set(playerId, next.catch(() => {}));
      return next;
    },
    [],
  );
  const drainSideWrites = useCallback(async () => {
    await Promise.all(Array.from(sideWriteQueueRef.current.values()));
  }, []);

  const assign = async (playerId: number, side: Side | null) => {
    if (!tournament) return;
    setActionError(null);
    setSideMap((prev) => ({ ...prev, [playerId]: side ?? undefined }));
    try {
      await enqueueSideWrite(playerId, () => setPlayerSide(tournament.id, playerId, side));
    } catch {
      // Let every in-flight write finish first, THEN reconcile from server truth —
      // so the reload reflects what actually persisted instead of overwriting
      // other players' still-in-flight optimistic assignments.
      await drainSideWrites();
      setActionError("Couldn't save that side assignment. Please try again.");
      await load();
    }
  };

  const openDelete = async (session: TournamentSession) => {
    const status = await getSessionRoundStatus(session.round_id);
    if (status.hasScores) {
      setBlockedNotice(
        `${session.name} has scores entered and can't be deleted. Remove the scores first.`,
      );
      return;
    }
    setDeleteTarget({ session, status });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteSession(target.session.id);
    } catch {
      setActionError(`Couldn't remove ${target.session.name}. Please try again.`);
    } finally {
      await load();
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: "0.88rem" }}>Loading…</div>;
  }

  const wrap: React.CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "24px 16px", fontFamily: FONT };

  // ── No active tournament ──────────────────────────────────────────────────
  if (!tournament) {
    return (
      <div style={wrap}>
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: C.navy, marginBottom: 8 }}>
            No tournament yet
          </div>
          <div style={{ color: C.muted, fontSize: "0.9rem", marginBottom: 20 }}>
            Create a Ryder Cup tournament to assign sides and schedule days.
          </div>
          <button style={primaryBtn} onClick={() => setCreateOpen(true)}>
            + Create Tournament
          </button>
        </div>
        {createOpen && (
          <CreateTournamentModal
            onCancel={() => setCreateOpen(false)}
            onCreated={async (failedDates) => {
              setCreateOpen(false);
              setDayCollisions(failedDates);
              await load();
            }}
          />
        )}
      </div>
    );
  }

  const nextDay = sessions.reduce((m, s) => Math.max(m, s.day_number), 0) + 1;

  // ── Active tournament ─────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      {/* §1 — mutation failure banner (dismissible). */}
      {actionError && (
        <div
          role="alert"
          style={{
            background: "#fdecec",
            border: `1px solid ${C.red}`,
            color: C.red,
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 12,
            fontSize: "0.85rem",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", color: C.red, fontWeight: 700, cursor: "pointer", fontSize: "1rem" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* §3 — days that couldn't be auto-created (league round owns the date). */}
      {dayCollisions.length > 0 && (
        <div
          role="alert"
          style={{
            background: C.amberBg,
            border: `1px solid ${C.amber}`,
            color: C.amber,
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 12,
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>Some days couldn&apos;t be scheduled</span>
            <button
              onClick={() => setDayCollisions([])}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", color: C.amber, fontWeight: 700, cursor: "pointer", fontSize: "1rem" }}
            >
              ✕
            </button>
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontWeight: 500 }}>
            {dayCollisions.map((d) => (
              <li key={d.date} style={{ marginTop: 2 }}>
                {d.name} ({FORMAT_LABEL[d.format]}) couldn&apos;t be created — a league round already owns{" "}
                {formatDisplayDate(d.date)}. Use Add Day to place it on another date.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A. Header */}
      <div style={cardStyle}>
        <div style={{ fontSize: "1.15rem", fontWeight: 700, color: C.navy }}>{tournament.name}</div>
        <div style={{ color: C.muted, fontSize: "0.85rem", marginTop: 4 }}>
          {tournament.side_a_name} vs {tournament.side_b_name} · started {formatDisplayDate(tournament.started_on)}
        </div>
        {/* Test / Live — flips is_published (default Test). Where Dad lands after
            building teams, so going live is one obvious flip. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <Toggle
            value={!!tournament.is_published}
            onChange={togglePublished}
            ariaLabel="Show tournament to players"
          />
          <span
            data-testid="publish-label"
            style={{ fontSize: "0.85rem", fontWeight: 600, color: tournament.is_published ? C.green : C.muted }}
          >
            {tournament.is_published ? "Live — shown on the homepage" : "Test — not shown to players"}
          </span>
        </div>
        {/* Cup holder — sets tournaments.holder_side (a / b / none). The frontend
            "retain" line reads this; the control only writes it. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, marginBottom: 6 }}>
            Cup holder
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <SideButton
              label={tournament.side_a_name}
              active={tournament.holder_side === "a"}
              sideKey="a"
              ariaLabel="Cup holder side A"
              onClick={() => setHolder("a")}
            />
            <SideButton
              label={tournament.side_b_name}
              active={tournament.holder_side === "b"}
              sideKey="b"
              ariaLabel="Cup holder side B"
              onClick={() => setHolder("b")}
            />
            <button
              onClick={() => setHolder(null)}
              aria-label="Cup holder none"
              style={{
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 8,
                border: `1.5px solid ${tournament.holder_side === null ? C.navy : C.border}`,
                background: tournament.holder_side === null ? "#eef2f7" : "white",
                color: tournament.holder_side === null ? C.navy : C.muted,
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              None
            </button>
          </div>
        </div>
        {/* Planned match total (migration 040) — the DECLARED size that drives the
            cup thresholds, shown next to the live Created count so any divergence
            is visible. Editable anytime. */}
        <PlannedTotalControl
          value={tournament.planned_match_total ?? null}
          created={Math.max(0, matchCounts.created - matchCounts.voided)}
          voided={matchCounts.voided}
          onSave={savePlannedTotal}
        />
        {/* Admin preview doorway (migration 040) — reach the player-facing
            tournament surfaces regardless of publish state. Gated by admin auth
            (this whole /admin tree is middleware-gated); players can't get here. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, marginBottom: 6 }}>
            Preview as player
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="/tournament" data-testid="preview-tournament-home" style={previewLinkStyle}>
              Tournament Home →
            </a>
            <a href="/tournament/dashboard" data-testid="preview-scoreboard" style={previewLinkStyle}>
              Scoreboard →
            </a>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          {/* Non-destructive archive (sets ended_on + is_active=false; deletes
              nothing). Neutral styling — NOT red/danger — so it doesn't read as a
              second delete. The only destructive path is the typed-confirm
              teardown in the Danger zone below. */}
          <button
            style={{ ...primaryBtn, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }}
            onClick={() => setEndOpen(true)}
          >
            End &amp; Archive Tournament
          </button>
        </div>
      </div>

      {/* B. Sides */}
      <div style={cardStyle}>
        <div style={sectionHeader}>Sides</div>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: C.navy, marginBottom: 4 }}>
          {tournament.side_a_name} {countA} · {tournament.side_b_name} {countB} · Unassigned {countU}
        </div>
        {countA !== countB && (
          <div
            style={{
              background: C.amberBg,
              color: C.amber,
              fontSize: "0.8rem",
              fontWeight: 600,
              padding: "6px 10px",
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            Sides are uneven ({countA} vs {countB}). You can still proceed.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const side = sideMap[r.id] ?? null;
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 4px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "0.92rem", fontWeight: 600, color: C.navy }}>{r.name}</span>
                  {!r.isActive && (
                    <span style={{ fontSize: "0.7rem", color: C.muted, marginLeft: 6 }}>(inactive)</span>
                  )}
                  <span style={{ fontSize: "0.78rem", color: C.muted, marginLeft: 8 }}>
                    HI {r.hi != null ? r.hi.toFixed(1) : "—"}
                  </span>
                </div>
                <SideButton label={tournament.side_a_name} active={side === "a"} sideKey="a" onClick={() => assign(r.id, side === "a" ? null : "a")} />
                <SideButton label={tournament.side_b_name} active={side === "b"} sideKey="b" onClick={() => assign(r.id, side === "b" ? null : "b")} />
                <button
                  onClick={() => assign(r.id, null)}
                  aria-label="Unassign"
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    borderRadius: 8,
                    border: `1.5px solid ${side === null ? C.navy : C.border}`,
                    background: side === null ? "#eef2f7" : "white",
                    color: side === null ? C.navy : C.muted,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  —
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* C. Days */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={sectionHeader}>Days</div>
          <button
            style={{ ...primaryBtn, padding: "9px 14px", fontSize: "0.85rem" }}
            onClick={() => {
              setDayError(null);
              setAddDayOpen(true);
            }}
          >
            + Add Day
          </button>
        </div>
        {sessions.length === 0 && (
          <div style={{ color: C.muted, fontSize: "0.88rem", padding: "8px 0" }}>No days scheduled yet.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: C.navy, fontSize: "0.95rem" }}>{s.name}</div>
              <div style={{ color: C.muted, fontSize: "0.82rem", marginTop: 2 }}>
                {FORMAT_LABEL[s.format]} · {s.played_on ? formatDisplayDate(s.played_on) : "no date"}
              </div>
              {s.round_id == null ? (
                <div
                  style={{
                    background: C.amberBg,
                    color: C.amber,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 6,
                    marginTop: 6,
                    display: "inline-block",
                  }}
                >
                  No round — cannot hold scores
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() => setPairingTarget(s)}
                    style={{
                      minHeight: 40,
                      padding: "0 14px",
                      borderRadius: 8,
                      border: `1.5px solid ${C.navy}`,
                      background: "white",
                      color: C.navy,
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Pairings →
                  </button>
                  <button
                    data-testid={`results-${s.id}`}
                    onClick={() => setOverrideTarget(s)}
                    style={{
                      minHeight: 40,
                      padding: "0 14px",
                      borderRadius: 8,
                      border: `1.5px solid ${C.navy}`,
                      background: "white",
                      color: C.navy,
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    Results →
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={() => {
                  setDayError(null);
                  setEditTarget(s);
                }}
                style={{
                  minHeight: 44,
                  minWidth: 64,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1.5px solid ${C.navy}`,
                  background: "white",
                  color: C.navy,
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Edit
              </button>
              <button
                onClick={() => openDelete(s)}
                style={{
                  minHeight: 44,
                  minWidth: 64,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1.5px solid ${C.red}`,
                  background: "white",
                  color: C.red,
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Delete
              </button>
            </div>
            </div>
            {s.round_id != null && (
              <DayPairings
                summary={pairingsBySession[s.id]}
                sideAName={tournament.side_a_name}
                sideBName={tournament.side_b_name}
              />
            )}
          </div>
        ))}
      </div>

      {/* D. Point adjustments (Level-3 override) */}
      <PointAdjustmentsSection
        tournament={tournament}
        adjustments={adjustments}
        onAdd={async (side, points, reason) => {
          setActionError(null);
          try {
            await addPointAdjustment(tournament.id, side, points, reason);
          } catch (e) {
            setActionError(e instanceof Error ? e.message : "Couldn't add the adjustment.");
          }
          await load();
        }}
        onDelete={async (id) => {
          setActionError(null);
          try {
            await deletePointAdjustment(id);
          } catch {
            setActionError("Couldn't remove the adjustment.");
          }
          await load();
        }}
      />

      {/* E. Danger zone — self-serve safe teardown. */}
      <div style={{ ...cardStyle, border: `1px solid ${C.red}` }}>
        <div style={{ ...sectionHeader, color: C.red }}>Danger zone</div>
        <div style={{ fontSize: "0.82rem", color: C.muted, marginBottom: 12 }}>
          Permanently delete this tournament and all its rounds, scores, and pairings. League rounds are not affected.
        </div>
        <button
          data-testid="delete-tournament"
          style={{ ...primaryBtn, background: "white", color: C.red, border: `1.5px solid ${C.red}` }}
          onClick={() => {
            setTeardownTyped("");
            setTeardownOpen(true);
          }}
        >
          Delete tournament…
        </button>
      </div>

      {teardownOpen && (
        <DangerModal
          title="Delete this tournament?"
          description={`This permanently deletes '${tournament.name}' and all its rounds, scores, and pairings. League rounds are not affected. This cannot be undone.`}
          cannotBeUndone={false}
          confirmLabel="Delete tournament"
          confirmDisabled={teardownTyped.trim() !== tournament.name}
          onConfirm={async () => {
            setTeardownOpen(false);
            try {
              await deleteTournament(tournament.id);
            } catch {
              setActionError("Couldn't delete the tournament. Please try again.");
            }
            await load();
          }}
          onCancel={() => setTeardownOpen(false)}
        >
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, marginBottom: 4 }}>
              Type <strong>{tournament.name}</strong> to confirm
            </div>
            <input
              data-testid="teardown-confirm-input"
              value={teardownTyped}
              onChange={(e) => setTeardownTyped(e.target.value)}
              placeholder={tournament.name}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        </DangerModal>
      )}

      {overrideTarget && overrideTarget.round_id != null && (
        <MatchOverridePanel
          session={overrideTarget}
          tournament={tournament}
          onClose={() => {
            setOverrideTarget(null);
            load();
          }}
        />
      )}

      {addDayOpen && (
        <AddDayModal
          nextDay={nextDay}
          errorText={dayError}
          onCancel={() => setAddDayOpen(false)}
          onSave={async (input) => {
            setDayError(null);
            try {
              await createSession({ tournamentId: tournament.id, ...input });
              setAddDayOpen(false);
              await load();
            } catch (err) {
              if (err instanceof LeagueRoundOwnsDateError) {
                setDayError(`A league round already exists on ${formatDisplayDate(input.playedOn)}. Delete it or pick another date.`);
              } else {
                setDayError("Couldn't add the day. Please try again.");
              }
            }
          }}
        />
      )}

      {editTarget && (
        <EditDayModal
          session={editTarget}
          errorText={dayError}
          onCancel={() => {
            setDayError(null);
            setEditTarget(null);
          }}
          onSave={async (input) => {
            setDayError(null);
            try {
              await editSession(editTarget, input);
              setEditTarget(null);
              await load();
            } catch (err) {
              if (err instanceof TournamentDayDateTakenError) {
                setDayError(
                  `Another tournament day is already on ${formatDisplayDate(input.playedOn)}. Pick a different date.`,
                );
              } else if (err instanceof LeagueRoundOwnsDateError) {
                setDayError(
                  `A league round already owns ${formatDisplayDate(input.playedOn)}. Delete it or pick another date.`,
                );
              } else {
                setDayError("Couldn't save the day. Please try again.");
              }
            }
          }}
        />
      )}

      {deleteTarget && (
        <DangerModal
          title={`Remove ${deleteTarget.session.name}?`}
          description={
            deleteTarget.status.hasPairings
              ? `This will remove ${deleteTarget.session.name} and its pairings.`
              : `This will remove ${deleteTarget.session.name}.`
          }
          confirmLabel="Remove day"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {blockedNotice && (
        <InfoModal message={blockedNotice} onClose={() => setBlockedNotice(null)} />
      )}

      {pairingTarget && pairingTarget.round_id != null && (
        <PairingsPanel
          session={pairingTarget}
          tournament={tournament}
          onClose={() => {
            setPairingTarget(null);
            load();
          }}
        />
      )}

      {endOpen && (
        <DangerModal
          title="End & archive this tournament?"
          description={`${tournament.name} will be closed and archived. Its rounds, scores, and pairings are kept — nothing is deleted.`}
          confirmLabel="End & Archive"
          onConfirm={async () => {
            setEndOpen(false);
            try {
              await endTournament(tournament.id);
            } catch {
              setActionError("Couldn't end the tournament. Please try again.");
            }
            await load();
          }}
          onCancel={() => setEndOpen(false)}
        />
      )}
    </div>
  );
}

// §3 — compact pairings summary under a day card. Lines come straight from the
// loader (one line per match, so singles shows both 1-v-1s); amber dot marks an
// incomplete group. `summary` undefined = still loading.
function DayPairings({
  summary,
  sideAName,
  sideBName,
}: {
  summary: DaySummary | undefined;
  sideAName: string;
  sideBName: string;
}) {
  if (!summary) return null;
  if (summary.error) {
    return (
      <div style={{ fontSize: "0.78rem", color: C.amber, background: C.amberBg, borderRadius: 6, padding: "6px 10px" }}>
        Couldn’t load pairings — check this day’s groups.
      </div>
    );
  }
  if (summary.groups.length === 0) {
    return <div style={{ fontSize: "0.78rem", color: C.muted }}>No pairings yet.</div>;
  }
  return (
    <div style={{ fontSize: "0.8rem" }}>
      <div style={{ fontWeight: 600, color: C.navy, marginBottom: 4 }}>
        {summary.groups.length} {summary.groups.length === 1 ? "group" : "groups"} · {summary.players} players
      </div>
      {/* Side column headers (names from tournaments.side_a_name / side_b_name,
          never hardcoded) so each coloured name reads as "which side". */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 3,
          fontSize: "0.68rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        <span style={{ color: SIDE_COLOR.a.text }}>{sideAName}</span>
        <span style={{ color: "#9ca3af" }}>v</span>
        <span style={{ color: SIDE_COLOR.b.text }}>{sideBName}</span>
      </div>
      {/* D10 — each group (foursome) is its own bordered card with a label and
          breathing room, instead of every line running together at 3px gaps.
          Styling only — same names, same side colours, same incomplete marker. */}
      {summary.groups.map((g, gi) => (
        <div
          key={g.groupNumber ?? gi}
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            background: "#fff",
            padding: "8px 10px",
            marginBottom: 8,
          }}
        >
          {g.groupNumber != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: C.muted }}>
              {g.incomplete && (
                <span aria-label="incomplete" style={{ color: C.amber, fontWeight: 700 }}>
                  ●
                </span>
              )}
              Group {g.groupNumber}
            </div>
          )}
          {g.lines.map((ln, li) => (
            <div key={li} style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, lineHeight: 1.6, padding: "2px 0" }}>
              {g.groupNumber == null && g.incomplete && li === 0 && (
                <span aria-label="incomplete" style={{ color: C.amber, fontWeight: 700 }}>
                  ●
                </span>
              )}
              {/* Colour each name by side (same blue/red palette the pairings
                  panel uses) so you can see who's on which side at a glance. */}
              <span style={{ color: SIDE_COLOR.a.text, fontWeight: 600 }}>{ln.a}</span>
              <span style={{ color: "#9ca3af", fontWeight: 700 }}>v</span>
              <span style={{ color: SIDE_COLOR.b.text, fontWeight: 600 }}>{ln.b}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// §4 — Level-3 override: direct country-point adjustments. Lists existing
// adjustments (removable) and an add form. Every value folds into the dashboard's
// banked total via computeTournamentStandings — this surface only reads/writes
// the `tournament_point_adjustments` rows.
function PointAdjustmentsSection({
  tournament,
  adjustments,
  onAdd,
  onDelete,
}: {
  tournament: TournamentRow;
  adjustments: TournamentPointAdjustment[];
  onAdd: (side: Side, points: number, reason: string) => void;
  onDelete: (id: number) => void;
}) {
  const [side, setSide] = useState<Side>("a");
  const [points, setPoints] = useState("0.5");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const sideName = (s: Side) => (s === "a" ? tournament.side_a_name : tournament.side_b_name);
  const pn = Number(points);
  const canAdd = reason.trim() !== "" && Number.isFinite(pn) && pn !== 0 && !saving;

  return (
    <div style={cardStyle} data-testid="point-adjustments">
      <div style={sectionHeader}>Point adjustments</div>
      <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 10 }}>
        Direct country points (e.g. the envelope-rule half). Added to the dashboard’s banked total.
      </div>

      {adjustments.length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: C.muted, marginBottom: 10 }}>No adjustments.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {adjustments.map((a) => (
            <div key={a.id} data-testid={`adjustment-${a.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontWeight: 700, color: SIDE_COLOR[a.side].text, fontSize: "0.85rem", minWidth: 70 }}>{sideName(a.side)}</span>
              <span style={{ fontWeight: 700, color: C.navy, fontSize: "0.85rem" }}>{a.points > 0 ? "+" : ""}{formatPoints(a.points)}</span>
              <span style={{ flex: 1, minWidth: 0, color: C.muted, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.reason}</span>
              <button
                data-testid={`adjustment-delete-${a.id}`}
                onClick={() => onDelete(a.id)}
                aria-label="Remove adjustment"
                style={{ minWidth: 40, minHeight: 40, borderRadius: 8, border: `1.5px solid ${C.red}`, background: "white", color: C.red, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["a", "b"] as Side[]).map((s) => (
          <button
            key={s}
            data-testid={`adj-side-${s}`}
            onClick={() => setSide(s)}
            style={{ flex: 1, minHeight: 42, borderRadius: 8, border: `1.5px solid ${side === s ? SIDE_COLOR[s].border : C.border}`, background: side === s ? SIDE_COLOR[s].bg : "white", color: side === s ? SIDE_COLOR[s].text : C.muted, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: FONT }}
          >
            {sideName(s)}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          data-testid="adj-points"
          type="number"
          step="0.5"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="Points"
          style={{ ...inputStyle, flex: "0 0 90px" }}
        />
        <input
          data-testid="adj-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          data-testid="adj-add"
          disabled={!canAdd}
          onClick={() => {
            setSaving(true);
            onAdd(side, pn, reason.trim());
            setPoints("0.5");
            setReason("");
            setSaving(false);
          }}
          style={{ ...primaryBtn, padding: "0 16px", background: canAdd ? C.green : "#e5e7eb", color: canAdd ? "white" : "#9ca3af", cursor: canAdd ? "pointer" : "default" }}
        >
          Add adj.
        </button>
      </div>
    </div>
  );
}

function SideButton({
  label,
  active,
  sideKey,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  sideKey: Side;
  onClick: () => void;
  // Distinct accessible name when the visible label (a side name) would collide
  // with another control of the same name — e.g. the cup-holder selector's side
  // buttons vs. the per-player side-assignment buttons.
  ariaLabel?: string;
}) {
  const col = SIDE_COLOR[sideKey];
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        minHeight: 44,
        padding: "0 12px",
        borderRadius: 8,
        border: `1.5px solid ${active ? col.border : C.border}`,
        background: active ? col.bg : "white",
        color: active ? col.text : C.muted,
        fontWeight: 700,
        fontSize: "0.8rem",
        cursor: "pointer",
        fontFamily: FONT,
        whiteSpace: "nowrap",
        maxWidth: 110,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </button>
  );
}

function InfoModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ background: "white", borderRadius: 16, padding: "28px 24px", maxWidth: 420, width: "100%" }}>
        <p style={{ margin: "0 0 20px", textAlign: "center", color: "#374151", fontSize: "0.95rem", lineHeight: 1.5 }}>
          {message}
        </p>
        <button style={{ ...primaryBtn, width: "100%", background: C.navy }} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ background: "white", borderRadius: 16, padding: "26px 22px", maxWidth: 440, width: "100%" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "1.1rem", fontWeight: 700, color: C.navy, fontFamily: FONT }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

// Header control for the declared match total (migration 040). Local text state
// so the admin can type freely; commits on blur or Enter via onSave (which
// validates + persists). Shows "Planned: N · Created: M" so a divergence between
// the declared size and the matches actually created is visible at a glance.
function PlannedTotalControl({
  value,
  created,
  voided,
  onSave,
}: {
  value: number | null;
  created: number; // non-voided created matches
  voided: number;
  onSave: (raw: string) => void | Promise<void>;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  // Re-sync when the persisted value changes (optimistic update or reload).
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const plannedLabel = value == null ? "—" : String(value);
  const diverges = value != null && value !== created;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, marginBottom: 6 }}>
        Planned match total
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          data-testid="planned-total-input"
          style={{ ...inputStyle, width: 120, minHeight: 40 }}
          type="number"
          min={2}
          max={50}
          inputMode="numeric"
          placeholder="blank"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void onSave(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSave(text);
          }}
        />
        <span data-testid="planned-created-readout" style={{ fontSize: "0.82rem", fontWeight: 600, color: diverges ? C.amber : C.muted }}>
          Planned: {plannedLabel} · Created: {created}
          {voided > 0 ? ` (${voided} voided)` : ""}
        </span>
      </div>
    </div>
  );
}

// Parse the "Planned match total" field: blank → null (undeclared); a whole
// number 2–50 → that number; anything else → "invalid" (the caller shows an
// error). Mirrors the DB CHECK (migration 040).
function parsePlannedTotal(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 2 || n > 50) return "invalid";
  return n;
}

function CreateTournamentModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (failedDates: FailedStandardDay[]) => void;
}) {
  const year = todayLocal().slice(0, 4);
  const [name, setName] = useState(`${year} GOBS Ryder Cup`);
  const [startedOn, setStartedOn] = useState(todayLocal());
  const [sideAName, setSideAName] = useState("USA");
  const [sideBName, setSideBName] = useState("Canada");
  const [holderSide, setHolderSide] = useState<Side>("b"); // confirmed tie rule → holder defaults to B
  const [plannedTotal, setPlannedTotal] = useState<string>("32"); // declared size; blank = undeclared
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const planned = parsePlannedTotal(plannedTotal);
    if (planned === "invalid") {
      setError("Planned match total must be a whole number between 2 and 50 (or blank).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const t = await createTournament({ name: name.trim(), startedOn, sideAName: sideAName.trim(), sideBName: sideBName.trim(), holderSide, plannedMatchTotal: planned });
      // Auto-create the three standard days (Greensomes / Four-ball / Singles)
      // on consecutive dates. League-round collisions don't abort creation —
      // the survivors are made and the blocked days surface as a banner (§3).
      const { failed } = await createStandardDays(t.id, startedOn);
      onCreated(failed);
    } catch {
      setSaving(false);
      setError("Couldn't create the tournament. A tournament may already be active.");
    }
  };

  const lbl: React.CSSProperties = { fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "12px 0 4px" };

  return (
    <ModalShell title="Create Tournament">
      <div style={lbl}>Name</div>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      <div style={lbl}>Start date</div>
      <input style={inputStyle} type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Side A</div>
          <input style={inputStyle} value={sideAName} onChange={(e) => setSideAName(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Side B</div>
          <input style={inputStyle} value={sideBName} onChange={(e) => setSideBName(e.target.value)} />
        </div>
      </div>
      <div style={lbl}>Who holds the cup?</div>
      <div style={{ display: "flex", gap: 10 }}>
        {(["a", "b"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => setHolderSide(s)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 8,
              border: `1.5px solid ${holderSide === s ? C.navy : C.border}`,
              background: holderSide === s ? "#eef2f7" : "white",
              color: C.navy,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {s === "a" ? sideAName : sideBName}
          </button>
        ))}
      </div>
      <div style={lbl}>Planned match total</div>
      <input
        style={inputStyle}
        type="number"
        min={2}
        max={50}
        inputMode="numeric"
        placeholder="e.g. 32 (leave blank if undecided)"
        value={plannedTotal}
        onChange={(e) => setPlannedTotal(e.target.value)}
      />
      <div style={{ fontSize: "0.72rem", color: C.muted, marginTop: 4 }}>
        The full tournament size — drives “points to win the cup.” Matches are usually created the night before each day; this keeps the scoreboard correct before they exist. Editable anytime.
      </div>
      {error && <div style={{ color: C.red, fontSize: "0.82rem", marginTop: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button style={{ ...primaryBtn, flex: 1 }} disabled={saving || !name.trim()} onClick={save}>
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
    </ModalShell>
  );
}

function AddDayModal({
  nextDay,
  errorText,
  onCancel,
  onSave,
}: {
  nextDay: number; // day_number is derived (max existing + 1) — no user field (§3)
  errorText: string | null;
  onCancel: () => void;
  onSave: (input: { dayNumber: number; name: string; format: SessionFormat; playedOn: string }) => void;
}) {
  const [name, setName] = useState(`Day ${nextDay}`);
  const [format, setFormat] = useState<SessionFormat>("four_ball_match");
  const [playedOn, setPlayedOn] = useState(todayLocal());
  const [saving, setSaving] = useState(false);

  const lbl: React.CSSProperties = { fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "12px 0 4px" };

  return (
    <ModalShell title="Add Day">
      <div style={lbl}>Name</div>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      <div style={lbl}>Format</div>
      <select style={inputStyle} value={format} onChange={(e) => setFormat(e.target.value as SessionFormat)}>
        {FORMAT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
      <div style={lbl}>Date</div>
      <input style={inputStyle} type="date" value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} />
      {errorText && <div style={{ color: C.red, fontSize: "0.82rem", marginTop: 12 }}>{errorText}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          style={{ ...primaryBtn, flex: 1 }}
          disabled={saving || !name.trim()}
          onClick={() => {
            setSaving(true);
            onSave({ dayNumber: nextDay, name: name.trim(), format, playedOn });
            setSaving(false);
          }}
        >
          Add
        </button>
      </div>
    </ModalShell>
  );
}

function EditDayModal({
  session,
  errorText,
  onCancel,
  onSave,
}: {
  session: TournamentSession;
  errorText: string | null;
  onCancel: () => void;
  onSave: (input: { name: string; format: SessionFormat; playedOn: string }) => void;
}) {
  const [name, setName] = useState(session.name);
  const [format, setFormat] = useState<SessionFormat>(session.format);
  const [playedOn, setPlayedOn] = useState(session.played_on ?? todayLocal());
  const [saving, setSaving] = useState(false);

  const lbl: React.CSSProperties = { fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "12px 0 4px" };

  return (
    <ModalShell title="Edit Day">
      <div style={lbl}>Name</div>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      <div style={lbl}>Format</div>
      <select style={inputStyle} value={format} onChange={(e) => setFormat(e.target.value as SessionFormat)}>
        {FORMAT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
      <div style={lbl}>Date</div>
      <input style={inputStyle} type="date" value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} />
      {errorText && <div style={{ color: C.red, fontSize: "0.82rem", marginTop: 12 }}>{errorText}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          style={{ ...primaryBtn, flex: 1 }}
          disabled={saving || !name.trim()}
          onClick={() => {
            setSaving(true);
            onSave({ name: name.trim(), format, playedOn });
            setSaving(false);
          }}
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}
