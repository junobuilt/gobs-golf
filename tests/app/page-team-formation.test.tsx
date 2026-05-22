// @vitest-environment jsdom
/**
 * Homepage team-formation integration tests.
 *
 * Covers:
 * - 0-teams state: shows ⛳ empty state copy
 * - N-teams state: shows team rows; hero button disabled when round complete
 * - Tapping a team row routes to the correct scorecard URL
 * - create_new resolution inserts correct round_players rows
 * - silent_join makes zero writes and routes correctly
 * - confirm_join writes only after modal confirm
 * - mixed_teams_error writes nothing
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import React from "react";

// ── Fake Supabase ────────────────────────────────────────────────────────────
const fakeRef = vi.hoisted(() => ({ current: null as any }));

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));

// ── Fake next/navigation ──────────────────────────────────────────────────────
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ── Fake next/link ────────────────────────────────────────────────────────────
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

// ── Fake ensureRoundShell ─────────────────────────────────────────────────────
const mockEnsureRoundShell = vi.hoisted(() => vi.fn());
vi.mock("@/lib/round/ensureRoundShell", () => ({
  ensureRoundShell: mockEnsureRoundShell,
}));

// ── Fake write queue (stale-failure) ──────────────────────────────────────────
vi.mock("@/lib/writeQueue", () => ({
  getWriteQueue: () => ({
    getItems: () => [],
    retryTerminal: vi.fn(),
    drain: vi.fn(),
    markAsTerminal: vi.fn(),
    forget: vi.fn(),
  }),
  resetWriteQueueForTesting: vi.fn(),
}));

// ── Date helpers — pin to the hardcoded seed date so tests don't fail ──────────
// after May 20 2026. todayLocal() uses new Date() which would return the real
// current date; mocking it here keeps the test hermetic.
vi.mock("@/lib/date", () => ({
  todayLocal: () => "2026-05-20",
  yesterdayLocal: () => "2026-05-19",
}));

// ── Sentry ────────────────────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// ── Minimal in-memory Supabase fake ──────────────────────────────────────────
class MiniFake {
  data: Record<string, any[]>;
  writes: Array<{ type: string; table: string; payload?: any; filters?: any[] }> = [];
  rpcCalls: Array<{ name: string; args: any }> = [];
  rpcHandlers: Record<string, (args: any, fake: MiniFake) => { data: any; error: any }> = {};

  constructor(seed: Record<string, any[]>) {
    this.data = seed;
    // Default: create_team_with_players computes next team number from the
    // current fake state and inserts player rows under it. Tests that need
    // to simulate stale-data divergence override this via setRpcHandler.
    this.rpcHandlers["create_team_with_players"] = (args, fake) => {
      const roundId = args.p_round_id;
      const playerIds: number[] = args.p_player_ids ?? [];
      const snapshots: (number | null)[] = args.p_handicap_snapshots ?? [];
      const rps: any[] = fake.data.round_players ?? [];
      const maxTeam = rps
        .filter(r => r.round_id === roundId)
        .reduce((m, r) => Math.max(m, r.team_number ?? 0), 0);
      const nextTeam = maxTeam + 1;
      playerIds.forEach((pid, i) => {
        rps.push({
          id: rps.length + 500 + i,
          round_id: roundId,
          player_id: pid,
          team_number: nextTeam,
          handicap_index_snapshot: snapshots[i] ?? null,
        });
      });
      fake.writes.push({ type: "rpc_insert", table: "round_players", payload: { team_number: nextTeam, playerIds } });
      return { data: nextTeam, error: null };
    };
  }

  setRpcHandler(name: string, handler: (args: any, fake: MiniFake) => { data: any; error: any }) {
    this.rpcHandlers[name] = handler;
  }

  from(table: string) {
    return new MiniBuilder(this, table);
  }

  rpc(name: string, args: any) {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    const result = handler ? handler(args, this) : { data: null, error: { message: "no handler" } };
    return Promise.resolve(result);
  }
}

class MiniBuilder {
  private _op = "select";
  private _eqs: Array<[string, any]> = [];
  private _insertPayload: any = null;
  private _updatePayload: any = null;
  private _selectStr = "*";
  private _terminal: "list" | "maybeSingle" | "single" = "list";
  private _inFilter: [string, any[]] | null = null;
  private _orderField: string | null = null;

  constructor(private fake: MiniFake, private table: string) {}

  select(str?: string) { this._selectStr = str ?? "*"; return this; }
  insert(payload: any) { this._op = "insert"; this._insertPayload = payload; return this; }
  update(payload: any) { this._op = "update"; this._updatePayload = payload; return this; }
  eq(col: string, val: any) { this._eqs.push([col, val]); return this; }
  in(col: string, vals: any[]) { this._inFilter = [col, vals]; return this; }
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

    if (this._op === "insert") {
      const rows = Array.isArray(this._insertPayload) ? this._insertPayload : [this._insertPayload];
      const created = rows.map((r: any, i: number) => ({
        ...r,
        id: r.id ?? (tableRows.length + 100 + i),
      }));
      tableRows.push(...created);
      this.fake.writes.push({ type: "insert", table: this.table, payload: created });
      if (this._terminal === "single") return { data: created[0], error: null };
      return { data: created, error: null };
    }

    if (this._op === "update") {
      const filtered = this.applyFilters(tableRows);
      for (const r of filtered) Object.assign(r, this._updatePayload);
      this.fake.writes.push({
        type: "update",
        table: this.table,
        filters: [...this._eqs],
        payload: this._updatePayload,
      });
      if (this._terminal === "maybeSingle") return { data: filtered[0] ?? null, error: null };
      return { data: filtered, error: null };
    }

    // select
    let rows = this.applyFilters([...tableRows]);

    // Embedded join: round_players → players
    if (this.table === "round_players" && /players\s*\(/.test(this._selectStr)) {
      rows = rows.map(rp => {
        const player = (this.fake.data.players ?? []).find((p: any) => p.id === rp.player_id);
        return { ...rp, players: player ?? null };
      });
    }

    if (this._terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    if (this._terminal === "single") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
function makeSeed(opts: {
  todayRoundId?: number;
  roundPlayers?: any[];
  players?: any[];
} = {}) {
  const TODAY = "2026-05-20";
  return {
    players: opts.players ?? [
      { id: 1, full_name: "Alice Anderson", display_name: "Alice", handicap_index: 10, is_active: true, preferred_tee_id: null },
      { id: 2, full_name: "Bob Brown", display_name: "Bob", handicap_index: 8, is_active: true, preferred_tee_id: null },
      { id: 3, full_name: "Carol Chen", display_name: "Carol", handicap_index: 12, is_active: true, preferred_tee_id: null },
    ],
    rounds: opts.todayRoundId
      ? [{ id: opts.todayRoundId, played_on: TODAY, is_complete: false }]
      : [],
    round_players: opts.roundPlayers ?? [],
    scores: [],
  };
}

function makeSeedWithTeams() {
  return makeSeed({
    todayRoundId: 42,
    roundPlayers: [
      { id: 201, round_id: 42, player_id: 1, team_number: 1 },
      { id: 202, round_id: 42, player_id: 2, team_number: 1 },
      { id: 203, round_id: 42, player_id: 3, team_number: 2 },
    ],
  });
}

async function flush(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ── Import component under test ───────────────────────────────────────────────
import HomePage from "@/app/page";

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockPush.mockClear();
  mockEnsureRoundShell.mockResolvedValue(42);
  vi.useFakeTimers();
  Object.defineProperty(window, "location", {
    value: new URL("http://localhost/"),
    writable: true,
  });
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("hero pill '+ Form a Team' button", () => {
  it("opens PlayerPickerSheet when round is not complete", async () => {
    fakeRef.current = new MiniFake(makeSeed());
    render(<HomePage />);
    await act(async () => { await flush(); });

    const heroBtn = screen.getByRole("button", { name: "+ Form a Team" });
    expect(heroBtn).toBeInTheDocument();
    expect(heroBtn).not.toHaveAttribute("aria-disabled");

    fireEvent.click(heroBtn);
    await act(async () => { await flush(); });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Who's playing/i })).toBeInTheDocument();
  });

  it("shows amber toast and does not open picker when round is complete", async () => {
    const seed = {
      ...makeSeedWithTeams(),
      rounds: [{ id: 42, played_on: "2026-05-20", is_complete: true }],
    };
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    const heroBtn = screen.getByRole("button", { name: "+ Form a Team" });
    expect(heroBtn).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(heroBtn);
    await act(async () => { await flush(); });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Who's playing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Round is complete/)).toBeInTheDocument();
  });
});

describe("0-teams homepage", () => {
  it("shows ⛳ empty state copy when no round exists today", async () => {
    fakeRef.current = new MiniFake(makeSeed());
    render(<HomePage />);
    await act(async () => { await flush(); });
    expect(screen.getByText(/No teams exist yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Form a team" })).not.toBeInTheDocument();
  });

  it("shows round card without in-card form button when round exists but no teams", async () => {
    fakeRef.current = new MiniFake(makeSeed({ todayRoundId: 42 }));
    render(<HomePage />);
    await act(async () => { await flush(); });
    expect(screen.queryByRole("button", { name: "Form a new team" })).not.toBeInTheDocument();
  });
});

describe("N-teams homepage", () => {
  it("hero button is enabled when teams exist and round is not complete", async () => {
    fakeRef.current = new MiniFake(makeSeedWithTeams());
    render(<HomePage />);
    await act(async () => { await flush(); });
    const heroBtn = screen.getByRole("button", { name: "+ Form a Team" });
    expect(heroBtn).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Form a new team" })).not.toBeInTheDocument();
  });

  it("hero button is aria-disabled when round is complete", async () => {
    const seed = {
      ...makeSeedWithTeams(),
      rounds: [{ id: 42, played_on: "2026-05-20", is_complete: true }],
    };
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });
    expect(screen.getByRole("button", { name: "+ Form a Team" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("create_new resolution", () => {
  it("calls create_team_with_players RPC with the selected players and routes to scorecard", async () => {
    // No existing round — ensureRoundShell will create it
    const seed = makeSeed();
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    // Open picker via hero button (no round exists → calls ensureRoundShell)
    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    // Picker should be open: select Alice
    const aliceBtn = screen.getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    expect(aliceBtn).toBeDefined();
    fireEvent.click(aliceBtn!);

    // Click "Start scorecard"
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    // Should have called the RPC instead of direct INSERTs
    const rpcCalls = fakeRef.current.rpcCalls.filter(
      (c: any) => c.name === "create_team_with_players",
    );
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_round_id).toBe(42);
    expect(rpcCalls[0].args.p_player_ids).toEqual([1]);
    expect(rpcCalls[0].args.p_handicap_snapshots).toEqual([10]);

    // No direct round_players inserts from the client path
    const directInserts = fakeRef.current.writes.filter(
      (w: any) => w.type === "insert" && w.table === "round_players",
    );
    expect(directInserts).toHaveLength(0);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/scorecard?team=1"));
  });

  it("uses the server-returned team number (not client-computed) when stale data disagrees", async () => {
    // Stale-data sequential case: client view of round_players is empty,
    // so smartJoin computes nextTeamNumber = 1. But another device has
    // already created Team 1 on the server. The RPC returns 2 (the real
    // next number from the server's perspective). The client must route
    // and toast with 2, proving it trusts the server's return value
    // over its own client-computed advisory guess.
    const seed = makeSeed({ todayRoundId: 42 });
    fakeRef.current = new MiniFake(seed);
    fakeRef.current.setRpcHandler("create_team_with_players", () => ({
      data: 2,
      error: null,
    }));

    render(<HomePage />);
    await act(async () => { await flush(); });

    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    const aliceBtn = screen.getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    fireEvent.click(aliceBtn!);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    // The toast should reflect Team 2 (server-assigned), not Team 1
    // (client-computed). The route should also point at team=2.
    expect(screen.getByText(/Team 2 created/)).toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith("/round/42/scorecard?team=2");
  });
});

describe("refetch on picker open", () => {
  it("refetches roundPlayers when the picker opens, surfacing assignments made since initial load", async () => {
    // Initial seed: no roundPlayers. Render the homepage, then mutate
    // the fake's data directly to simulate another device creating
    // Team 1 in the background. When the user taps "+ Form a Team",
    // the picker should display the freshly-added Team 1 pill on Alice,
    // proving the open handler refetched rather than reusing stale
    // state from the initial load.
    const seed = makeSeed({ todayRoundId: 42 });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    // Background mutation: Alice now belongs to Team 1 on the server.
    fakeRef.current.data.round_players.push({
      id: 999,
      round_id: 42,
      player_id: 1,
      team_number: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    // The picker should render Alice's row with the "Team 1" pill —
    // only possible if roundPlayers was refetched on open.
    const picker = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceRow = within(picker).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    expect(aliceRow?.textContent).toMatch(/Team 1/);
  });
});

describe("silent_join resolution", () => {
  it("makes zero writes to round_players and routes to the team's scorecard", async () => {
    // Alice is already on team 1
    const seed = makeSeed({
      todayRoundId: 42,
      roundPlayers: [
        { id: 201, round_id: 42, player_id: 1, team_number: 1 },
        { id: 202, round_id: 42, player_id: 2, team_number: 1 },
      ],
    });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    // Open picker via hero button
    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    // Select both Alice and Bob (both on team 1 → silent_join)
    const pickerS = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceBtnS = within(pickerS).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    const bobBtnS = within(pickerS).getAllByRole("button").find(b => b.textContent?.includes("Bob"));
    fireEvent.click(aliceBtnS!);
    fireEvent.click(bobBtnS!);

    await act(async () => {
      fireEvent.click(within(pickerS).getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    const rpWrites = fakeRef.current.writes.filter(
      (w: any) => w.table === "round_players",
    );
    expect(rpWrites).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith("/round/42/scorecard?team=1");
  });
});

describe("confirm_join resolution", () => {
  it("shows the confirm modal; writes nothing until modal confirm", async () => {
    // Alice is on team 1; Bob is unassigned
    const seed = makeSeed({
      todayRoundId: 42,
      roundPlayers: [
        { id: 201, round_id: 42, player_id: 1, team_number: 1 },
        { id: 202, round_id: 42, player_id: 2, team_number: 0 },
      ],
    });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    // Open picker via hero button
    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    // Select Alice (team 1) + Bob (unassigned) → confirm_join
    const pickerDialog = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceBtn = within(pickerDialog).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    const bobBtn = within(pickerDialog).getAllByRole("button").find(b => b.textContent?.includes("Bob"));
    fireEvent.click(aliceBtn!);
    fireEvent.click(bobBtn!);

    await act(async () => {
      fireEvent.click(within(pickerDialog).getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    // Confirm modal should be visible; no writes yet
    expect(screen.getByRole("dialog", { name: /Join Team 1/i })).toBeInTheDocument();
    const rpWritesBefore = fakeRef.current.writes.filter(
      (w: any) => w.table === "round_players",
    );
    expect(rpWritesBefore).toHaveLength(0);

    // Confirm the join
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add to Team 1/i }));
      await flush();
    });

    const rpWritesAfter = fakeRef.current.writes.filter(
      (w: any) => w.table === "round_players",
    );
    expect(rpWritesAfter.length).toBeGreaterThanOrEqual(1);
    expect(mockPush).toHaveBeenCalledWith("/round/42/scorecard?team=1");
  });

  it("cancel preserves picker (no routes, no writes)", async () => {
    const seed = makeSeed({
      todayRoundId: 42,
      roundPlayers: [
        { id: 201, round_id: 42, player_id: 1, team_number: 1 },
        { id: 202, round_id: 42, player_id: 2, team_number: 0 },
      ],
    });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    const pickerDialog2 = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceBtn2 = within(pickerDialog2).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    const bobBtn2 = within(pickerDialog2).getAllByRole("button").find(b => b.textContent?.includes("Bob"));
    fireEvent.click(aliceBtn2!);
    fireEvent.click(bobBtn2!);

    await act(async () => {
      fireEvent.click(within(pickerDialog2).getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    // Cancel the modal — picker stays open (no route)
    const confirmModal = screen.getByRole("dialog", { name: /Join Team 1/i });
    fireEvent.click(within(confirmModal).getByRole("button", { name: "Cancel" }));
    expect(mockPush).not.toHaveBeenCalled();
    const rpWrites = fakeRef.current.writes.filter((w: any) => w.table === "round_players");
    expect(rpWrites).toHaveLength(0);
  });
});

describe("mixed_teams_error resolution", () => {
  it("shows the error modal and writes nothing", async () => {
    // Alice is on team 1; Carol is on team 2
    const seed = makeSeed({
      todayRoundId: 42,
      roundPlayers: [
        { id: 201, round_id: 42, player_id: 1, team_number: 1 },
        { id: 203, round_id: 42, player_id: 3, team_number: 2 },
      ],
    });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    // Select Alice (team 1) + Carol (team 2) → mixed_teams_error
    const pickerM = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceBtnM = within(pickerM).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    const carolBtnM = within(pickerM).getAllByRole("button").find(b => b.textContent?.includes("Carol"));
    fireEvent.click(aliceBtnM!);
    fireEvent.click(carolBtnM!);

    await act(async () => {
      fireEvent.click(within(pickerM).getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    expect(screen.getByRole("dialog", { name: /mixed teams error/i })).toBeInTheDocument();
    expect(screen.getByText(/Can't mix teams/i)).toBeInTheDocument();
    const rpWrites = fakeRef.current.writes.filter((w: any) => w.table === "round_players");
    expect(rpWrites).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("dismissing the modal returns to picker without routing", async () => {
    const seed = makeSeed({
      todayRoundId: 42,
      roundPlayers: [
        { id: 201, round_id: 42, player_id: 1, team_number: 1 },
        { id: 203, round_id: 42, player_id: 3, team_number: 2 },
      ],
    });
    fakeRef.current = new MiniFake(seed);
    render(<HomePage />);
    await act(async () => { await flush(); });

    fireEvent.click(screen.getByRole("button", { name: "+ Form a Team" }));
    await act(async () => { await flush(); });

    const pickerD = screen.getByRole("dialog", { name: /Who's playing/i });
    const aliceBtnD = within(pickerD).getAllByRole("button").find(b => b.textContent?.includes("Alice"));
    const carolBtnD = within(pickerD).getAllByRole("button").find(b => b.textContent?.includes("Carol"));
    fireEvent.click(aliceBtnD!);
    fireEvent.click(carolBtnD!);

    await act(async () => {
      fireEvent.click(within(pickerD).getByRole("button", { name: "Start scorecard" }));
      await flush();
    });

    // Dismiss
    fireEvent.click(screen.getByRole("button", { name: /Adjust selection/i }));
    expect(mockPush).not.toHaveBeenCalled();
    // Picker should still be visible after dismissal
    expect(screen.getByRole("dialog", { name: /Who's playing/i })).toBeInTheDocument();
  });
});
