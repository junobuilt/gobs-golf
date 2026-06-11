// @vitest-environment jsdom
//
// E6 — admin Played-With tab (three sections). Self-contained MiniFake
// (supports .gt/.in/.limit/.order + dotted .eq through the rounds embed) so the
// live-JOIN queries in @/lib/playedWith/compute actually run.
//
// todayLocal() is mocked per the locked date-mock rule (CLAUDE.md) — Section 2
// reads today's round by played_on.
//
// Seed: Bill+Pat share two completed season-1 rounds (100, 101). Today's round
// (200) holds Bill+Joe. So:
//   - Player View(Bill)  → Pat is a 1–2 partner; Joe/Sam never-played.
//   - Today's Group      → cards for Bill + Joe.
//   - Pair Lookup(Bill,Pat) → 2 times; (Bill,Joe) → never.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
const todayRef = vi.hoisted(() => ({ current: "2026-06-07" })); // default: no round today

vi.mock("@/lib/supabase", () => ({ get supabase() { return fakeRef.current; } }));
vi.mock("@/lib/date", () => ({
  todayLocal: () => todayRef.current,
  yesterdayLocal: () => "2026-06-06",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));

// ── MiniFake ────────────────────────────────────────────────────────────────
class MiniFake {
  data: Record<string, any[]>;
  constructor(seed: Record<string, any[]>) { this.data = seed; }
  from(table: string) { return new MiniBuilder(this, table); }
}

class MiniBuilder {
  private _eqs: Array<[string, any]> = [];
  private _gts: Array<[string, any]> = [];
  private _in: [string, any[]] | null = null;
  private _selectStr = "*";
  private _terminal: "list" | "maybeSingle" | "single" = "list";
  private _order: { column: string; ascending: boolean } | null = null;
  private _limit: number | null = null;
  constructor(private fake: MiniFake, private table: string) {}

  select(str?: string) { this._selectStr = str ?? "*"; return this; }
  eq(col: string, val: any) { this._eqs.push([col, val]); return this; }
  gt(col: string, val: any) { this._gts.push([col, val]); return this; }
  in(col: string, vals: any[]) { this._in = [col, vals]; return this; }
  order(column: string, opts?: any) { this._order = { column, ascending: opts?.ascending ?? true }; return this; }
  limit(n: number) { this._limit = n; return this; }
  maybeSingle() { this._terminal = "maybeSingle"; return this; }
  single() { this._terminal = "single"; return this; }

  then<T1 = any, T2 = never>(onF?: ((v: { data: any; error: any }) => T1 | PromiseLike<T1>) | null, onR?: ((r: any) => T2 | PromiseLike<T2>) | null) {
    return this.execute().then(onF, onR);
  }

  private looseEq(a: any, b: any) { return a === b || String(a) === String(b); }

  private async execute(): Promise<{ data: any; error: any }> {
    const tableRows: any[] = (this.fake.data as any)[this.table] ?? [];
    let rows = tableRows.map((rp: any) => {
      if (this.table !== "round_players") return rp;
      const out: any = { ...rp };
      if (/\brounds\b[^,)]*\(/.test(this._selectStr)) {
        out.rounds = (this.fake.data.rounds ?? []).find((r: any) => r.id === rp.round_id) ?? null;
      }
      return out;
    });

    for (const [c, v] of this._eqs) {
      if (c.includes(".")) {
        const [rel, col] = c.split(".");
        rows = rows.filter((r) => {
          const relObj = Array.isArray(r[rel]) ? r[rel][0] : r[rel];
          return relObj && this.looseEq(relObj[col], v);
        });
      } else {
        rows = rows.filter((r) => this.looseEq(r[c], v));
      }
    }
    for (const [c, v] of this._gts) rows = rows.filter((r) => (r[c] ?? 0) > v);
    if (this._in) {
      const [c, vals] = this._in;
      rows = rows.filter((r) => vals.some((v) => this.looseEq(r[c], v)));
    }

    if (this._order) {
      const { column, ascending } = this._order;
      rows = [...rows].sort((a, b) => {
        const av = a[column], bv = b[column];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);

    if (this._terminal === "maybeSingle" || this._terminal === "single") {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}

// ── Seed ──────────────────────────────────────────────────────────────────────
function buildSeed() {
  return {
    seasons: [
      { id: 1, name: "2026 Season", started_on: "2026-01-01", ended_on: null, is_active: true, created_at: "2026-01-01T00:00:00Z" },
    ],
    rounds: [
      { id: 100, played_on: "2026-05-01", is_complete: true, season_id: 1, format: "2_ball" },
      { id: 101, played_on: "2026-04-01", is_complete: true, season_id: 1, format: "best_ball" },
      { id: 200, played_on: "2026-06-06", is_complete: false, season_id: 1, format: "2_ball" }, // "today"
    ],
    // Flights (Session 1): the Pair Lookup format label now resolves off each
    // round's primary flight, not rounds.format.
    flights: [
      { id: 9100, round_id: 100, name: "Flight A", sort_order: 1, format: "2_ball", format_config: { basis: "net" }, format_locked_at: null },
      { id: 9101, round_id: 101, name: "Flight A", sort_order: 1, format: "best_ball", format_config: { basis: "net" }, format_locked_at: null },
      { id: 9200, round_id: 200, name: "Flight A", sort_order: 1, format: "2_ball", format_config: { basis: "net" }, format_locked_at: null },
    ],
    round_players: [
      { id: 1, round_id: 100, player_id: 1, team_number: 1 }, // Bill
      { id: 2, round_id: 100, player_id: 2, team_number: 1 }, // Pat
      { id: 3, round_id: 101, player_id: 1, team_number: 1 }, // Bill
      { id: 4, round_id: 101, player_id: 2, team_number: 1 }, // Pat
      { id: 5, round_id: 200, player_id: 1, team_number: 1 }, // Bill (today)
      { id: 6, round_id: 200, player_id: 3, team_number: 1 }, // Joe (today)
    ],
    players: [
      { id: 1, full_name: "Bill Carlson", display_name: "Bill", is_active: true, handicap_index: 10, preferred_tee_id: 1 },
      { id: 2, full_name: "Pat Smith", display_name: "Pat", is_active: true, handicap_index: 9, preferred_tee_id: 1 },
      { id: 3, full_name: "Joe Adams", display_name: "Joe", is_active: true, handicap_index: 8, preferred_tee_id: 1 },
      { id: 4, full_name: "Sam Young", display_name: "Sam", is_active: true, handicap_index: 7, preferred_tee_id: 1 },
    ],
  };
}

import PlayedWith from "@/app/admin/tabs/PlayedWith";
import type { Player } from "@/app/admin/page";

const PLAYERS: Player[] = buildSeed().players as any;

async function flush(n = 50) { for (let i = 0; i < n; i++) await Promise.resolve(); }

function renderTab() {
  return render(<PlayedWith players={PLAYERS} onGoToRoundSetup={() => {}} />);
}

beforeEach(() => {
  fakeRef.current = new MiniFake(buildSeed());
  todayRef.current = "2026-06-07"; // default no round; individual tests override
});
afterEach(() => cleanup());

describe("E6 — admin Played-With tab", () => {
  it("Section 1 Player View: picking a player renders their buckets", async () => {
    renderTab();
    await act(async () => { await flush(); });

    // Open the Player View combobox and pick Bill.
    const input = screen.getByLabelText("Pick a player");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: "Bill C" }));
    await act(async () => { await flush(); });

    // Bill + Pat share 2 completed rounds → 1–2 bucket pill.
    expect(screen.getByText("Pat S · 2")).toBeInTheDocument();
    // Joe + Sam never played with Bill → never-played pills present.
    expect(screen.getByText("Joe A")).toBeInTheDocument();
    expect(screen.getByText("Sam Y")).toBeInTheDocument();
  });

  it("Section 2 Today's Group: empty state when no round today", async () => {
    todayRef.current = "2026-06-07"; // no round on this date
    renderTab();
    await act(async () => { await flush(); });
    expect(screen.getByText("No round set up for today")).toBeInTheDocument();
  });

  it("Section 2 Today's Group: renders a card per today player when a round exists", async () => {
    todayRef.current = "2026-06-06"; // matches round 200 (Bill + Joe)
    const { container } = renderTab();
    await act(async () => { await flush(); });

    expect(screen.queryByText("No round set up for today")).not.toBeInTheDocument();
    // Bill's card shows Pat as a frequent partner.
    expect(screen.getByText("Pat S · 2")).toBeInTheDocument();
    // Both today players (Bill + Joe) have a card header linking to their profile.
    expect(container.querySelector('a[href="/player/1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/player/3"]')).not.toBeNull();
  });

  it("Section 3 Pair Lookup: zero pairs shows 'never'", async () => {
    renderTab();
    await act(async () => { await flush(); });

    // Bill (A) + Joe (B) — never played together.
    const a = screen.getByLabelText("Player A");
    fireEvent.focus(a);
    fireEvent.click(screen.getByRole("option", { name: "Bill C" }));
    const b = screen.getByLabelText("Player B");
    fireEvent.focus(b);
    fireEvent.click(screen.getByRole("option", { name: "Joe A" }));
    await act(async () => { await flush(); });

    expect(screen.getByText(/never/i)).toBeInTheDocument();
  });

  it("Section 3 Pair Lookup: multiple pairs + Show all rounds expansion", async () => {
    renderTab();
    await act(async () => { await flush(); });

    const a = screen.getByLabelText("Player A");
    fireEvent.focus(a);
    fireEvent.click(screen.getByRole("option", { name: "Bill C" }));
    const b = screen.getByLabelText("Player B");
    fireEvent.focus(b);
    fireEvent.click(screen.getByRole("option", { name: "Pat S" }));
    await act(async () => { await flush(); });

    // Count (rendered in its own <strong>) + last-played.
    expect(screen.getByText("2", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Last played together:/)).toBeInTheDocument();

    // Round list is collapsed until "Show all rounds".
    expect(screen.queryByText(/Best Ball/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show all rounds"));
    expect(screen.getByText(/Best Ball/)).toBeInTheDocument();
    expect(screen.getByText(/2-Ball/)).toBeInTheDocument();
  });
});
