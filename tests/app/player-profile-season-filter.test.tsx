// @vitest-environment jsdom
//
// E5 — Played With "This season / All-time" toggle on the player profile.
//
// Self-contained MiniFake (supports .gt() + dotted .eq() through the rounds
// embed incl. season_id + a seasons table) so the played-with query actually
// runs — the shared player-profile-ordering MiniFake lacks .gt() (TD30).
//
// Seed: focal player 40 has one partner per season —
//   Pat (round in the ACTIVE 2026 season) and Old (round in the past 2025
//   season). "This season" must show Pat only; "All-time" must reveal Old too.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import React from "react";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
const paramsRef = vi.hoisted(() => ({ current: { id: "40" } }));

vi.mock("@/lib/supabase", () => ({ get supabase() { return fakeRef.current; } }));
vi.mock("next/navigation", () => ({ useParams: () => paramsRef.current }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
// Season stats panel isn't under test — keep it out of the supabase fake.
vi.mock("@/lib/playerStats", () => ({ fetchPlayerStats: vi.fn().mockResolvedValue(null) }));

// ── MiniFake (with .gt) ───────────────────────────────────────────────────────
class MiniFake {
  data: Record<string, any[]>;
  constructor(seed: Record<string, any[]>) { this.data = seed; }
  from(table: string) { return new MiniBuilder(this, table); }
}

class MiniBuilder {
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
  order(column: string, opts?: any) {
    this._order = { column, ascending: opts?.ascending ?? true, referencedTable: opts?.referencedTable };
    return this;
  }
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
      if (/\btees\b[^,)]*\(/.test(this._selectStr)) {
        out.tees = (this.fake.data.tees ?? []).find((t: any) => t.id === rp.tee_id) ?? null;
      }
      if (/\bscores\b[^,)]*\(/.test(this._selectStr)) {
        out.scores = (this.fake.data.scores ?? []).filter((s: any) => s.round_player_id === rp.id);
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
    for (const [c, vs] of this._ins) rows = rows.filter((r) => vs.some((v) => this.looseEq(r[c], v)));
    for (const [c, v] of this._gts) rows = rows.filter((r) => (r[c] ?? 0) > v);

    if (this._order && !this._order.referencedTable) {
      const { column, ascending } = this._order;
      rows = [...rows].sort((a, b) => {
        const av = a[column], bv = b[column];
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

// ── Seed ──────────────────────────────────────────────────────────────────────
function buildSeed(opts: { activeSeason?: boolean } = {}) {
  const active = opts.activeSeason ?? true;
  return {
    seasons: [
      { id: 1, name: "2026 Season", started_on: "2026-01-01", ended_on: null, is_active: active, created_at: "2026-01-01T00:00:00Z" },
      { id: 2, name: "2025 Season", started_on: "2025-01-01", ended_on: "2025-12-31", is_active: false, created_at: "2025-01-01T00:00:00Z" },
    ],
    rounds: [
      { id: 100, played_on: "2026-05-01", is_complete: true, season_id: 1 }, // current season
      { id: 200, played_on: "2025-05-01", is_complete: true, season_id: 2 }, // past season
    ],
    round_players: [
      // Current-season round 100: focal (40) + Pat (50), team 1.
      { id: 901, round_id: 100, player_id: 40, tee_id: 4, team_number: 1, course_handicap: 10 },
      { id: 902, round_id: 100, player_id: 50, tee_id: 4, team_number: 1, course_handicap: 9 },
      // Past-season round 200: focal (40) + Old (60), team 1.
      { id: 903, round_id: 200, player_id: 40, tee_id: 4, team_number: 1, course_handicap: 10 },
      { id: 904, round_id: 200, player_id: 60, tee_id: 4, team_number: 1, course_handicap: 8 },
    ],
    // Focal's rows need a score so the Round History filter keeps them and the
    // Played With accordion (gated on rounds.length > 0) renders.
    scores: [
      { id: 1, round_player_id: 901, hole_number: 1, strokes: 4 },
      { id: 2, round_player_id: 903, hole_number: 1, strokes: 4 },
    ],
    players: [
      { id: 40, full_name: "Test Player", display_name: "Test", handicap_index: 10, is_active: true },
      { id: 50, full_name: "Pat Current", display_name: "Pat", handicap_index: 9, is_active: true },
      { id: 60, full_name: "Old Partner", display_name: "Old", handicap_index: 8, is_active: true },
    ],
    tees: [{ id: 4, color: "WY Combo" }],
  };
}

import PlayerProfilePage from "@/app/player/[id]/page";

beforeEach(() => { paramsRef.current = { id: "40" }; });
afterEach(() => { cleanup(); });

async function flush(n = 50) { for (let i = 0; i < n; i++) await Promise.resolve(); }

async function openPlayedWith() {
  const header = screen.getByRole("button", { name: /Played With/i });
  fireEvent.click(header);
  await act(async () => { await flush(); });
}

describe("E5 — Played With season toggle", () => {
  it("defaults to 'This season' and shows only current-season partners", async () => {
    fakeRef.current = new MiniFake(buildSeed());
    render(<PlayerProfilePage />);
    await act(async () => { await flush(); });

    // Toggle defaults to This season selected.
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "false");

    await openPlayedWith();

    // Pat (current season) is a counted partner; Old (past season) is not.
    expect(screen.getByText(/Pat C · 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Old P · 1/)).not.toBeInTheDocument();
  });

  it("switching to 'All-time' reveals a partner from a past season", async () => {
    fakeRef.current = new MiniFake(buildSeed());
    render(<PlayerProfilePage />);
    await act(async () => { await flush(); });
    await openPlayedWith();

    // Before: Old is not a counted partner.
    expect(screen.queryByText(/Old P · 1/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    await act(async () => { await flush(); });

    // After the re-query: both seasons' partners appear.
    expect(screen.getByText(/Pat C · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Old P · 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the toggle and shows all-time data when no active season exists", async () => {
    fakeRef.current = new MiniFake(buildSeed({ activeSeason: false }));
    render(<PlayerProfilePage />);
    await act(async () => { await flush(); });

    // Toggle is hidden entirely.
    expect(screen.queryByRole("button", { name: "This season" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All-time" })).not.toBeInTheDocument();

    await openPlayedWith();
    // All-time fallback: both partners visible despite no active season.
    expect(screen.getByText(/Pat C · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Old P · 1/)).toBeInTheDocument();
  });
});
