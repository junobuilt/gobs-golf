"use client";

// Admin Played-With tab (Phase E6) — replaces the legacy full_name-keyed
// heatmap (played_with_matrix view, dropped this session) with three stacked
// sections answering the admin's real round-setup questions:
//
//   1. Player View   — "who has [Player] paired with?"
//   2. Today's Group — "among players here today, who hasn't paired well?"
//   3. Pair Lookup   — "how often have these two played together?"
//
// All three query round_players directly via @/lib/playedWith/compute (the
// same live-JOIN the player profile uses), each with an independent season
// scope toggle.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Player } from "../page";
import { getDisplayName, buildDisplayNameMap, type PlayerLike } from "@/lib/players/displayName";
import { getActiveSeason, type Season } from "@/lib/seasons";
import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/date";
import {
  loadPlayedWith,
  fetchPlayedWithRows,
  computeBuckets,
  fetchPairRounds,
  type Partner,
  type NeverPlayed,
  type PlayedWithBuckets,
  type PairRound,
} from "@/lib/playedWith/compute";
import PlayedWithPanel from "@/components/playedWith/PlayedWithPanel";
import SeasonToggle, { type SeasonFilter } from "@/components/season/SeasonToggle";
import PlayerCombobox, { type ComboOption } from "@/components/playedWith/PlayerCombobox";
import { FORMAT_LABELS } from "@/lib/format/copy";
import type { Format } from "@/lib/scoring/types";

interface Props {
  // Active players only (from the admin shell). Drives the pickers; the bucket
  // computation fetches the full roster itself (it needs inactive players too).
  players: Player[];
  // Optional jump to the Round Setup tab (Section 2 empty state). Wired by the
  // admin shell which owns the active-tab state.
  onGoToRoundSetup?: () => void;
}

const C = {
  navy: "#0b2d50",
  midNavy: "#0e4270",
  green: "#276e34",
  bg: "#f5f4f0",
  cardBorder: "#e4e4e4",
  text: "#1f2937",
  subtext: "#64748b",
  muted: "#9ca3af",
  font: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
};

const SECTION2_PARTNER_CAP = 3;
const SECTION2_NEVER_CAP = 5;

export default function PlayedWith({ players, onGoToRoundSetup }: Props) {
  // Active roster, alphabetized by disambiguated display name, for the pickers.
  const comboOptions: ComboOption[] = useMemo(() => {
    return players
      .map((p) => ({ id: p.id, label: getDisplayName(p, players) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [players]);
  const labelById = useMemo(() => {
    const m = new Map<number, string>();
    comboOptions.forEach((o) => m.set(o.id, o.label));
    return m;
  }, [comboOptions]);

  // Active season loaded once. When null, all toggles hide and force all-time.
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [seasonLoaded, setSeasonLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getActiveSeason();
        if (alive) setActiveSeason(s);
      } catch (err) {
        console.error("Failed to load active season", err);
      } finally {
        if (alive) setSeasonLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Per-section: resolve the effective filter (forced all-time when no active
  // season) and the season id to scope by.
  const seasonIdFor = (filter: SeasonFilter): number | null =>
    activeSeason && filter === "this_season" ? activeSeason.id : null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "20px 16px 60px", fontFamily: C.font }}>
      <div style={{ maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <PlayerViewSection
          comboOptions={comboOptions}
          labelById={labelById}
          activeSeason={activeSeason}
          seasonLoaded={seasonLoaded}
          seasonIdFor={seasonIdFor}
        />
        <TodaysGroupSection
          labelById={labelById}
          activeSeason={activeSeason}
          seasonLoaded={seasonLoaded}
          seasonIdFor={seasonIdFor}
          onGoToRoundSetup={onGoToRoundSetup}
        />
        <PairLookupSection
          comboOptions={comboOptions}
          labelById={labelById}
          activeSeason={activeSeason}
          seasonLoaded={seasonLoaded}
          seasonIdFor={seasonIdFor}
        />
      </div>
    </div>
  );
}

// ── Shared section chrome ──────────────────────────────────────────────────

function SectionCard({
  heading,
  caption,
  toggle,
  children,
}: {
  heading: string;
  caption: string;
  toggle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "white",
      border: `1px solid ${C.cardBorder}`,
      borderRadius: "10px",
      padding: "18px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "14px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: C.navy }}>{heading}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: C.subtext }}>{caption}</p>
        </div>
        {toggle && <div style={{ flexShrink: 0, paddingTop: "2px" }}>{toggle}</div>}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontStyle: "italic", color: C.muted, fontSize: "0.88rem", padding: "8px 0" }}>
      {children}
    </div>
  );
}

function LoadingHint() {
  return <div style={{ color: C.muted, fontSize: "0.85rem", padding: "8px 0" }}>Loading…</div>;
}

// ── Section 1 — Player View ────────────────────────────────────────────────

function PlayerViewSection({
  comboOptions,
  labelById,
  activeSeason,
  seasonLoaded,
  seasonIdFor,
}: {
  comboOptions: ComboOption[];
  labelById: Map<number, string>;
  activeSeason: Season | null;
  seasonLoaded: boolean;
  seasonIdFor: (f: SeasonFilter) => number | null;
}) {
  const [focalId, setFocalId] = useState<number | null>(null);
  const [filter, setFilter] = useState<SeasonFilter>("this_season");
  const effective: SeasonFilter = activeSeason ? filter : "all_time";

  const [buckets, setBuckets] = useState<PlayedWithBuckets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!seasonLoaded) return;
    if (focalId == null) {
      setBuckets(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const b = await loadPlayedWith(focalId, seasonIdFor(effective));
        if (alive) setBuckets(b);
      } catch (err) {
        console.error("Failed to load Player View", err);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focalId, effective, activeSeason, seasonLoaded]);

  const focalName = focalId != null ? labelById.get(focalId) ?? "this player" : null;

  return (
    <SectionCard
      heading="Player View"
      caption={focalName ? `See who ${focalName} has paired with` : "See who a player has paired with"}
      toggle={
        <SeasonToggle
          value={filter}
          onChange={setFilter}
          accent="navy"
          hideWhenNoActiveSeason
          activeSeason={activeSeason}
        />
      }
    >
      <div style={{ marginBottom: "14px" }}>
        <PlayerCombobox
          options={comboOptions}
          value={focalId}
          onChange={setFocalId}
          ariaLabel="Pick a player"
          placeholder="Pick a player…"
        />
      </div>

      {focalId == null ? (
        <EmptyHint>Pick a player to see their partners</EmptyHint>
      ) : error ? (
        <EmptyHint>Couldn&apos;t load play history.</EmptyHint>
      ) : loading || !buckets ? (
        <LoadingHint />
      ) : (
        <PlayedWithPanel
          partners={buckets.partners}
          neverPlayed={buckets.neverPlayed}
          seasonScoped={effective === "this_season"}
          focalPlayerName={focalName ?? undefined}
        />
      )}
    </SectionCard>
  );
}

// ── Section 2 — Today's Group ──────────────────────────────────────────────

function TodaysGroupSection({
  labelById,
  activeSeason,
  seasonLoaded,
  seasonIdFor,
  onGoToRoundSetup,
}: {
  labelById: Map<number, string>;
  activeSeason: Season | null;
  seasonLoaded: boolean;
  seasonIdFor: (f: SeasonFilter) => number | null;
  onGoToRoundSetup?: () => void;
}) {
  const [filter, setFilter] = useState<SeasonFilter>("this_season");
  const effective: SeasonFilter = activeSeason ? filter : "all_time";

  const [todayPlayerIds, setTodayPlayerIds] = useState<number[] | null>(null);
  const [todayLoaded, setTodayLoaded] = useState(false);
  const [cards, setCards] = useState<
    Array<{ id: number; name: string; partners: Partner[]; neverPlayed: NeverPlayed[] }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Load today's round + its rostered players once (regardless of team).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const today = todayLocal();
        const { data: rounds } = await supabase
          .from("rounds")
          .select("id")
          .eq("played_on", today)
          .order("played_on", { ascending: false })
          .limit(1);
        if (!rounds || rounds.length === 0) {
          if (alive) setTodayPlayerIds(null);
          return;
        }
        const { data: rps } = await supabase
          .from("round_players")
          .select("player_id")
          .eq("round_id", rounds[0].id);
        if (alive) setTodayPlayerIds((rps ?? []).map((r: any) => r.player_id));
      } catch (err) {
        console.error("Failed to load today's round", err);
        if (alive) setTodayPlayerIds(null);
      } finally {
        if (alive) setTodayLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fetch the season's rows ONCE, then compute buckets for each today player.
  useEffect(() => {
    if (!seasonLoaded || !todayLoaded) return;
    if (!todayPlayerIds || todayPlayerIds.length === 0) {
      setCards([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const { rpRows, allPlayers } = await fetchPlayedWithRows(seasonIdFor(effective));
        const nameMap = buildDisplayNameMap(
          allPlayers.map((p): PlayerLike => ({ id: p.id, full_name: p.full_name, is_active: p.is_active })),
        );
        const fallbackName = (id: number) =>
          nameMap.get(id) ?? labelById.get(id) ?? `Player ${id}`;
        const built = todayPlayerIds.map((id) => {
          const b = computeBuckets(id, rpRows, allPlayers);
          return {
            id,
            name: fallbackName(id),
            partners: b.partners,
            neverPlayed: b.neverPlayed,
          };
        });
        // Sort the cards alphabetically so the list is scannable.
        built.sort((a, b) => a.name.localeCompare(b.name));
        if (alive) setCards(built);
      } catch (err) {
        console.error("Failed to load Today's Group", err);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlayerIds, todayLoaded, effective, activeSeason, seasonLoaded]);

  return (
    <SectionCard
      heading="Today's Group"
      caption="Players in today's round — find good pairings"
      toggle={
        <SeasonToggle
          value={filter}
          onChange={setFilter}
          accent="navy"
          hideWhenNoActiveSeason
          activeSeason={activeSeason}
        />
      }
    >
      {!todayLoaded ? (
        <LoadingHint />
      ) : !todayPlayerIds || todayPlayerIds.length === 0 ? (
        <div style={{ padding: "8px 0" }}>
          <EmptyHint>No round set up for today</EmptyHint>
          {onGoToRoundSetup && (
            <button
              type="button"
              onClick={onGoToRoundSetup}
              style={{
                marginTop: "4px",
                background: "transparent",
                border: "none",
                padding: 0,
                color: C.midNavy,
                fontSize: "0.88rem",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: C.font,
              }}
            >
              Go to Round Setup →
            </button>
          )}
        </div>
      ) : error ? (
        <EmptyHint>Couldn&apos;t load play history.</EmptyHint>
      ) : loading ? (
        <LoadingHint />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {cards.map((card) => (
            <TodayCard key={card.id} card={card} seasonScoped={effective === "this_season"} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function TodayCard({
  card,
  seasonScoped,
}: {
  card: { id: number; name: string; partners: Partner[]; neverPlayed: NeverPlayed[] };
  seasonScoped: boolean;
}) {
  const topPartners = [...card.partners]
    .sort((a, b) => b.rounds_together - a.rounds_together || a.display_name.localeCompare(b.display_name))
    .slice(0, SECTION2_PARTNER_CAP);
  const never = [...card.neverPlayed].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const neverVisible = never.slice(0, SECTION2_NEVER_CAP);
  const neverExtra = never.length - neverVisible.length;

  return (
    <div style={{
      border: `1px solid ${C.cardBorder}`,
      borderRadius: "8px",
      padding: "12px 14px",
      background: "#fcfcfb",
    }}>
      <Link
        href={`/player/${card.id}`}
        style={{ fontSize: "0.95rem", fontWeight: 700, color: C.navy, textDecoration: "none" }}
      >
        {card.name}
      </Link>

      <div style={{ marginTop: "8px" }}>
        <MiniLabel>Most with</MiniLabel>
        {topPartners.length === 0 ? (
          <span style={{ fontSize: "0.82rem", color: C.muted, fontStyle: "italic" }}>
            {seasonScoped ? "No partners this season" : "No partners yet"}
          </span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {topPartners.map((p) => (
              <MiniPill key={p.id} id={p.id} bg="#e4f5e9" color={C.green}>
                {p.display_name} · {p.rounds_together}
              </MiniPill>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: "8px" }}>
        <MiniLabel>{seasonScoped ? "Not yet this season" : "Never paired with"}</MiniLabel>
        {neverVisible.length === 0 ? (
          <span style={{ fontSize: "0.82rem", color: C.muted, fontStyle: "italic" }}>
            Played with everyone
          </span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
            {neverVisible.map((n) => (
              <MiniPill key={n.id} id={n.id} bg="#fde0dc" color="#9a2a20">
                {n.display_name}
              </MiniPill>
            ))}
            {neverExtra > 0 && (
              <span style={{ fontSize: "0.78rem", color: C.muted }}>+{neverExtra} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.66rem",
      fontWeight: 700,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      marginBottom: "4px",
    }}>
      {children}
    </div>
  );
}

function MiniPill({ id, bg, color, children }: { id: number; bg: string; color: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/player/${id}`}
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: "999px",
        background: bg,
        color,
        fontSize: "0.8rem",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

// ── Section 3 — Pair Lookup ────────────────────────────────────────────────

function PairLookupSection({
  comboOptions,
  labelById,
  activeSeason,
  seasonLoaded,
  seasonIdFor,
}: {
  comboOptions: ComboOption[];
  labelById: Map<number, string>;
  activeSeason: Season | null;
  seasonLoaded: boolean;
  seasonIdFor: (f: SeasonFilter) => number | null;
}) {
  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [filter, setFilter] = useState<SeasonFilter>("this_season");
  const effective: SeasonFilter = activeSeason ? filter : "all_time";

  const [rounds, setRounds] = useState<PairRound[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showRounds, setShowRounds] = useState(false);

  const bothPicked = aId != null && bId != null && aId !== bId;

  useEffect(() => {
    if (!seasonLoaded) return;
    if (!bothPicked) {
      setRounds(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(false);
    setShowRounds(false);
    (async () => {
      try {
        const r = await fetchPairRounds(aId!, bId!, seasonIdFor(effective));
        if (alive) setRounds(r);
      } catch (err) {
        console.error("Failed to load Pair Lookup", err);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aId, bId, effective, activeSeason, seasonLoaded]);

  const nameA = aId != null ? labelById.get(aId) ?? "Player A" : "Player A";
  const nameB = bId != null ? labelById.get(bId) ?? "Player B" : "Player B";
  const count = rounds?.length ?? 0;

  return (
    <SectionCard
      heading="Pair Lookup"
      caption="How often have two players paired up?"
      toggle={
        <SeasonToggle
          value={filter}
          onChange={setFilter}
          accent="navy"
          hideWhenNoActiveSeason
          activeSeason={activeSeason}
        />
      }
    >
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div style={{ flex: "1 1 200px", minWidth: "0" }}>
          <MiniLabel>Player A</MiniLabel>
          <PlayerCombobox
            options={comboOptions.filter((o) => o.id !== bId)}
            value={aId}
            onChange={setAId}
            ariaLabel="Player A"
            placeholder="Player A…"
          />
        </div>
        <div style={{ flex: "1 1 200px", minWidth: "0" }}>
          <MiniLabel>Player B</MiniLabel>
          <PlayerCombobox
            options={comboOptions.filter((o) => o.id !== aId)}
            value={bId}
            onChange={setBId}
            ariaLabel="Player B"
            placeholder="Player B…"
          />
        </div>
      </div>

      {!bothPicked ? (
        <EmptyHint>Pick two players to see their history</EmptyHint>
      ) : error ? (
        <EmptyHint>Couldn&apos;t load play history.</EmptyHint>
      ) : loading || rounds == null ? (
        <LoadingHint />
      ) : count === 0 ? (
        <div style={{ padding: "8px 0" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: C.text }}>
            {nameA} and {nameB} have <strong>never</strong> played together
            {effective === "this_season" ? " this season" : ""}.
          </div>
        </div>
      ) : (
        <div style={{ padding: "8px 0" }}>
          <div style={{ fontSize: "1.05rem", color: C.text }}>
            {nameA} and {nameB} have played together{" "}
            <strong style={{ color: C.navy }}>{count}</strong>{" "}
            {count === 1 ? "time" : "times"}
            {effective === "this_season" ? " this season" : ""}.
          </div>
          <div style={{ fontSize: "0.88rem", color: C.subtext, marginTop: "4px" }}>
            Last played together: <strong>{formatDate(rounds[0].played_on)}</strong>
          </div>
          <button
            type="button"
            onClick={() => setShowRounds((v) => !v)}
            style={{
              marginTop: "10px",
              background: "transparent",
              border: "none",
              padding: 0,
              color: C.midNavy,
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: C.font,
            }}
          >
            {showRounds ? "Hide rounds" : "Show all rounds"}
          </button>
          {showRounds && (
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {rounds.map((r) => (
                <Link
                  key={`${r.round_id}:${r.team_number}`}
                  href={`/round/${r.round_id}/scorecard`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    border: `1px solid ${C.cardBorder}`,
                    borderRadius: "8px",
                    background: "white",
                    textDecoration: "none",
                    color: C.text,
                  }}
                >
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{formatDate(r.played_on)}</span>
                  <span style={{ fontSize: "0.78rem", color: C.subtext }}>
                    Team {r.team_number} · {formatLabel(r.format)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "?";
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatLabel(format: string | null): string {
  if (!format) return "—";
  return FORMAT_LABELS[format as Format]?.title ?? format;
}
