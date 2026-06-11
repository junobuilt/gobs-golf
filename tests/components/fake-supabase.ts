// Minimal in-memory fake of the Supabase JS client surface that the scorecard
// page uses. Supports the chained query-builder methods we hit in production
// code paths and exposes a `writes` log so tests can assert against the order
// and shape of mutations.
//
// Supported chains:
//   from(table).select(cols).eq(col, v)[.in(col, vs)][.is(col, v)][.gt(col, v)][.order(col)][.maybeSingle()|.single()]
//   from(table).insert(row)
//   from(table).update(payload).eq(col, v)[.is(col, v)].select(cols).maybeSingle()
//   from(table).upsert(row, { onConflict: "col_a,col_b" })
//
// The builder is a Thenable so `await ...` works at any chain point.

export interface FakeData {
  rounds: any[];
  tees: any[];
  holes: any[];
  round_players: any[];
  players: any[];
  scores: any[];
  // Wave 1B — team-card scores (Shambles). Optional; absent on individual-round
  // seeds. execute() reads `(data as any)[table]`, so an absent key simply
  // returns [] for a `from("team_scores")` select.
  team_scores?: any[];
  // D.1 / golden-master — blind-draw fills. Optional; absent on non-blind-draw
  // seeds (then a `from("blind_draws")` select returns []). loadRoundResults'
  // drawn-player NAME falls back to the round_players lookup when the
  // `players(...)` embed doesn't resolve, so no embed support is needed here.
  blind_draws?: any[];
  // Flights (Session 1) — format ownership moved here from `rounds`. Optional:
  // when absent, the constructor synthesizes one Flight A per round (mirroring
  // migration 022's backfill) so existing fixtures resolve format/config/lock
  // off the flight without re-declaring it. Seed explicitly to exercise
  // multi-flight / flight_teams routing.
  flights?: any[];
  flight_teams?: any[];
}

export type WriteOp =
  | { type: "insert"; table: string; payload: any }
  | { type: "update"; table: string; filters: any[]; payload: any }
  | { type: "upsert"; table: string; payload: any; onConflict: string[] };

export interface FakeOptions {
  // Artificial delay applied to every insert/update before it resolves.
  writeDelayMs?: number;
  // If set, the supplied function decides whether a given write should fail
  // (and reject the promise). Called once per insert/update, in order.
  failWrite?: (op: WriteOp, callIndex: number) => boolean;
  // D.1: response for supabase.rpc('finalize_round_with_blind_draws', ...).
  // Defaults to { data: 'finalized', error: null } so legacy tests that
  // walked the End-Round flow continue to redirect to /summary.
  rpcFinalizeResult?: { data: string | null; error: unknown };
}

export class FakeSupabase {
  data: FakeData;
  writes: WriteOp[] = [];
  // D.1 hotfix: every supabase.rpc(name, args) call gets recorded so the
  // submit-flow tests can assert "RPC was called once when the last team
  // submitted" / "RPC was NOT called when only one team submitted."
  rpcCalls: Array<{ name: string; args: any }> = [];
  options: FakeOptions = {};
  private nextIds: Record<string, number> = {};
  private writeCallCounter = 0;

  constructor(seed: FakeData) {
    this.data = seed;
    // Flights (Session 1): synthesize one primary Flight A per round when the
    // seed doesn't declare flights — the test-side equivalent of migration
    // 022's backfill. format/lock copy verbatim; format_config copies all keys
    // EXCEPT submitted_teams (the only round-level key). Copied by value so a
    // later mutation of rounds.* does NOT leak into the flight (this is what
    // the negative-control test relies on to prove reads moved off rounds.*).
    const anySeed = this.data as any;
    if (!anySeed.flights) {
      anySeed.flights = (seed.rounds ?? []).map((r: any, i: number) => {
        let cfg: any = null;
        if (r.format_config && typeof r.format_config === "object") {
          cfg = { ...r.format_config };
          delete cfg.submitted_teams;
        }
        return {
          id: 900001 + i,
          round_id: r.id,
          name: "Flight A",
          sort_order: 1,
          format: r.format ?? null,
          format_config: cfg,
          format_locked_at: r.format_locked_at ?? null,
        };
      });
    }
    if (!anySeed.flight_teams) anySeed.flight_teams = [];

    for (const t of Object.keys(this.data)) {
      const rows = (this.data as any)[t] as any[];
      const maxId = rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0);
      this.nextIds[t] = maxId + 1;
    }
  }

  setOptions(opts: FakeOptions) {
    this.options = { ...this.options, ...opts };
  }

  reset() {
    this.writes = [];
    this.rpcCalls = [];
    this.writeCallCounter = 0;
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }

  /**
   * D.1: minimal RPC mock. The scorecard calls
   *   supabase.rpc('finalize_round_with_blind_draws', { p_round_id })
   * from the all-teams-submitted useEffect. The default response
   * ('finalized', no error) mirrors a successful end-of-round so tests
   * don't need per-call wiring. Override with setOptions({
   * rpcFinalizeResult }) when you want to exercise pool_too_small /
   * not_yet branches. Every call is recorded in rpcCalls.
   */
  async rpc(name: string, args: any): Promise<{ data: string | null; error: unknown }> {
    this.rpcCalls.push({ name, args });
    if (this.options.rpcFinalizeResult) return this.options.rpcFinalizeResult;
    return { data: "finalized", error: null };
  }

  _allocId(table: string): number {
    const id = this.nextIds[table];
    this.nextIds[table] = id + 1;
    return id;
  }

  _nextWriteCall() {
    return this.writeCallCounter++;
  }
}

type Op = "select" | "insert" | "update" | "upsert";
type Terminal = "list" | "maybeSingle" | "single";

class QueryBuilder<Row = any> {
  private op: Op = "select";
  private terminal: Terminal = "list";
  private selectStr: string = "*";
  private eqFilters: Array<[string, any]> = [];
  private inFilter: [string, any[]] | null = null;
  private isFilter: [string, any] | null = null;
  private gtFilters: Array<[string, any]> = [];
  private orderField: string | null = null;
  private limitN: number | null = null;
  private insertPayload: any[] = [];
  private updatePayload: any = null;
  private upsertPayload: any[] = [];
  private upsertConflictCols: string[] = [];

  constructor(private fake: FakeSupabase, private table: string) {}

  select(cols?: string) {
    if (this.op === "select") {
      this.selectStr = cols ?? "*";
    }
    // For insert/update chains that add .select() to return updated rows
    return this;
  }
  insert(row: any | any[]) {
    this.op = "insert";
    this.insertPayload = Array.isArray(row) ? row : [row];
    return this;
  }
  update(payload: any) {
    this.op = "update";
    this.updatePayload = payload;
    return this;
  }
  upsert(row: any | any[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.upsertPayload = Array.isArray(row) ? row : [row];
    this.upsertConflictCols = (opts?.onConflict ?? "").split(",").map(s => s.trim()).filter(Boolean);
    return this;
  }
  eq(col: string, val: any) {
    this.eqFilters.push([col, val]);
    return this;
  }
  in(col: string, vals: any[]) {
    this.inFilter = [col, vals];
    return this;
  }
  is(col: string, val: any) {
    this.isFilter = [col, val];
    return this;
  }
  gt(col: string, val: any) {
    this.gtFilters.push([col, val]);
    return this;
  }
  order(col: string) {
    this.orderField = col;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  /**
   * Stub for tests that hit homepage's `.or(...)` query. The real Supabase
   * `.or()` accepts a comma-separated PostgREST filter string; parsing
   * that is out of scope for the fake. Tests that need OR-filtering will
   * need to extend this.
   */
  or(_filter: string) {
    return this;
  }
  maybeSingle() {
    this.terminal = "maybeSingle";
    return this;
  }
  single() {
    this.terminal = "single";
    return this;
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onFulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private applyFilters(rows: any[]): any[] {
    // Real Supabase coerces string params against numeric columns; the
    // scorecard does `.eq("id", roundId)` where roundId is a string from
    // useParams but the column is bigint. Match that behavior with a
    // loose string-equality comparison.
    const looseEq = (a: any, b: any) => a === b || String(a) === String(b);
    let out = rows;
    for (const [c, v] of this.eqFilters) out = out.filter(r => looseEq(r[c], v));
    if (this.inFilter) {
      const [c, vs] = this.inFilter;
      out = out.filter(r => vs.some(v => looseEq(r[c], v)));
    }
    if (this.isFilter) {
      const [c, v] = this.isFilter;
      out = out.filter(r => r[c] === v);
    }
    for (const [c, v] of this.gtFilters) out = out.filter(r => r[c] > v);
    return out;
  }

  private async execute(): Promise<{ data: any; error: any }> {
    const tableRows: any[] = (this.fake.data as any)[this.table];
    if (!tableRows) {
      return { data: this.terminal === "list" ? [] : null, error: null };
    }

    if (this.op === "insert") {
      await this.maybeDelay();
      const created = this.insertPayload.map(r => ({
        ...r,
        id: r.id ?? this.fake._allocId(this.table),
        created_at: r.created_at ?? new Date().toISOString(),
      }));
      const op: WriteOp = { type: "insert", table: this.table, payload: created };
      const idx = this.fake._nextWriteCall();
      this.fake.writes.push(op);
      if (this.fake.options.failWrite?.(op, idx)) {
        return { data: null, error: { message: "fake write failure" } };
      }
      tableRows.push(...created);
      return { data: this.terminal === "list" ? created : created[0], error: null };
    }

    if (this.op === "update") {
      await this.maybeDelay();
      const filtered = this.applyFilters(tableRows);
      const op: WriteOp = {
        type: "update",
        table: this.table,
        filters: [...this.eqFilters, ...(this.isFilter ? [this.isFilter] : [])],
        payload: this.updatePayload,
      };
      const idx = this.fake._nextWriteCall();
      this.fake.writes.push(op);
      if (this.fake.options.failWrite?.(op, idx)) {
        return { data: null, error: { message: "fake write failure" } };
      }
      const updated: any[] = [];
      for (const r of filtered) {
        Object.assign(r, this.updatePayload);
        updated.push(r);
      }
      if (this.terminal === "maybeSingle") return { data: updated[0] ?? null, error: null };
      if (this.terminal === "single") return { data: updated[0] ?? null, error: null };
      return { data: updated, error: null };
    }

    if (this.op === "upsert") {
      await this.maybeDelay();
      const op: WriteOp = {
        type: "upsert",
        table: this.table,
        payload: this.upsertPayload,
        onConflict: this.upsertConflictCols,
      };
      const idx = this.fake._nextWriteCall();
      this.fake.writes.push(op);
      if (this.fake.options.failWrite?.(op, idx)) {
        return { data: null, error: { message: "fake write failure" } };
      }
      const resultRows: any[] = [];
      const cols = this.upsertConflictCols;
      const matchKey = (row: any) =>
        cols.length > 0
          ? cols.map(c => row[c]).join(" ")
          : String(row.id ?? "");
      for (const row of this.upsertPayload) {
        const key = matchKey(row);
        const existing = tableRows.find(r => matchKey(r) === key);
        if (existing) {
          Object.assign(existing, row);
          resultRows.push(existing);
        } else {
          const created = {
            ...row,
            id: row.id ?? this.fake._allocId(this.table),
            created_at: row.created_at ?? new Date().toISOString(),
          };
          tableRows.push(created);
          resultRows.push(created);
        }
      }
      if (this.terminal === "maybeSingle") return { data: resultRows[0] ?? null, error: null };
      if (this.terminal === "single") return { data: resultRows[0] ?? null, error: null };
      return { data: resultRows, error: null };
    }

    // select
    let rows = this.applyFilters([...tableRows]);
    if (this.orderField) {
      const field = this.orderField;
      rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        return av < bv ? -1 : 1;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);

    // Handle relational select: e.g. select(`id, players(name, ...)`)
    // For the scorecard's round_players load, the join is to `players`.
    if (this.table === "round_players" && /players\s*\(/.test(this.selectStr)) {
      rows = rows.map(rp => {
        const player = this.fake.data.players.find(p => p.id === rp.player_id);
        return { ...rp, players: player ?? null };
      });
    }

    if (this.terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    if (this.terminal === "single")
      return { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } };
    return { data: rows, error: null };
  }

  private async maybeDelay() {
    const ms = this.fake.options.writeDelayMs ?? 0;
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
  }
}

/**
 * Build a minimal seed: 1 round with 2_ball format, 2 tees, 18 par-4 holes per tee,
 * 3 round_players assigned to team 1 with tees and course handicaps, optional pre-existing scores.
 */
export function buildSeed(opts?: {
  preExistingScores?: Array<{ round_player_id: number; hole_number: number; strokes: number }>;
}): FakeData {
  const pars = Array.from({ length: 18 }, (_, i) => (i + 1)).map(n => 4); // all par 4 for simplicity
  const holes = [];
  for (const teeId of [1, 2]) {
    for (let n = 1; n <= 18; n++) {
      holes.push({
        id: holes.length + 1,
        tee_id: teeId,
        hole_number: n,
        par: pars[n - 1],
        yardage: 350,
        stroke_index: n,
      });
    }
  }
  const seedScores = (opts?.preExistingScores ?? []).map((s, i) => ({
    id: 1000 + i,
    round_player_id: s.round_player_id,
    hole_number: s.hole_number,
    strokes: s.strokes,
    created_at: new Date().toISOString(),
  }));
  return {
    rounds: [
      {
        id: 1,
        played_on: "2026-05-13",
        course_id: 1,
        is_complete: false,
        format: "2_ball",
        format_config: { basis: "net", best_n: 2, override_holes: [] },
        format_locked_at: "2026-05-13T00:00:00Z",
        created_at: "2026-05-13T00:00:00Z",
      },
    ],
    tees: [
      { id: 1, color: "White", slope_rating: 120, course_rating: 70, par: 72, sort_order: 1 },
      { id: 2, color: "Yellow", slope_rating: 115, course_rating: 68, par: 72, sort_order: 2 },
    ],
    holes,
    round_players: [
      { id: 101, round_id: 1, player_id: 201, tee_id: 1, team_number: 1, course_handicap: 10 },
      { id: 102, round_id: 1, player_id: 202, tee_id: 1, team_number: 1, course_handicap: 12 },
      { id: 103, round_id: 1, player_id: 203, tee_id: 1, team_number: 1, course_handicap: 8 },
    ],
    players: [
      { id: 201, full_name: "Alice A", display_name: "Alice A", handicap_index: 10, preferred_tee_id: 1 },
      { id: 202, full_name: "Bob B", display_name: "Bob B", handicap_index: 12, preferred_tee_id: 1 },
      { id: 203, full_name: "Carol C", display_name: "Carol C", handicap_index: 8, preferred_tee_id: 1 },
    ],
    scores: seedScores,
  };
}
