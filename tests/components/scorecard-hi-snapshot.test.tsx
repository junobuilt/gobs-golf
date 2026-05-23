// @vitest-environment jsdom
//
// H.2.5.7 regression coverage. The math layer (CH, net, ranks) was
// switched to `round_players.handicap_index_snapshot` in H.2.5.3.
// The HI *display* label on per-round surfaces was missed and still
// read from `players.handicap_index`, so admin HI edits silently
// shifted the displayed HI on finalized rounds even though math was
// correct (bug repro: round 103, Wayne H, May 20–22, 2026).
//
// This test renders the scorecard for a finalized round where
// snapshot = 19.4 and current HI = 10.0. Pre-fix, the rendered HI
// label was 10.0. Post-fix, it must be 19.4.
//
// Note: uses the MiniFake / fakeRef pattern from page-team-formation
// rather than tests/components/fake-supabase.ts because the latter is
// invoked from a beforeEach that calls globalThis.localStorage.clear()
// — see TD22 (localStorage test infra failures, surfaced 2026-05-22).
// This file avoids touching localStorage at all so it runs cleanly
// alongside the TD22 failures.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";

// ── Fakes ────────────────────────────────────────────────────────────────────
const fakeRef = vi.hoisted(() => ({ current: null as any }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams("team=1") }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/round/1/scorecard",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// Mock the entire writeQueue surface so the scorecard's mount-time queue
// drain is a no-op. This is what lets us skip the localStorage.clear()
// in beforeEach (see TD22).
vi.mock("@/lib/writeQueue", () => ({
  getWriteQueue: () => ({
    enqueue: vi.fn(),
    getItems: () => [],
    drain: vi.fn().mockResolvedValue(undefined),
    retryTerminal: vi.fn(),
    markAsTerminal: vi.fn(),
    forget: vi.fn(),
  }),
  resetWriteQueueForTesting: vi.fn(),
}));

// ── Minimal in-memory Supabase fake ──────────────────────────────────────────
// Mirrors MiniFake from tests/app/page-team-formation.test.tsx. Supports the
// chained query-builder shape the scorecard uses on mount.
class MiniFake {
  data: Record<string, any[]>;
  constructor(seed: Record<string, any[]>) { this.data = seed; }
  from(table: string) { return new MiniBuilder(this, table); }
  rpc() { return Promise.resolve({ data: null, error: null }); }
}

class MiniBuilder {
  private _op = "select";
  private _eqs: Array<[string, any]> = [];
  private _insertPayload: any = null;
  private _updatePayload: any = null;
  private _selectStr = "*";
  private _terminal: "list" | "maybeSingle" | "single" = "list";
  private _inFilter: [string, any[]] | null = null;

  constructor(private fake: MiniFake, private table: string) {}

  select(str?: string) { this._selectStr = str ?? "*"; return this; }
  insert(payload: any) { this._op = "insert"; this._insertPayload = payload; return this; }
  update(payload: any) { this._op = "update"; this._updatePayload = payload; return this; }
  upsert(_payload: any, _opts?: any) { this._op = "upsert"; return this; }
  eq(col: string, val: any) { this._eqs.push([col, val]); return this; }
  in(col: string, vals: any[]) { this._inFilter = [col, vals]; return this; }
  is(_col: string, _v: any) { return this; }
  gt(_col: string, _v: any) { return this; }
  or(_f: string) { return this; }
  order(_f: string, _o?: any) { return this; }
  limit(_n: number) { return this; }
  maybeSingle() { this._terminal = "maybeSingle"; return this; }
  single() { this._terminal = "single"; return this; }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private looseEq(a: any, b: any) { return a === b || String(a) === String(b); }

  private applyFilters(rows: any[]) {
    let out = rows;
    for (const [c, v] of this._eqs) out = out.filter(r => this.looseEq(r[c], v));
    if (this._inFilter) {
      const [c, vs] = this._inFilter;
      out = out.filter(r => vs.some(v => this.looseEq(r[c], v)));
    }
    return out;
  }

  private async execute(): Promise<{ data: any; error: any }> {
    const tableRows: any[] = (this.fake.data as any)[this.table] ?? [];

    if (this._op === "insert" || this._op === "upsert") {
      return { data: null, error: null };
    }
    if (this._op === "update") {
      return { data: null, error: null };
    }

    let rows = this.applyFilters([...tableRows]);

    if (this.table === "round_players" && /players\s*\(/.test(this._selectStr)) {
      rows = rows.map(rp => {
        const player = (this.fake.data.players ?? []).find((p: any) => p.id === rp.player_id);
        return { ...rp, players: player ?? null };
      });
    }
    if (this.table === "rounds" && this._terminal === "maybeSingle") {
      return { data: rows[0] ?? null, error: null };
    }

    if (this._terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    if (this._terminal === "single") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────
function buildSeed() {
  const holes: any[] = [];
  for (let n = 1; n <= 18; n++) {
    holes.push({ id: n, tee_id: 1, hole_number: n, par: 4, yardage: 350, stroke_index: n });
  }
  const scores: any[] = [];
  for (let h = 1; h <= 18; h++) {
    scores.push({ id: h, round_player_id: 101, hole_number: h, strokes: 4, created_at: "2026-05-20T12:00:00Z" });
  }
  return {
    rounds: [{
      id: 1,
      played_on: "2026-05-20",
      course_id: 1,
      is_complete: true,
      format: "2_ball",
      format_config: { basis: "net", best_n: 2, override_holes: [], submitted_teams: [1] },
      format_locked_at: "2026-05-20T00:00:00Z",
      created_at: "2026-05-20T00:00:00Z",
    }],
    tees: [
      { id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 },
    ],
    holes,
    // Wayne H repro: snapshot is locked at 19.4 (HI on May 20); meanwhile an
    // admin has since edited players.handicap_index down to 10.0. The
    // displayed HI on this round must continue to be 19.4 — the value
    // actually used by the math layer for the locked course_handicap.
    round_players: [{
      id: 101,
      round_id: 1,
      player_id: 301,
      tee_id: 1,
      team_number: 1,
      course_handicap: 16,
      handicap_index_snapshot: 19.4,
      dropped_after_hole: null,
    }],
    players: [{
      id: 301,
      full_name: "Wayne Hashimoto",
      display_name: "Wayne H",
      handicap_index: 10.0,
      preferred_tee_id: 1,
    }],
    scores,
  };
}

async function flush(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ── Component under test ────────────────────────────────────────────────────
import ScorecardPage from "@/app/round/[id]/scorecard/page";

beforeEach(() => {
  searchParamsRef.current = new URLSearchParams("team=1");
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/round/1/scorecard?team=1"),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("H.2.5.7 — per-round HI display reads from snapshot", () => {
  it("renders 19.4 (snapshot) when players.handicap_index is 10.0", async () => {
    fakeRef.current = new MiniFake(buildSeed());
    render(<ScorecardPage />);
    await act(async () => { await flush(50); });

    // The metadata strip on the player row shows "Handicap Index: 19.4".
    // Pre-fix this would render "Handicap Index: 10.0" — current player HI.
    expect(screen.getByText(/Handicap Index:\s*19\.4/)).toBeInTheDocument();
    // Belt-and-braces: the current-HI value 10.0 must not appear as the
    // HI label. (A "10.0" anywhere else in the page would be coincidence,
    // but specifically "Handicap Index: 10.0" would prove the regression.)
    expect(screen.queryByText(/Handicap Index:\s*10\.0/)).toBeNull();
  });

  it("CH display also derives from snapshot (regression coverage for H.2.5.3)", async () => {
    // The stored course_handicap of 16 was computed from snapshot 19.4 +
    // White tee at H.2.5 time. If anything regressed CH math to read
    // current HI, this assertion would catch it (current HI of 10.0
    // would yield a CH of ~8, not 16).
    fakeRef.current = new MiniFake(buildSeed());
    render(<ScorecardPage />);
    await act(async () => { await flush(50); });

    expect(screen.getByText(/Course Handicap:\s*16/)).toBeInTheDocument();
  });
});
