"use client";

// Phase 2.2b — the pairings surface for one tournament day. An in-component
// full-screen panel (opened from the day card), NOT a route: the whole /admin
// tree navigates via panel state, so a sub-route would re-mount + re-auth for no
// gain. Every stroke/handicap/status on screen comes from loadSessionMatches /
// loadMatch (single source); the pre-save builder preview uses the SAME
// computeSideStrokes helper the loader uses, so preview and card can't diverge.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DangerModal from "./DangerModal";
import PlayerCombobox from "@/components/playedWith/PlayerCombobox";
import { getTeamColor } from "@/lib/teamColors";
import { DEFAULT_TEE_ID } from "@/lib/tees";
import { formatDisplayDate } from "@/lib/date";
import { supabase } from "@/lib/supabase";
import { computeCourseHandicap } from "@/lib/scoring/handicap";
import { computeSideStrokes } from "@/lib/tournament/matchStrokes";
import { loadMatch, loadSessionMatches } from "@/lib/tournament/loadMatch";
import { createGroup, deleteGroup, setGroupShotgun, setPlayerDaySide, unvoidMatch, updateGroup, voidMatch } from "@/lib/tournament/mutations";
import { getDaySideAssignments, getTournamentPlayers } from "@/lib/tournament/queries";
import { deriveGroupLabel, groupLabelFor } from "@/lib/tournament/matchScorecard";
import { FORMAT_LABEL } from "@/lib/tournament/formatLabels";
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
  // player_id -> { name, hi, side, homeSide }. `side` is the EFFECTIVE side for
  // THIS day (home overlaid with migration-038 overrides); `homeSide` is the
  // tournament-wide home. `side !== homeSide` ⇒ an alternate today. The pool
  // filter reads `side`; the alternate marker compares the two.
  byId: Map<number, { name: string; hi: number | null; side: Side; homeSide: Side }>;
}

interface GroupView {
  groupNumber: number | null;
  matches: LoadedMatch[];
  error: string | null; // set when a match in this group failed to load (misconfig)
}

// Options for one slot's PlayerCombobox: players on `side`, minus everyone in
// `excludeIds` (grouped elsewhere / picked in other slots), but ALWAYS including
// the slot's own current value with its roster label. PlayerCombobox blanks the
// field when `value` isn't among `options` (see its documented invariant), so a
// slot must never filter out its own selection — that was bug 2.2c.
function slotOptions(roster: Roster, side: Side, currentValue: number | null, excludeIds: Set<number>) {
  const opts: Array<{ id: number; label: string }> = [];
  for (const [id, rec] of roster.byId) {
    if (rec.side !== side) continue;
    if (excludeIds.has(id) && id !== currentValue) continue;
    opts.push({ id, label: rec.name });
  }
  if (currentValue != null && !opts.some((o) => o.id === currentValue)) {
    const rec = roster.byId.get(currentValue);
    if (rec) opts.push({ id: currentValue, label: rec.name });
  }
  opts.sort((x, y) => x.label.localeCompare(y.label));
  return opts;
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
  // Effective per-day side map (home overlaid with 038 overrides) for THIS day.
  const [daySides, setDaySides] = useState<Map<number, Side>>(new Map());
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [altOpen, setAltOpen] = useState(false); // alternate-editor section expanded
  // A staged per-day side change awaiting the freeze confirm (only when groups
  // are already built for this day).
  const [altPending, setAltPending] = useState<{ playerId: number; name: string; side: Side } | null>(null);
  const [editTarget, setEditTarget] = useState<GroupView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ group: GroupView; hasScores: boolean } | null>(null);

  const format = session.format;

  const roster: Roster = useMemo(() => {
    const byId = new Map<number, { name: string; hi: number | null; side: Side; homeSide: Side }>();
    for (const tp of assigned) {
      const rec = Array.isArray(tp.players) ? tp.players[0] : tp.players;
      if (!rec) continue;
      const homeSide = tp.side;
      const side = daySides.get(tp.player_id) ?? homeSide; // effective side for this day
      byId.set(tp.player_id, { name: rec.display_name || rec.full_name, hi: rec.handicap_index, side, homeSide });
    }
    return { byId };
  }, [assigned, daySides]);

  const load = useCallback(async () => {
    setLoading(true);
    // The panel owns its side roster (fetches tournament_players) rather than
    // trusting a parent prop that may be stale after a Sides edit. It also owns
    // the EFFECTIVE per-day side map (home overlaid with 038 overrides) so the
    // pool filter and alternate markers reflect today's alternates.
    const [g, teeRes, players, effective] = await Promise.all([
      loadGroups(session.id),
      supabase.from("tees").select("id, color, slope_rating, course_rating, par").order("sort_order"),
      getTournamentPlayers(tournament.id),
      getDaySideAssignments(tournament.id, session.id),
    ]);
    setGroups(g);
    setTees((teeRes.data as TeeRow[] | null) ?? []);
    setAssigned(players);
    setDaySides(effective);
    setLoading(false);
  }, [session.id, tournament.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Back-nav (browser Back + the header button). The panel is a fixed overlay,
  // not a route, so without this the device Back button leaves /admin entirely
  // and dead-ends on the homepage. Push a history entry when the panel opens and
  // close on popstate; the header back button routes through history.back() too,
  // so there is ONE close path and Back returns to the Tournament setup screen.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ __pairingsPanel: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Item 5 (bug 5): lock the body while this fixed overlay is mounted so touch
  // scroll can't chain to the page behind it (which froze the panel's own scroll
  // on mobile, especially with the alternate picker open). Restored on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const goBack = useCallback(() => {
    if (typeof window !== "undefined") window.history.back();
    else onCloseRef.current();
  }, []);

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

  // Per-day side (alternate) editor. setPlayerDaySide handles the sparse contract
  // (side === home → clears the override). load() re-derives the effective map.
  const applyAlt = async (playerId: number, side: Side) => {
    try {
      await setPlayerDaySide(tournament.id, session.id, playerId, side);
    } catch (err) {
      setBanner(mutationMessage(err, tournament.side_a_name, tournament.side_b_name));
    } finally {
      await load();
    }
  };
  // Freeze guard: once ANY group is built for this day, an override edit won't
  // re-side already-built matches — warn before applying (mirrors CH-snapshot
  // freeze copy). No groups yet ⇒ apply straight away.
  const requestAlt = (playerId: number, name: string, side: Side) => {
    if (groups.length > 0) setAltPending({ playerId, name, side });
    else void applyAlt(playerId, side);
  };

  const wrap: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 900,
    background: C.bg,
    overflowY: "auto",
    // Item 5 (bug 5): this fixed full-screen overlay is its own scroll container.
    // With the alternate picker expanded the content grows tall and, on mobile,
    // touch scroll chained to the body behind it and stalled ("scrollbar moves,
    // page frozen"). Contain the overscroll and enable momentum scrolling; the
    // body itself is locked while the panel is mounted (effect below).
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
    fontFamily: FONT,
  };

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px 60px" }}>
        {/* Header — breadcrumb back to the Tournament setup screen (routes through
            history.back so the browser Back button and this button agree). */}
        <button
          onClick={goBack}
          data-testid="pairings-back"
          style={{ background: "none", border: "none", color: C.navy, fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", padding: "8px 0", minHeight: 44 }}
        >
          ‹ Admin · Tournament
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

        {/* Alternates — per-day side overrides (admin-only). Default = home
            side; setting the other side marks the player an alternate for this
            day and lets them be paired on that side. */}
        {!loading && (
          <AlternatesEditor
            roster={roster}
            open={altOpen}
            onToggle={() => setAltOpen((v) => !v)}
            sideAName={tournament.side_a_name}
            sideBName={tournament.side_b_name}
            onSet={requestAlt}
          />
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
                startHole: draft.startHole,
                groupLabel: draft.groupLabel,
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

      {altPending && (
        // D3: no "change anyway" escape hatch once a match is built. Re-siding a
        // built player would leave the match card on the old side while the picker
        // shows the new one (split state, bug 6). Both buttons here only dismiss —
        // the ONLY way to re-side is to delete + rebuild the affected group.
        <DangerModal
          title="Groups already built for this day"
          description={
            `${altPending.name} is already in a match for this day, so their side is ` +
            `locked in. To move them to the other side, delete and rebuild ` +
            `${altPending.name}'s group — that's the only way to keep the card and ` +
            `the picker in agreement.`
          }
          cannotBeUndone={false}
          confirmLabel="Go rebuild"
          onConfirm={() => setAltPending(null)}
          onCancel={() => setAltPending(null)}
        />
      )}
    </div>
  );
}

// ── Alternates editor ─────────────────────────────────────────────────────────
// Per-day side overrides. Each tournament member shows a two-way [sideA|sideB]
// control; the EFFECTIVE side (roster.side) is highlighted. Choosing the other
// side calls onSet (which, once groups exist, routes through the freeze confirm);
// choosing the home side clears the override. A player whose effective side
// differs from home is tagged "· alternate".
function AlternatesEditor({
  roster,
  open,
  onToggle,
  sideAName,
  sideBName,
  onSet,
}: {
  roster: Roster;
  open: boolean;
  onToggle: () => void;
  sideAName: string;
  sideBName: string;
  onSet: (playerId: number, name: string, side: Side) => void;
}) {
  const members = useMemo(
    () =>
      [...roster.byId.entries()]
        .map(([id, rec]) => ({ id, ...rec }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [roster],
  );
  const altCount = members.filter((m) => m.side !== m.homeSide).length;
  const sideName = (s: Side) => (s === "a" ? sideAName : sideBName);

  const pill = (m: (typeof members)[number], s: Side) => {
    const active = m.side === s;
    return (
      <button
        key={s}
        data-testid={`alt-${m.id}-${s}`}
        aria-pressed={active}
        onClick={() => {
          if (!active) onSet(m.id, m.name, s);
        }}
        style={{
          flex: 1,
          minHeight: 36,
          borderRadius: 7,
          border: `1.5px solid ${active ? SIDE_COLOR[s].border : C.border}`,
          background: active ? SIDE_COLOR[s].bg : "white",
          color: active ? SIDE_COLOR[s].text : C.muted,
          fontWeight: 700,
          fontSize: "0.78rem",
          cursor: active ? "default" : "pointer",
          fontFamily: FONT,
        }}
      >
        {sideName(s)}
      </button>
    );
  };

  return (
    <div style={{ marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 10, background: "white", overflow: "hidden" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          padding: "12px 14px",
          cursor: "pointer",
          fontFamily: FONT,
          minHeight: 44,
        }}
      >
        <span style={{ fontWeight: 700, color: C.navy, fontSize: "0.9rem" }}>
          Alternates — sides for this day
          {altCount > 0 && (
            <span style={{ marginLeft: 8, color: C.amber, fontWeight: 700, fontSize: "0.8rem" }}>· {altCount}</span>
          )}
        </span>
        <span style={{ color: C.muted, fontSize: "0.8rem" }}>{open ? "Hide" : "Edit"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          <div style={{ color: C.muted, fontSize: "0.78rem", marginBottom: 10 }}>
            Set a player&rsquo;s side just for this day. Default is their home side; the other side marks them an alternate.
          </div>
          {members.length === 0 ? (
            <div style={{ color: C.muted, fontSize: "0.85rem", padding: "4px 0" }}>
              No players on a side yet — assign them under Sides first.
            </div>
          ) : (
            members.map((m) => {
              const isAlt = m.side !== m.homeSide;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: C.navy, fontSize: "0.86rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.name}
                    </div>
                    {isAlt && (
                      <div data-testid={`alt-tag-${m.id}`} style={{ color: C.amber, fontSize: "0.72rem", fontWeight: 700, marginTop: 1 }}>
                        {sideName(m.side)} today · alternate (home {sideName(m.homeSide)})
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, width: 190, flexShrink: 0 }}>
                    {pill(m, "a")}
                    {pill(m, "b")}
                  </div>
                </div>
              );
            })
          )}
        </div>
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

  // Shotgun (039): the foursome tag + tee-off hole, read off any match in the
  // group (all share them). No start_hole → an ordinary hole-1 start (no chip).
  const first = group.matches[0]?.match;
  const label = groupLabelFor(group.groupNumber, first?.group_label);
  const startHole = first?.start_hole ?? null;

  return (
    <div style={card}>
      {(label || startHole != null) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {label && (
            <span style={{ fontWeight: 800, fontSize: "0.8rem", color: C.navy }}>Group {label}</span>
          )}
          {startHole != null && (
            <span
              data-testid={`group-start-chip-${group.groupNumber ?? 0}`}
              style={{ fontSize: "0.72rem", fontWeight: 700, color: C.amber, background: C.amberBg, borderRadius: 6, padding: "2px 8px" }}
            >
              Starts hole {startHole}
            </span>
          )}
        </div>
      )}
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
  // Greensomes math caption: Team CH = 60% of the LOWER CH + 40% of the higher.
  const chs = s.players.map((p) => p.courseHandicap ?? 0);
  const low = chs.length ? Math.min(...chs) : 0;
  const high = chs.length ? Math.max(...chs) : 0;
  return (
    <div style={{ flex: 1, minWidth: 0, border: `1px solid ${col.border}`, borderRadius: 8, background: col.bg, padding: "8px 10px" }}>
      {/* Header row labels the otherwise-bare number as match strokes. */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: col.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>{name}</span>
        {s.players.length > 0 && (
          <span style={{ fontSize: "0.62rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Strokes</span>
        )}
      </div>
      {s.players.length === 0 ? (
        <div style={{ color: C.muted, fontSize: "0.82rem", fontStyle: "italic" }}>— empty —</div>
      ) : (
        s.players.map((p) => (
          <div key={p.playerId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.86rem", color: C.navy, padding: "2px 0" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
            <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: p.matchStrokes > 0 ? C.navy : C.muted }}>{p.matchStrokes}</span>
          </div>
        ))
      )}
      {s.collapsedHandicap != null && (
        <div style={{ fontSize: "0.72rem", color: C.muted, marginTop: 4 }}>
          Team CH {s.collapsedHandicap} = 60% × {low} + 40% × {high}
        </div>
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

// Shotgun tee-off order, capped at TWO — "A" tees off first, "B" second. A start
// hole holds at most two matches and A/B are REUSED at every start hole, so the
// picker never offers "C"+ (S3 Change 4). group_label is display-only; it never
// feeds team assignment or the scoring engine.
function GroupLabelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }} role="group" aria-label="Group (tee-off order)">
      {(["A", "B"] as const).map((L) => {
        const active = value === L;
        return (
          <button
            key={L}
            type="button"
            data-testid={`group-label-${L}`}
            aria-pressed={active}
            onClick={() => onChange(L)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 8,
              border: `1.5px solid ${active ? C.navy : C.border}`,
              background: active ? C.navy : "white",
              color: active ? "white" : C.muted,
              fontFamily: FONT,
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {L}
          </button>
        );
      })}
    </div>
  );
}

// ── Builder (Add) ───────────────────────────────────────────────────────────
interface Draft {
  aIds: Array<number | null>;
  bIds: Array<number | null>;
  teeId: number;
  startHole: number | null; // shotgun (039); null = ordinary hole-1 start
  groupLabel: string | null; // null = auto-derive from group_number
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
  const [startHole, setStartHole] = useState<number | null>(null); // null = hole 1
  const [groupLabel, setGroupLabel] = useState<string>("A"); // tee-off order (A/B)
  const [saving, setSaving] = useState(false);

  const tee = tees.find((t) => t.id === teeId) ?? null;
  const picked = new Set<number>([...aIds, ...bIds].filter((x): x is number => x != null));
  const excludeIds = new Set<number>([...groupedIds, ...picked]);

  const optionsFor = (side: Side, ownValue: number | null) => slotOptions(roster, side, ownValue, excludeIds);

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

      {/* Shotgun (039): per-group start hole + label. Default = ordinary hole-1
          start; label auto-derives from the group letter unless overridden. */}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "0 0 4px" }}>Start hole</div>
          <select
            data-testid="group-start-hole"
            value={startHole ?? 0}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setStartHole(v === 0 ? null : v);
            }}
            style={{ width: "100%", padding: "11px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: "0.95rem", fontFamily: FONT, minHeight: 44 }}
          >
            <option value={0}>Hole 1 (standard)</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                Hole {h}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "0 0 4px" }}>Group (tee-off order)</div>
          <GroupLabelPicker value={groupLabel} onChange={setGroupLabel} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button style={{ ...primaryBtn, flex: 1, background: "white", color: C.navy, border: `1.5px solid ${C.border}` }} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{ ...primaryBtn, flex: 1, opacity: totalPicked === 0 || saving ? 0.5 : 1 }}
          disabled={totalPicked === 0 || saving}
          onClick={() => {
            setSaving(true);
            onSubmit({ aIds, bIds, teeId, startHole, groupLabel: groupLabel.trim() || null });
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

// ── Edit (tee change + fill / clear / swap seats, in place) ─────────────────
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
  onDone: () => void;
}) {
  const groupNumber = group.groupNumber;
  const need = format === "singles_match" ? 1 : 2;

  const [liveGroup, setLiveGroup] = useState(group);
  const [desired, setDesired] = useState<Record<string, number | null>>({});
  const [teeId, setTeeId] = useState<number>(group.matches[0]?.teeId ?? DEFAULT_TEE_ID);
  const [startHole, setStartHole] = useState<number | null>(group.matches[0]?.match.start_hole ?? null);
  // The picker only offers A/B; seed it with the effective letter (stored override,
  // else the capped derived letter) so a legacy NULL row opens on its shown value.
  const [groupLabel, setGroupLabel] = useState<string>(
    group.matches[0]?.match.group_label?.trim() || deriveGroupLabel(group.groupNumber) || "A"
  );
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  // Migration 040 — the match pending a void confirm (its id), or null.
  const [voidConfirm, setVoidConfirm] = useState<number | null>(null);

  // Every slot in the group — occupied OR empty — keyed by team_number:index.
  const seats = useMemo(() => {
    const out: Array<{ key: string; matchId: number; teamNumber: number; side: Side; index: number; original: number | null }> = [];
    for (const m of liveGroup.matches) {
      (["a", "b"] as Side[]).forEach((side) => {
        const sd = side === "a" ? m.sideA : m.sideB;
        for (let i = 0; i < need; i++) {
          out.push({ key: `${sd.teamNumber}:${i}`, matchId: m.match.id, teamNumber: sd.teamNumber, side, index: i, original: sd.players[i]?.playerId ?? null });
        }
      });
    }
    return out;
  }, [liveGroup, need]);

  const currentTee = liveGroup.matches[0]?.teeId ?? DEFAULT_TEE_ID;

  const currentStartHole = liveGroup.matches[0]?.match.start_hole ?? null;
  const currentLabel = liveGroup.matches[0]?.match.group_label ?? "";
  // Effective displayed letter: the stored override, else the capped derived A/B.
  const effectiveLabel = currentLabel.trim() || deriveGroupLabel(groupNumber) || "A";

  // Reset the working copy whenever the live group changes (mount + reload).
  useEffect(() => {
    const init: Record<string, number | null> = {};
    for (const s of seats) init[s.key] = s.original;
    setDesired(init);
    setTeeId(currentTee);
    setStartHole(currentStartHole);
    setGroupLabel(effectiveLabel);
  }, [liveGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = new Set<number>(Object.values(desired).filter((x): x is number => x != null));
  // The group's OWN saved members are re-selectable within this modal session, so
  // subtract them from groupedIds before excluding — a player swapped out can be
  // swapped back before saving. `picked` still blocks anyone currently in a slot.
  const ownMembers = new Set<number>(seats.map((s) => s.original).filter((x): x is number => x != null));
  const excludeIds = new Set<number>([...[...groupedIds].filter((id) => !ownMembers.has(id)), ...picked]);

  const reloadFromDb = async () => {
    try {
      const groups = await loadGroups(sessionId);
      const g = groups.find((x) => x.groupNumber === groupNumber);
      if (g) setLiveGroup(g);
    } catch {
      /* keep the current copy if the reload itself fails */
    }
  };

  // Void / un-void a single match (migration 040). A state flag, NOT a deletion:
  // the row stays; it just drops out of the decidable pool. onDone closes the
  // modal AND reloads the parent, so the tournament header's Created count + the
  // cup thresholds refresh.
  const applyVoid = async (matchId: number, next: boolean) => {
    setSaving(true);
    setInlineError(null);
    try {
      if (next) await voidMatch(matchId);
      else await unvoidMatch(matchId);
      setVoidConfirm(null);
      onDone();
    } catch (err) {
      setInlineError(mutationMessage(err, sideAName, sideBName));
      await reloadFromDb();
      setSaving(false);
    }
  };

  const save = async () => {
    if (groupNumber == null) return;
    setSaving(true);
    setInlineError(null);
    try {
      if (teeId !== currentTee) await updateGroup({ sessionId, groupNumber, teeId });
      // Shotgun (039): persist start-hole / label changes across the group. The
      // label picker is A/B only; write it only when it differs from the effective
      // shown letter so an unrelated (tee-only) save never rewrites a NULL row.
      const startChanged = startHole !== currentStartHole;
      const labelChanged = groupLabel !== effectiveLabel;
      if (startChanged || labelChanged) {
        const patch: { startHole?: number | null; groupLabel?: string | null } = {};
        if (startChanged) patch.startHole = startHole;
        if (labelChanged) patch.groupLabel = groupLabel;
        await setGroupShotgun(sessionId, groupNumber, patch);
      }
      // clear → fill → swap (approved ordering).
      for (const s of seats) {
        if (s.original != null && desired[s.key] == null) {
          await updateGroup({ sessionId, groupNumber, teamNumber: s.teamNumber, fromPlayerId: s.original });
        }
      }
      for (const s of seats) {
        const d = desired[s.key];
        if (s.original == null && d != null) {
          await updateGroup({ sessionId, groupNumber, teamNumber: s.teamNumber, toPlayerId: d });
        }
      }
      for (const s of seats) {
        const d = desired[s.key];
        if (s.original != null && d != null && d !== s.original) {
          await updateGroup({ sessionId, groupNumber, teamNumber: s.teamNumber, fromPlayerId: s.original, toPlayerId: d });
        }
      }
      onDone();
    } catch (err) {
      // Some ops may already have persisted — reload the REAL state before
      // showing the error so the modal never displays what Dad thought he saved.
      setInlineError(mutationMessage(err, sideAName, sideBName));
      await reloadFromDb();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Edit Group">
      <div style={{ fontSize: "0.78rem", color: C.muted, marginBottom: 10 }}>
        Swap, add, or clear a player, or change the tee. Clear a seat with the × in its field.
      </div>
      {inlineError && (
        <div role="alert" style={{ background: "#fdecea", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: "0.82rem", fontWeight: 600 }}>
          {inlineError}
        </div>
      )}
      {liveGroup.matches.map((m, mi) => (
        <div key={m.match.id} style={{ marginBottom: 8 }}>
          {format === "singles_match" && (
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#9ca3af", marginBottom: 4 }}>Match {mi + 1}</div>
          )}
          {seats
            .filter((s) => s.matchId === m.match.id)
            .map((s) => {
              const sideNm = s.side === "a" ? sideAName : sideBName;
              return (
                <div key={s.key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: SIDE_COLOR[s.side].text, marginBottom: 3 }}>{sideNm}</div>
                  <PlayerCombobox
                    options={slotOptions(roster, s.side, desired[s.key] ?? null, excludeIds)}
                    value={desired[s.key] ?? null}
                    onChange={(id) => setDesired((prev) => ({ ...prev, [s.key]: id }))}
                    ariaLabel={`${sideNm} slot ${s.index + 1}${format === "singles_match" ? ` match ${mi + 1}` : ""}`}
                  />
                </div>
              );
            })}
          {/* Void / un-void this match (migration 040). Kept as a row (not a
              delete) — it just drops out of the cup total. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
            {m.match.is_voided ? (
              <>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.04em" }}>Voided — out of the cup</span>
                <button
                  type="button"
                  data-testid={`unvoid-match-${m.match.id}`}
                  disabled={saving}
                  onClick={() => void applyVoid(m.match.id, false)}
                  style={{ background: "white", color: C.navy, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
                >
                  Un-void
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid={`void-match-${m.match.id}`}
                disabled={saving}
                onClick={() => setVoidConfirm(m.match.id)}
                style={{ marginLeft: "auto", background: "white", color: C.red, border: `1.5px solid ${C.red}`, borderRadius: 8, padding: "7px 12px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
              >
                Void match
              </button>
            )}
          </div>
        </div>
      ))}

      {voidConfirm != null && (
        <DangerModal
          title="Void this match?"
          description="A voided match keeps its row but drops out of the tournament — it won't count toward the cup total, won't be scored, and won't show as a player's next match. You can un-void it anytime."
          cannotBeUndone={false}
          confirmLabel="Void match"
          zIndex={1100}
          onConfirm={() => void applyVoid(voidConfirm, true)}
          onCancel={() => setVoidConfirm(null)}
        />
      )}

      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "8px 0 4px" }}>Tee</div>
      <select
        data-testid="edit-tee"
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

      {/* Shotgun (039): start hole + label for the whole group. */}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "0 0 4px" }}>Start hole</div>
          <select
            data-testid="edit-start-hole"
            value={startHole ?? 0}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setStartHole(v === 0 ? null : v);
            }}
            style={{ width: "100%", padding: "11px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: "0.95rem", fontFamily: FONT, minHeight: 44 }}
          >
            <option value={0}>Hole 1 (standard)</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                Hole {h}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: C.muted, margin: "0 0 4px" }}>Group (tee-off order)</div>
          <GroupLabelPicker value={groupLabel} onChange={setGroupLabel} />
        </div>
      </div>

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
