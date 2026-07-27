"use client";

// Phase 2.2b — the pairings surface for one tournament day. An in-component
// full-screen panel (opened from the day card), NOT a route: the whole /admin
// tree navigates via panel state, so a sub-route would re-mount + re-auth for no
// gain. Every stroke/handicap/status on screen comes from loadSessionMatches /
// loadMatch (single source); the pre-save builder preview uses the SAME
// computeSideStrokes helper the loader uses, so preview and card can't diverge.

import { useCallback, useEffect, useMemo, useState } from "react";
import DangerModal from "./DangerModal";
import PlayerCombobox from "@/components/playedWith/PlayerCombobox";
import { getTeamColor } from "@/lib/teamColors";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { formatDisplayDate } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { computeCourseHandicap } from "@/lib/scoring/handicap";
import { computeSideStrokes } from "@/lib/tournament/matchStrokes";
import { loadMatch, loadSessionMatches } from "@/lib/tournament/loadMatch";
import { createGroup, deleteGroup, updateGroup } from "@/lib/tournament/mutations";
import { getTournamentPlayers } from "@/lib/tournament/queries";
import { loaderMessage, mutationMessage } from "./pairingsCopy";
import type {
  LoadedMatch,
  Side,
  SessionFormat,
  Tournament,
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

const SIDE_COLOR: Record<Side, { border: string; bg: string; text: string }> = {
  a: { border: getTeamColor(4).border, bg: getTeamColor(4).pillBg, text: getTeamColor(4).pillText },
  b: { border: getTeamColor(6).border, bg: getTeamColor(6).pillBg, text: getTeamColor(6).pillText },
};

interface TeeRow {
  id: number;
  color: string;
  slope_rating: number;
  course_rating: number;
  par: number;
}

interface Roster {
  // player_id -> { name, hi, side }
  byId: Map<number, { name: string; hi: number | null; side: Side }>;
}

interface GroupView {
  groupNumber: number | null;
  matches: LoadedMatch[];
  error: string | null; // set when a match in this group failed to load (misconfig)
}

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

// Load the day's groups. Happy path is one batched loadSessionMatches; if a match
// is misconfigured (mixed tees) that call throws, so we fall back to per-match
// loads and mark only the offending group — the page never crashes.
async function loadGroups(sessionId: number): Promise<GroupView[]> {
  const groupOf = (list: Array<{ groupNumber: number | null; match: LoadedMatch | null; error: string | null }>): GroupView[] => {
    const byGroup = new Map<string, GroupView>();
    const order: string[] = [];
    for (const item of list) {
      const key = String(item.groupNumber ?? `m${item.match?.match.id ?? Math.random()}`);
      if (!byGroup.has(key)) {
        byGroup.set(key, { groupNumber: item.groupNumber, matches: [], error: null });
        order.push(key);
      }
      const g = byGroup.get(key)!;
      if (item.match) g.matches.push(item.match);
      if (item.error) g.error = item.error;
    }
    return order.map((k) => byGroup.get(k)!);
  };

  try {
    const all = await loadSessionMatches(sessionId);
    return groupOf(all.map((m) => ({ groupNumber: m.match.group_number, match: m, error: null })));
  } catch {
    const { data } = await supabase
      .from("tournament_matches")
      .select("id, group_number, match_number")
      .eq("session_id", sessionId)
      .order("match_number");
    const rows = (data ?? []) as Array<{ id: number; group_number: number | null }>;
    const results = await Promise.all(
      rows.map(async (r) => {
        try {
          return { groupNumber: r.group_number, match: await loadMatch(r.id), error: null };
        } catch (e) {
          return { groupNumber: r.group_number, match: null, error: loaderMessage(e) ?? "This group couldn't be loaded." };
        }
      }),
    );
    return groupOf(results);
  }
}

interface Props {
  session: TournamentSession;
  tournament: Tournament;
  onClose: () => void;
}

export default function PairingsPanel({ session, tournament, onClose }: Props) {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [tees, setTees] = useState<TeeRow[]>([]);
  const [assigned, setAssigned] = useState<TournamentPlayerJoined[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GroupView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ group: GroupView; hasScores: boolean } | null>(null);

  const format = session.format;

  const roster: Roster = useMemo(() => {
    const byId = new Map<number, { name: string; hi: number | null; side: Side }>();
    for (const tp of assigned) {
      const rec = Array.isArray(tp.players) ? tp.players[0] : tp.players;
      if (!rec) continue;
      byId.set(tp.player_id, { name: rec.display_name || rec.full_name, hi: rec.handicap_index, side: tp.side });
    }
    return { byId };
  }, [assigned]);

  const load = useCallback(async () => {
    setLoading(true);
    // The panel owns its side roster (fetches tournament_players) rather than
    // trusting a parent prop that may be stale after a Sides edit.
    const [g, teeRes, players] = await Promise.all([
      loadGroups(session.id),
      supabase.from("tees").select("id, color, slope_rating, course_rating, par").order("sort_order"),
      getTournamentPlayers(tournament.id),
    ]);
    setGroups(g);
    setTees((teeRes.data as TeeRow[] | null) ?? []);
    setAssigned(players);
    setLoading(false);
  }, [session.id, tournament.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Players already in a group today (from the loaded matches) — excluded from pickers.
  const groupedIds = useMemo(() => {
    const s = new Set<number>();
    for (const g of groups) {
      for (const m of g.matches) {
        for (const p of m.sideA.players) s.add(p.playerId);
        for (const p of m.sideB.players) s.add(p.playerId);
      }
    }
    return s;
  }, [groups]);

  const assignedCount = roster.byId.size;
  const groupedCount = groupedIds.size;
  const unassigned = assignedCount - groupedCount;
  const groupCount = groups.length;

  const teeLabel = (teeId: number | null) => tees.find((t) => t.id === teeId)?.color ?? "Tee";

  const openDelete = async (group: GroupView) => {
    // Has-scores is enforced in the data layer; we surface the right modal copy.
    const gn = group.groupNumber;
    let hasScores = false;
    if (gn != null) {
      const teamNumbers = group.matches.flatMap((m) => [m.sideA.teamNumber, m.sideB.teamNumber]);
      const { data: rps } = await supabase
        .from("round_players")
        .select("id")
        .eq("round_id", session.round_id)
        .in("team_number", teamNumbers.length ? teamNumbers : [-1]);
      const rpIds = ((rps ?? []) as Array<{ id: number }>).map((r) => r.id);
      if (rpIds.length) {
        const { data: sc } = await supabase.from("scores").select("id").in("round_player_id", rpIds).limit(1);
        hasScores = ((sc ?? []) as unknown[]).length > 0;
      }
      if (!hasScores && format === "greensomes") {
        const { data: ts } = await supabase
          .from("team_scores")
          .select("id")
          .eq("round_id", session.round_id)
          .in("team_number", teamNumbers.length ? teamNumbers : [-1])
          .limit(1);
        hasScores = ((ts ?? []) as unknown[]).length > 0;
      }
    }
    setDeleteTarget({ group, hasScores });
  };

  const doDelete = async (group: GroupView) => {
    if (group.groupNumber == null) return;
    try {
      await deleteGroup({ sessionId: session.id, groupNumber: group.groupNumber });
    } catch (err) {
      setBanner(mutationMessage(err, tournament.side_a_name, tournament.side_b_name));
    } finally {
      await load();
    }
  };

  const wrap: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 900,
    background: C.bg,
    overflowY: "auto",
    fontFamily: FONT,
  };

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px 60px" }}>
        {/* Header */}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: C.navy, fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", padding: "8px 0", minHeight: 44 }}
        >
          ← Days
        </button>
        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: C.navy }}>{session.name}</div>
        <div style={{ color: C.muted, fontSize: "0.85rem", marginTop: 2 }}>
          {FORMAT_LABEL[format]} · {session.played_on ? formatDisplayDate(session.played_on) : "no date"}
        </div>
        <div style={{ color: C.navy, fontSize: "0.85rem", fontWeight: 600, marginTop: 6 }}>
          {groupCount} {groupCount === 1 ? "group" : "groups"} · {groupedCount} players · {unassigned} unassigned
        </div>

        {banner && (
          <div
            role="alert"
            onClick={() => setBanner(null)}
            style={{ background: "#fdecea", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "10px 12px", marginTop: 12, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}
          >
            {banner} <span style={{ fontWeight: 400 }}>(tap to dismiss)</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", margin: "14px 0" }}>
          <button style={{ ...primaryBtn, padding: "9px 14px", fontSize: "0.85rem" }} onClick={() => setAddOpen(true)}>
            + Add Group
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div>
        ) : groups.length === 0 ? (
          <div style={{ color: C.muted, fontSize: "0.9rem", padding: "8px 0" }}>No groups yet. Tap “Add Group”.</div>
        ) : (
          groups.map((g, i) => (
            <GroupCard
              key={g.groupNumber ?? `g${i}`}
              group={g}
              format={format}
              sideAName={tournament.side_a_name}
              sideBName={tournament.side_b_name}
              teeLabel={teeLabel}
              onEdit={() => setEditTarget(g)}
              onDelete={() => openDelete(g)}
            />
          ))
        )}
      </div>

      {addOpen && (
        <GroupBuilder
          mode="add"
          format={format}
          roster={roster}
          groupedIds={groupedIds}
          tees={tees}
          sideAName={tournament.side_a_name}
          sideBName={tournament.side_b_name}
          onCancel={() => setAddOpen(false)}
          onSubmit={async (draft) => {
            try {
              await createGroup({
                sessionId: session.id,
                format,
                sideAPlayerIds: draft.aIds,
                sideBPlayerIds: draft.bIds,
                teeId: draft.teeId,
              });
              setAddOpen(false);
              await load();
            } catch (err) {
              setBanner(mutationMessage(err, tournament.side_a_name, tournament.side_b_name));
            }
          }}
        />
      )}

      {editTarget && (
        <EditGroup
          group={editTarget}
          format={format}
          roster={roster}
          groupedIds={groupedIds}
          tees={tees}
          sideAName={tournament.side_a_name}
          sideBName={tournament.side_b_name}
          sessionId={session.id}
          onClose={() => setEditTarget(null)}
          onError={(msg) => setBanner(msg)}
          onDone={async () => {
            setEditTarget(null);
            await load();
          }}
        />
      )}

      {deleteTarget && (
        <DangerModal
          title={`Remove this group?`}
          description={
            deleteTarget.hasScores
              ? "This group has scores entered and can't be removed. Remove the scores first."
              : "This removes the group and its matches. Pairings can be rebuilt anytime."
          }
          confirmLabel={deleteTarget.hasScores ? "Can't remove" : "Remove group"}
          confirmDisabled={deleteTarget.hasScores}
          onConfirm={async () => {
            const t = deleteTarget;
            setDeleteTarget(null);
            if (!t.hasScores) await doDelete(t.group);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Group card ──────────────────────────────────────────────────────────────
function GroupCard({
  group,
  format,
  sideAName,
  sideBName,
  teeLabel,
  onEdit,
  onDelete,
}: {
  group: GroupView;
  format: SessionFormat;
  sideAName: string;
  sideBName: string;
  teeLabel: (teeId: number | null) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const card: React.CSSProperties = {
    background: "white",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  };

  if (group.error) {
    return (
      <div style={{ ...card, borderColor: C.amber }}>
        <div style={{ color: C.amber, fontWeight: 700, fontSize: "0.85rem" }}>⚠ {group.error}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <EditRemoveButtons onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      {group.matches.map((m, idx) => (
        <div key={m.match.id} style={{ marginTop: idx === 0 ? 0 : 14, paddingTop: idx === 0 ? 0 : 14, borderTop: idx === 0 ? "none" : `1px solid ${C.border}` }}>
          {format === "singles_match" && (
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Match {idx + 1}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <SideColumn side="a" name={sideAName} match={m} />
            <SideColumn side="b" name={sideBName} match={m} />
          </div>
        </div>
      ))}
      <div style={{ color: C.muted, fontSize: "0.75rem", marginTop: 10 }}>{teeLabel(group.matches[0]?.teeId ?? null)} tees</div>
      {isIncompleteGroup(group) && (
        <div style={{ background: C.amberBg, color: C.amber, fontSize: "0.78rem", fontWeight: 600, padding: "5px 9px", borderRadius: 6, marginTop: 8, display: "inline-block" }}>
          {incompleteReason(group, sideAName, sideBName)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <EditRemoveButtons onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function SideColumn({ side, name, match }: { side: Side; name: string; match: LoadedMatch }) {
  const col = SIDE_COLOR[side];
  const s = side === "a" ? match.sideA : match.sideB;
  return (
    <div style={{ flex: 1, minWidth: 0, border: `1px solid ${col.border}`, borderRadius: 8, background: col.bg, padding: "8px 10px" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: col.text, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{name}</div>
      {s.players.length === 0 ? (
        <div style={{ color: C.muted, fontSize: "0.82rem", fontStyle: "italic" }}>— empty —</div>
      ) : (
        s.players.map((p) => (
          <div key={p.playerId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.86rem", color: C.navy, padding: "2px 0" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
            <span style={{ fontWeight: 700, color: p.matchStrokes > 0 ? C.navy : C.muted }}>{p.matchStrokes}</span>
          </div>
        ))
      )}
      {s.collapsedHandicap != null && (
        <div style={{ fontSize: "0.72rem", color: C.muted, marginTop: 4 }}>Team CH {s.collapsedHandicap}</div>
      )}
    </div>
  );
}

function EditRemoveButtons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const btn = (color: string): React.CSSProperties => ({
    minHeight: 40,
    padding: "0 14px",
    borderRadius: 8,
    border: `1.5px solid ${color}`,
    background: "white",
    color,
    fontWeight: 600,
    fontSize: "0.82rem",
    cursor: "pointer",
    fontFamily: FONT,
  });
  return (
    <>
      <button style={btn(C.navy)} onClick={onEdit}>
        Edit
      </button>
      <button style={btn(C.red)} onClick={onDelete}>
        Remove
      </button>
    </>
  );
}

function isIncompleteGroup(group: GroupView): boolean {
  return group.matches.some((m) => m.isIncomplete);
}

function incompleteReason(group: GroupView, sideAName: string, sideBName: string): string {
  let aMissing = 0;
  let bMissing = 0;
  const need = group.matches[0]?.session.format === "singles_match" ? 1 : 2;
  for (const m of group.matches) {
    aMissing += Math.max(0, need - m.sideA.players.length);
    bMissing += Math.max(0, need - m.sideB.players.length);
  }
  const parts: string[] = [];
  if (aMissing) parts.push(`${aMissing} ${sideAName}`);
  if (bMissing) parts.push(`${bMissing} ${sideBName}`);
  return `Waiting on ${parts.join(" and ")} player${aMissing + bMissing > 1 ? "s" : ""}.`;
}

// ── Builder (Add) ───────────────────────────────────────────────────────────
interface Draft {
  aIds: Array<number | null>;
  bIds: Array<number | null>;
  teeId: number;
}

function GroupBuilder({
  format,
  roster,
  groupedIds,
  tees,
  sideAName,
  sideBName,
  onCancel,
  onSubmit,
}: {
  mode: "add";
  format: SessionFormat;
  roster: Roster;
  groupedIds: Set<number>;
  tees: TeeRow[];
  sideAName: string;
  sideBName: string;
  onCancel: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const slots = 2; // per side (a foursome)
  const [aIds, setAIds] = useState<Array<number | null>>(Array(slots).fill(null));
  const [bIds, setBIds] = useState<Array<number | null>>(Array(slots).fill(null));
  const [teeId, setTeeId] = useState<number>(DEFAULT_TEE_ID);
  const [saving, setSaving] = useState(false);

  const tee = tees.find((t) => t.id === teeId) ?? null;
  const picked = new Set<number>([...aIds, ...bIds].filter((x): x is number => x != null));

  const optionsFor = (side: Side, ownValue: number | null) => {
    const opts = [];
    for (const [id, rec] of roster.byId) {
      if (rec.side !== side) continue;
      if (groupedIds.has(id)) continue;
      if (picked.has(id) && id !== ownValue) continue;
      opts.push({ id, label: rec.name });
    }
    opts.sort((x, y) => x.label.localeCompare(y.label));
    return opts;
  };

  // Live strokes preview via the SAME computeSideStrokes helper the loader uses.
  // Only complete units get a stroke shown: for singles each 1-v-1 row is
  // independent (strokes off the two players IN THAT ROW, never all four); for
  // greensomes/four-ball strokes are computed over the currently-filled players.
  const chOf = (id: number | null): number | null => {
    if (id == null || !tee) return null;
    return computeCourseHandicap(roster.byId.get(id)?.hi ?? null, tee.slope_rating, tee.course_rating, tee.par);
  };
  const preview = useMemo(() => {
    const aStrokes: Array<number | null> = Array(slots).fill(null);
    const bStrokes: Array<number | null> = Array(slots).fill(null);
    let aCollapsed: number | null = null;
    let bCollapsed: number | null = null;

    if (format === "singles_match") {
      for (let i = 0; i < slots; i++) {
        if (aIds[i] == null || bIds[i] == null) continue; // strokes need both sides
        const r = computeSideStrokes("singles_match", [chOf(aIds[i])], [chOf(bIds[i])]);
        aStrokes[i] = r.aStrokes[0] ?? 0;
        bStrokes[i] = r.bStrokes[0] ?? 0;
      }
    } else {
      const aFilled = aIds.map((id, i) => ({ id, i })).filter((x) => x.id != null);
      const bFilled = bIds.map((id, i) => ({ id, i })).filter((x) => x.id != null);
      const r = computeSideStrokes(format, aFilled.map((x) => chOf(x.id)), bFilled.map((x) => chOf(x.id)));
      aFilled.forEach((x, k) => (aStrokes[x.i] = r.aStrokes[k] ?? 0));
      bFilled.forEach((x, k) => (bStrokes[x.i] = r.bStrokes[k] ?? 0));
      aCollapsed = r.aCollapsed;
      bCollapsed = r.bCollapsed;
    }
    return { aStrokes, bStrokes, aCollapsed, bCollapsed };
  }, [aIds, bIds, teeId, format]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPicked = picked.size;

  const setSlot = (side: Side, i: number, id: number | null) => {
    if (side === "a") setAIds((prev) => prev.map((v, j) => (j === i ? id : v)));
    else setBIds((prev) => prev.map((v, j) => (j === i ? id : v)));
  };

  const rowLabel = (i: number) => (format === "singles_match" ? `Match ${i + 1}` : i === 0 ? "Players" : "");

  return (
    <ModalShell title="Add Group">
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 6 }}>
        <span>{sideAName}</span>
        <span>{sideBName}</span>
      </div>
      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          {format === "singles_match" && (
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#9ca3af", marginBottom: 4 }}>{rowLabel(i)}</div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <PlayerCombobox
                options={optionsFor("a", aIds[i])}
                value={aIds[i]}
                onChange={(id) => setSlot("a", i, id)}
                ariaLabel={`${sideAName} slot ${i + 1}`}
                placeholder={`${sideAName}…`}
              />
              <StrokeHint value={preview.aStrokes[i]} />
            </div>
            <span style={{ color: C.muted, fontSize: "0.75rem", fontWeight: 700 }}>v</span>
            <div style={{ flex: 1 }}>
              <PlayerCombobox
                options={optionsFor("b", bIds[i])}
                value={bIds[i]}
                onChange={(id) => setSlot("b", i, id)}
                ariaLabel={`${sideBName} slot ${i + 1}`}
                placeholder={`${sideBName}…`}
              />
              <StrokeHint value={preview.bStrokes[i]} />
            </div>
          </div>
        </div>
      ))}

      {format === "greensomes" && (
        <div style={{ fontSize: "0.75rem", color: C.muted, marginBottom: 8 }}>
          Team CH — {sideAName} {preview.aCollapsed ?? "—"} · {sideBName} {preview.bCollapsed ?? "—"}
        </div>
      )}

      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "8px 0 4px" }}>Tee</div>
      <select
        value={teeId}
        onChange={(e) => setTeeId(parseInt(e.target.value, 10))}
        style={{ width: "100%", padding: "11px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: "0.95rem", fontFamily: FONT, minHeight: 44 }}
      >
        {tees.map((t) => (
          <option key={t.id} value={t.id}>
            {t.color}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{ ...primaryBtn, flex: 1, opacity: totalPicked === 0 || saving ? 0.5 : 1 }}
          disabled={totalPicked === 0 || saving}
          onClick={() => {
            setSaving(true);
            onSubmit({ aIds, bIds, teeId });
            setSaving(false);
          }}
        >
          Save group
        </button>
      </div>
    </ModalShell>
  );
}

function StrokeHint({ value }: { value: number | null }) {
  if (value == null) return null;
  return (
    <div style={{ fontSize: "0.72rem", color: value > 0 ? C.navy : C.muted, marginTop: 2, paddingLeft: 4 }}>
      {value} stroke{value === 1 ? "" : "s"}
    </div>
  );
}

// ── Edit (tee change + swap occupied seats) ─────────────────────────────────
function EditGroup({
  group,
  format,
  roster,
  groupedIds,
  tees,
  sideAName,
  sideBName,
  sessionId,
  onClose,
  onError,
  onDone,
}: {
  group: GroupView;
  format: SessionFormat;
  roster: Roster;
  groupedIds: Set<number>;
  tees: TeeRow[];
  sideAName: string;
  sideBName: string;
  sessionId: number;
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const groupNumber = group.groupNumber;
  // Seats = every (teamNumber, side, currentPlayerId) across the group's matches.
  const seats = useMemo(() => {
    const out: Array<{ teamNumber: number; side: Side; playerId: number; name: string }> = [];
    for (const m of group.matches) {
      for (const p of m.sideA.players) out.push({ teamNumber: m.sideA.teamNumber, side: "a", playerId: p.playerId, name: p.displayName });
      for (const p of m.sideB.players) out.push({ teamNumber: m.sideB.teamNumber, side: "b", playerId: p.playerId, name: p.displayName });
    }
    return out;
  }, [group]);

  const currentTee = group.matches[0]?.teeId ?? DEFAULT_TEE_ID;
  const [teeId, setTeeId] = useState<number>(currentTee);
  const [repl, setRepl] = useState<Record<number, number | null>>({}); // teamNumber+playerId key -> new
  const [saving, setSaving] = useState(false);

  const picked = new Set<number>();
  for (const s of seats) picked.add(repl[keyOf(s.teamNumber, s.playerId)] ?? s.playerId);

  const optionsFor = (side: Side, own: number) => {
    const opts = [];
    for (const [id, rec] of roster.byId) {
      if (rec.side !== side) continue;
      // exclude players grouped elsewhere or already picked in this group (except this seat's own)
      if ((groupedIds.has(id) || picked.has(id)) && id !== own) continue;
      opts.push({ id, label: rec.name });
    }
    opts.sort((x, y) => x.label.localeCompare(y.label));
    return opts;
  };

  const save = async () => {
    if (groupNumber == null) return;
    setSaving(true);
    try {
      if (teeId !== currentTee) {
        await updateGroup({ sessionId, groupNumber, teeId });
      }
      for (const s of seats) {
        const next = repl[keyOf(s.teamNumber, s.playerId)];
        if (next != null && next !== s.playerId) {
          await updateGroup({ sessionId, groupNumber, teamNumber: s.teamNumber, fromPlayerId: s.playerId, toPlayerId: next });
        }
      }
      onDone();
    } catch (err) {
      onError(mutationMessage(err, sideAName, sideBName));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit Group">
      <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 10 }}>
        Swap a player or change the tee. To add or clear a seat, remove the group and re-add it.
      </div>
      {seats.map((s) => (
        <div key={keyOf(s.teamNumber, s.playerId)} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: SIDE_COLOR[s.side].text, marginBottom: 3 }}>
            {s.side === "a" ? sideAName : sideBName}
          </div>
          <PlayerCombobox
            options={optionsFor(s.side, s.playerId)}
            value={repl[keyOf(s.teamNumber, s.playerId)] ?? s.playerId}
            onChange={(id) => setRepl((prev) => ({ ...prev, [keyOf(s.teamNumber, s.playerId)]: id }))}
            ariaLabel={`Edit ${s.name}`}
          />
        </div>
      ))}

      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "8px 0 4px" }}>Tee</div>
      <select
        value={teeId}
        onChange={(e) => setTeeId(parseInt(e.target.value, 10))}
        style={{ width: "100%", padding: "11px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: "0.95rem", fontFamily: FONT, minHeight: 44 }}
      >
        {tees.map((t) => (
          <option key={t.id} value={t.id}>
            {t.color}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }} onClick={onClose}>
          Cancel
        </button>
        <button style={{ ...primaryBtn, flex: 1, opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={save}>
          Save changes
        </button>
      </div>
    </ModalShell>
  );
}

function keyOf(teamNumber: number, playerId: number): number {
  return teamNumber * 100000 + playerId;
}

function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflowY: "auto" }}>
      <div style={{ background: "white", borderRadius: 16, padding: "24px 20px", maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "1.1rem", fontWeight: 700, color: C.navy, fontFamily: FONT }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
