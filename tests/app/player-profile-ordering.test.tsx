// @vitest-environment jsdom
//
// TD26 regression coverage. Round IDs no longer correspond to chronological
// date after the 2026-05-22 historical import (H.5) — older rounds were
// inserted with newer IDs. The player profile's Round History list was
// ordering by `round_player.round_id`, so the list rendered in
// insertion-ID order rather than play-date order.
//
// This test seeds two completed rounds where round_id and played_on
// disagree:
//   round_id=149, played_on=2026-04-15  (high ID, OLD date — historical import)
//   round_id=101, played_on=2026-05-18  (low ID, RECENT date — pre-existing)
//
// It then opens the Round History accordion and asserts the May 18 row
// appears before the April 15 row in the rendered DOM. Pre-fix this
// would have failed (149 > 101 → April 15 first).
//
// Test infra note: uses an inline MiniFake to sidestep TD22's
// `globalThis.localStorage.clear()` failures in the shared FakeSupabase
// harness.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";

// ── Fakes ────────────────────────────────────────────────────────────────────
const fakeRef = vi.hoisted(() => ({ current: null as any }));
const paramsRef = vi.hoisted(() => ({ current: { id: "40" } }));

vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

vi.mock("next/navigation", () => ({
  useParams: () => paramsRef.current,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// fetchPlayerStats hits supabase too; let it run against the same fake.

// ── Minimal Supabase fake ────────────────────────────────────────────────────
// Honors the .order("played_on", { referencedTable: "rounds" }) used in the
// player profile load path. Only implements what this test exercises.

class MiniFake {
  data: Record<string, any[]>;
  constructor(seed: Record<string, any[]>) { this.data = seed; }
  from(table: string) { return new MiniBuilder(this, table); }
}

class MiniBuilder {
  private _op = "select";
  private _eqs: Array<[string, any]> = [];
  private _ins: Array<[string, any[]]> = [];
  private _gts: Array<[string, any]> = [];
  private _selectStr = "*";
  private _terminal: "list" | "maybeSingle" | "single" = "list";
  private _order: { column: string; ascending: boolean; referencedTable?: string } | null = null;

  constructor(private fake: MiniFake, private table: string) {}

  select(str?: string) { this._selectStr = str ?? "*"; return this; }
  eq(col: string, val: any) { this._eqs.push([col, val]); return this; }
  in(col: string, vals: any[]) { this._ins.push([col, vals]); return this; }
  gt(col: string, val: any) { this._gts.push([col, val]); return this; }
  gte(_c: string, _v: any) { return this; }
  lte(_c: string, _v: any) { return this; }
  order(column: string, opts?: any) {
    this._order = {
      column,
      ascending: opts?.ascending ?? true,
      referencedTable: opts?.referencedTable,
    };
    return this;
  }
  maybeSingle() { this._terminal = "maybeSingle"; return this; }
  single() { this._terminal = "single"; return this; }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private looseEq(a: any, b: any) { return a === b || String(a) === String(b); }

  private async execute(): Promise<{ data: any; error: any }> {
    const tableRows: any[] = (this.fake.data as any)[this.table] ?? [];

    // Apply embedded joins (rounds, tees, scores) onto round_players first
    // so post-filter / post-order code below can read joined columns.
    let rows = tableRows.map((rp: any) => {
      if (this.table !== "round_players") return rp;
      const out: any = { ...rp };
      // Match `rounds (...)` or `rounds!inner (...)` etc — anything up to
      // the opening paren after the relation name.
      if (/\brounds\b[^,)]*\(/.test(this._selectStr)) {
        out.rounds = (this.fake.data.rounds ?? []).find((r: any) => r.id === rp.round_id) ?? null;
      }
      if (/\btees\b[^,)]*\(/.test(this._selectStr)) {
        out.tees = (this.fake.data.tees ?? []).find((t: any) => t.id === rp.tee_id) ?? null;
      }
      if (/\bscores\b[^,)]*\(/.test(this._selectStr)) {
        out.scores = (this.fake.data.scores ?? []).filter((s: any) => s.round_player_id === rp.id);
      }
      return out;
    });

    // Apply eq filters, including filters that look through embedded relations
    // (e.g., .eq("rounds.is_complete", true)).
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
    // .in() — flights resolution (getPrimaryFlightByRound) filters by round_id.
    for (const [c, vs] of this._ins) {
      rows = rows.filter((r) => vs.some((v) => this.looseEq(r[c], v)));
    }
    // .gt() — closes the prior "`.gt` is not a function" mock gap so the
    // profile's played-with query runs instead of throwing-and-swallowing.
    for (const [c, v] of this._gts) rows = rows.filter((r) => (r[c] ?? 0) > v);

    // Order outer rows. Matching real PostgREST behavior, `referencedTable`
    // sorts the *nested* array within each row rather than the outer rows
    // themselves — so when a caller passes `referencedTable`, the outer
    // ordering is left untouched (PostgREST default: physical / insertion
    // order). For an `!inner` 1:1 join the nested array has one element
    // and the sort is effectively a no-op. Treating referencedTable as a
    // no-op here mirrors that real behavior, which is what makes the
    // test meaningful — without this, the fake would silently "fix" the
    // bug the production code is supposed to fix.
    if (this._order && !this._order.referencedTable) {
      const { column, ascending } = this._order;
      rows = [...rows].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }

    if (this._terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    if (this._terminal === "single") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────
function buildSeed() {
  const rounds = [
    // High ID, OLD date — represents a historical import row.
    { id: 149, played_on: "2026-04-15", is_complete: true },
    // Low ID, RECENT date — represents a pre-import live round.
    { id: 101, played_on: "2026-05-18", is_complete: true },
  ];
  const round_players = [
    { id: 901, round_id: 149, player_id: 40, tee_id: 4, course_handicap: 12 },
    { id: 902, round_id: 101, player_id: 40, tee_id: 4, course_handicap: 12 },
  ];
  const scores = [
    // Each round needs at least one score row so it survives the
    // `rp.scores.length > 0` filter in the profile load path.
    { id: 1, round_player_id: 901, hole_number: 1, strokes: 4 },
    { id: 2, round_player_id: 902, hole_number: 1, strokes: 4 },
  ];
  return {
    players: [
      { id: 40, full_name: "Test Player", display_name: "Test", handicap_index: 10 },
    ],
    rounds,
    round_players,
    scores,
    tees: [{ id: 4, color: "WY Combo" }],
  };
}

import PlayerProfilePage from "@/app/player/[id]/page";

beforeEach(() => {
  paramsRef.current = { id: "40" };
});

afterEach(() => { cleanup(); });

async function flush(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("TD26 — player profile Round History orders by played_on, not round_id", () => {
  it("renders 2026-05-18 (round_id=101) before 2026-04-15 (round_id=149)", async () => {
    fakeRef.current = new MiniFake(buildSeed());
    render(<PlayerProfilePage />);
    await act(async () => { await flush(50); });

    // The accordion is collapsed by default — open it.
    const historyHeader = screen.getByRole("button", { name: /Round History/i });
    fireEvent.click(historyHeader);
    await act(async () => { await flush(); });

    // formatDate renders "Wed, May 18" and "Wed, Apr 15" (weekday/month/day).
    // Find both labels and check their DOM order.
    const may18 = screen.getByText(/May 1?5|May 18/);
    const apr15 = screen.getByText(/Apr 1?5/);
    expect(may18).toBeInTheDocument();
    expect(apr15).toBeInTheDocument();

    const order = (may18.compareDocumentPosition(apr15) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    // `order` is true when may18 precedes apr15. Post-fix: true. Pre-fix
    // (when ordering was by round_id), May 18 (id 101) would have come
    // AFTER Apr 15 (id 149) because 149 > 101 in descending order.
    expect(order).toBe(true);
  });
});
