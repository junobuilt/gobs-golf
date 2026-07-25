"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DangerModal from "../components/DangerModal";
import type { Player } from "../page";
import { formatDisplayDate, todayLocal } from "@/lib/date";
import { getTeamColor } from "@/lib/teamColors";
import {
  getActiveTournament,
  getSessionRoundStatus,
  getTournamentWithSessions,
} from "@/lib/tournament/queries";
import {
  createSession,
  createStandardDays,
  createTournament,
  deleteSession,
  editSession,
  endTournament,
  type FailedStandardDay,
  LeagueRoundOwnsDateError,
  setPlayerSide,
  TournamentDayDateTakenError,
} from "@/lib/tournament/mutations";
import type {
  SessionFormat,
  SessionRoundStatus,
  Side,
  Tournament as TournamentRow,
  TournamentPlayerJoined,
  TournamentSession,
} from "@/lib/tournament/types";

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

const FORMAT_LABEL: Record<SessionFormat, string> = {
  greensomes: "Greensomes",
  four_ball_match: "Four-ball",
  singles_match: "Singles",
};
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
  const [endOpen, setEndOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { session: TournamentSession; status: SessionRoundStatus } | null
  >(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  // §1 — a mutation that fails must never leave the screen unchanged. Any action
  // handler that throws sets this; it renders as a dismissible red banner.
  const [actionError, setActionError] = useState<string | null>(null);
  // §3 — days that couldn't be auto-created because a league round owns the date.
  const [dayCollisions, setDayCollisions] = useState<FailedStandardDay[]>([]);

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
    setSessions(full?.sessions ?? []);
    const sm: Record<number, Side | undefined> = {};
    for (const tp of full?.players ?? []) sm[tp.player_id] = tp.side;
    setSideMap(sm);
    setLoading(false);
  }, []);

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

  const assign = async (playerId: number, side: Side | null) => {
    if (!tournament) return;
    setSideMap((prev) => ({ ...prev, [playerId]: side ?? undefined }));
    try {
      await setPlayerSide(tournament.id, playerId, side);
    } catch {
      setActionError("Couldn't save that side assignment. Please try again.");
      await load(); // reconcile on failure
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
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          <button
            style={{ ...primaryBtn, background: "white", color: C.red, border: `1.5px solid ${C.red}` }}
            onClick={() => setEndOpen(true)}
          >
            End Tournament
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
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
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
                <div style={{ color: "#9ca3af", fontSize: "0.75rem", marginTop: 4 }}>Pairings — coming next</div>
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
        ))}
      </div>

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

      {endOpen && (
        <DangerModal
          title="End this tournament?"
          description={`${tournament.name} will be closed and archived.`}
          confirmLabel="End Tournament"
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

function SideButton({
  label,
  active,
  sideKey,
  onClick,
}: {
  label: string;
  active: boolean;
  sideKey: Side;
  onClick: () => void;
}) {
  const col = SIDE_COLOR[sideKey];
  return (
    <button
      onClick={onClick}
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const t = await createTournament({ name: name.trim(), startedOn, sideAName: sideAName.trim(), sideBName: sideBName.trim(), holderSide });
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
