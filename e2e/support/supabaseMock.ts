// In-process Supabase mock for Playwright E2E.
//
// WHY THIS EXISTS: GOBS Golf's data layer is Supabase (PostgREST over HTTP).
// The supabase-js client issues plain HTTP to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/*`
// (and `/rpc/*`). By pointing the dev server at a sentinel host and intercepting
// every request to it here, the suite is:
//   1. PROD-SAFE — the dev server is never given the real URL, and any request
//      whose URL contains the prod project ref is aborted AND recorded so the
//      fixture can fail the test (see installSupabaseMock + assertNoProdHits).
//   2. DETERMINISTIC — every response is authored from a per-test in-memory store.
//
// SCOPE / HONEST CAVEAT (CLAUDE.md engineering principle #2): this is a *partial*
// reimplementation of PostgREST semantics. It implements only the query shapes
// the exercised surfaces use (eq / in / is filters, select embeds, count header,
// insert / update / upsert, and the create_team_with_players RPC). The priority
// scenarios are render/modal/wiring bugs whose logic (resolveSmartJoin, the
// modals) runs client-side, so they depend on the SHAPE of round_players — not
// on PostgREST's exact filter algebra. Do NOT treat this mock as a substitute
// for testing real SQL/RPC behavior; the finalize/payout integrity path needs a
// real disposable DB (deferred follow-up).

import type { BrowserContext, Request, Route } from "@playwright/test";
import { PROD_PROJECT_REF } from "../constants";

export type Row = Record<string, any>;

export interface SeedData {
  players?: Row[];
  rounds?: Row[];
  round_players?: Row[];
  scores?: Row[];
  team_scores?: Row[];
  league_settings?: Row[];
  seasons?: Row[];
  tees?: Row[];
  holes?: Row[];
  // Flights (Session 1+). Optional: when absent, the constructor synthesizes one
  // primary Flight A per round (mirroring migration 022's backfill) so existing
  // fixtures resolve format/config/lock off the flight without re-declaring it.
  flights?: Row[];
  flight_teams?: Row[];
  // Blind-draw fills (migration 008). Written by the finalize RPCs; seedable so a
  // finalized round can render a cross-flight draw on the summary.
  blind_draws?: Row[];
  // Backup Admin PIN (migration 028). Written by the mint server action; seedable
  // so a backup-PIN status can be rendered without minting first.
  admin_backup_pin?: Row[];
  admin_backup_audit?: Row[];
}

const KNOWN_TABLES = [
  "players",
  "rounds",
  "round_players",
  "scores",
  // Wave 1B team-card scores. The generic upsert handler already honors the
  // 4-column on_conflict (round_id,team_number,hole_number,ball_index).
  "team_scores",
  "league_settings",
  "seasons",
  "tees",
  "holes",
  // Flights — format ownership lives here (Session 1+).
  "flights",
  "flight_teams",
  // Blind-draw fills (Session 4 finalize writes these).
  "blind_draws",
  // Backup Admin PIN (migration 028).
  "admin_backup_pin",
  "admin_backup_audit",
] as const;

/** An RPC log entry so tests can assert "the RPC fired with these args". */
export interface RpcCall {
  name: string;
  args: Row;
}

export class MockDb {
  tables: Record<string, Row[]> = {};
  rpcCalls: RpcCall[] = [];
  /** Records any request that leaked to the production project ref. */
  prodHits: string[] = [];
  private nextId: Record<string, number> = {};

  constructor(seed: SeedData = {}) {
    // Flights (Session 1): synthesize one primary Flight A per round when the
    // seed doesn't declare flights — the e2e mirror of migration 022's backfill.
    // format/lock copy verbatim; format_config copies all keys EXCEPT the
    // round-level submitted_teams. Lets every existing fixture resolve format
    // off the flight without each spec re-declaring it.
    const effective: SeedData = { ...seed };
    if (!effective.flights) {
      effective.flights = (seed.rounds ?? []).map((r, i) => {
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
    if (!effective.flight_teams) effective.flight_teams = [];

    for (const t of KNOWN_TABLES) {
      const rows = (effective as any)[t] ?? [];
      this.tables[t] = rows.map((r: Row) => ({ ...r }));
      const maxId = this.tables[t].reduce(
        (m, r) => (typeof r.id === "number" && r.id > m ? r.id : m),
        0,
      );
      this.nextId[t] = maxId + 1;
    }
  }

  allocId(table: string): number {
    if (this.nextId[table] == null) this.nextId[table] = 1;
    return this.nextId[table]++;
  }
}

// ── PostgREST request handling ─────────────────────────────────────────────

const looseEq = (a: any, b: any) => a === b || String(a) === String(b);

/** Parse a single PostgREST filter value like "eq.5", "in.(1,2,3)", "is.null". */
function applyParamFilter(rows: Row[], col: string, raw: string): Row[] {
  const dot = raw.indexOf(".");
  if (dot < 0) return rows;
  const op = raw.slice(0, dot);
  const val = raw.slice(dot + 1);
  switch (op) {
    case "eq":
      return rows.filter((r) => looseEq(r[col], val));
    case "neq":
      return rows.filter((r) => !looseEq(r[col], val));
    case "in": {
      const list = val.replace(/^\(/, "").replace(/\)$/, "").split(",").map((s) => s.trim());
      return rows.filter((r) => list.some((v) => looseEq(r[col], v)));
    }
    case "is":
      if (val === "null") return rows.filter((r) => r[col] == null);
      if (val === "true") return rows.filter((r) => r[col] === true);
      if (val === "false") return rows.filter((r) => r[col] === false);
      return rows;
    case "gt":
      return rows.filter((r) => r[col] > Number(val));
    case "gte":
      return rows.filter((r) => r[col] >= Number(val));
    case "lt":
      return rows.filter((r) => r[col] < Number(val));
    case "lte":
      return rows.filter((r) => r[col] <= Number(val));
    default:
      return rows;
  }
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "or", "and"]);

/** Attach a 1:N / 1:1 embed named in the select string (e.g. `players(...)`). */
function applyEmbeds(table: string, select: string, rows: Row[], db: MockDb): Row[] {
  // Only the embeds the app actually requests. round_players embeds players.
  if (table === "round_players" && /players\s*\(/.test(select)) {
    return rows.map((rp) => {
      const player = db.tables.players?.find((p) => looseEq(p.id, rp.player_id)) ?? null;
      return { ...rp, players: player };
    });
  }
  return rows;
}

function tableFromPath(pathname: string): { kind: "rest"; table: string } | { kind: "rpc"; name: string } | null {
  const rest = pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
  if (rest) return { kind: "rpc", name: rest[1] };
  const tbl = pathname.match(/\/rest\/v1\/([^/?]+)/);
  if (tbl) return { kind: "rest", table: tbl[1] };
  return null;
}

function handleRpc(name: string, args: Row, db: MockDb): { status: number; body: any } {
  db.rpcCalls.push({ name, args });

  if (name === "create_team_with_players") {
    const roundId = args.p_round_id;
    const playerIds: number[] = args.p_player_ids ?? [];
    const snapshots: (number | null)[] = args.p_handicap_snapshots ?? [];
    const rps = db.tables.round_players ?? [];
    const maxTeam = rps
      .filter((rp) => looseEq(rp.round_id, roundId))
      .reduce((m, rp) => Math.max(m, rp.team_number ?? 0), 0);
    const newTeam = maxTeam + 1;
    playerIds.forEach((pid, i) => {
      rps.push({
        id: db.allocId("round_players"),
        round_id: roundId,
        player_id: pid,
        team_number: newTeam,
        tee_id: null,
        handicap_index_snapshot: snapshots[i] ?? null,
      });
    });
    // PostgREST returns scalar RPC results as a bare JSON value.
    return { status: 200, body: newTeam };
  }

  // Wave 1B follow-up: relaxed-close finalize for Shambles (migration 020).
  // Replicate the RPC's OBSERVABLE effect for the display layer: a round is
  // finalized iff it exists, isn't already complete, and every assigned team
  // (team_number > 0) has at least one score on every hole 1..18. On success
  // set is_complete = true and return "finalized"; otherwise return the same
  // status strings the scorecard branches on.
  if (name === "finalize_round_relaxed") {
    const roundId = args.p_round_id;
    const round = (db.tables.rounds ?? []).find((r) => looseEq(r.id, roundId));
    if (!round) return { status: 200, body: "round_not_found" };
    if (round.is_complete) return { status: 200, body: "already_complete" };

    const teamRps = (db.tables.round_players ?? []).filter(
      (rp) => looseEq(rp.round_id, roundId) && (rp.team_number ?? 0) > 0,
    );
    // round_player_id -> Set of scored hole numbers (as strings, for loose match).
    const scoredHolesByRp: Record<string, Set<string>> = {};
    for (const s of db.tables.scores ?? []) {
      (scoredHolesByRp[String(s.round_player_id)] ??= new Set()).add(String(s.hole_number));
    }
    const teams = [...new Set(teamRps.map((rp) => rp.team_number))];
    for (const team of teams) {
      const ids = teamRps.filter((rp) => rp.team_number === team).map((rp) => String(rp.id));
      for (let h = 1; h <= 18; h++) {
        const anyScored = ids.some((id) => scoredHolesByRp[id]?.has(String(h)));
        if (!anyScored) return { status: 200, body: "not_yet" };
      }
    }
    round.is_complete = true;
    return { status: 200, body: "finalized" };
  }

  // Phase 1C: team-card finalize (migration 021). Finalized iff the round
  // exists, isn't already complete, and every assigned team has a `team_scores`
  // row on every hole 1..18 (one team ball per hole — no per-player gaps).
  if (name === "finalize_round_team_card") {
    const roundId = args.p_round_id;
    const round = (db.tables.rounds ?? []).find((r) => looseEq(r.id, roundId));
    if (!round) return { status: 200, body: "round_not_found" };
    if (round.is_complete) return { status: 200, body: "already_complete" };

    const teams = [
      ...new Set(
        (db.tables.round_players ?? [])
          .filter((rp) => looseEq(rp.round_id, roundId) && (rp.team_number ?? 0) > 0)
          .map((rp) => rp.team_number),
      ),
    ];
    // team_number -> Set of scored hole numbers (strings, for loose match).
    const scoredHolesByTeam: Record<string, Set<string>> = {};
    for (const ts of db.tables.team_scores ?? []) {
      if (!looseEq(ts.round_id, roundId)) continue;
      (scoredHolesByTeam[String(ts.team_number)] ??= new Set()).add(String(ts.hole_number));
    }
    for (const team of teams) {
      const scored = scoredHolesByTeam[String(team)];
      for (let h = 1; h <= 18; h++) {
        if (!scored?.has(String(h))) return { status: 200, body: "not_yet" };
      }
    }
    round.is_complete = true;
    return { status: 200, body: "finalized" };
  }

  // Flights S4: flight-aware finalize (migration 024). Faithful JS mirror of the
  // RPC's OBSERVABLE effect for the display layer — used only for MULTI-flight
  // rounds (the client routes single-flight rounds to the per-format RPCs above).
  //   * Resolve each team to its flight (canonical default rule: no flight_teams
  //     row → the round's lowest-sort_order flight).
  //   * PER-FLIGHT completion floor by format family (strict / relaxed / team-card).
  //   * SHORT teams are PER-FLIGHT (max roster IN ITS OWN flight); only strict
  //     best-N flights generate slots. Draws fill from the round-wide pool of
  //     fully-18-scored, non-dropped, non-team-card players, no collisions.
  //   * Flip is_complete; write blind_draws rows.
  // NOTE: the draw PICK here is a simple deterministic first-eligible choice (the
  // mock can't replicate Postgres setseed/random); reproducibility/order are the
  // SQL's job, verified by the migration-024 relay dry-run on prod. The Playwright
  // lifecycle test uses internally-even flights (zero slots → zero draws), so the
  // pick logic isn't exercised — the floors + routing + is_complete flip are.
  if (name === "finalize_round_flights") {
    const roundId = args.p_round_id;
    const round = (db.tables.rounds ?? []).find((r) => looseEq(r.id, roundId));
    if (!round) return { status: 200, body: "round_not_found" };
    if (round.is_complete) return { status: 200, body: "already_complete" };

    const flights = (db.tables.flights ?? [])
      .filter((f) => looseEq(f.round_id, roundId))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const firstFlightId = flights[0]?.id;
    const ft = (db.tables.flight_teams ?? []).filter((t) => looseEq(t.round_id, roundId));
    const rps = (db.tables.round_players ?? []).filter(
      (rp) => looseEq(rp.round_id, roundId) && (rp.team_number ?? 0) > 0,
    );
    const familyOf = (format: any): "team_card" | "relaxed" | "strict" =>
      format === "texas_scramble" || format === "alternate_shot" ? "team_card"
        : format === "shambles" || format === "par_competition" ? "relaxed" : "strict";
    const flightOfTeam = (tn: any) => {
      const explicit = ft.find((t) => looseEq(t.team_number, tn));
      const fid = explicit ? explicit.flight_id : firstFlightId;
      return flights.find((fl) => looseEq(fl.id, fid)) ?? flights[0];
    };

    const teamNums = [...new Set(rps.map((rp) => rp.team_number))];
    const scoredHolesByRp: Record<string, Set<string>> = {};
    for (const s of db.tables.scores ?? []) {
      (scoredHolesByRp[String(s.round_player_id)] ??= new Set()).add(String(s.hole_number));
    }
    const scoredHolesByTeam: Record<string, Set<string>> = {};
    for (const ts of db.tables.team_scores ?? []) {
      if (!looseEq(ts.round_id, roundId)) continue;
      (scoredHolesByTeam[String(ts.team_number)] ??= new Set()).add(String(ts.hole_number));
    }

    // Per-flight completion floor.
    for (const tn of teamNums) {
      const fam = familyOf(flightOfTeam(tn)?.format);
      const teamRps = rps.filter((rp) => rp.team_number === tn);
      if (fam === "strict") {
        for (const rp of teamRps) {
          const cap = rp.dropped_after_hole ?? 18;
          for (let h = 1; h <= cap; h++) {
            if (!scoredHolesByRp[String(rp.id)]?.has(String(h))) return { status: 200, body: "not_yet" };
          }
        }
      } else if (fam === "relaxed") {
        for (let h = 1; h <= 18; h++) {
          const any = teamRps.some((rp) => scoredHolesByRp[String(rp.id)]?.has(String(h)));
          if (!any) return { status: 200, body: "not_yet" };
        }
      } else { // team_card
        for (let h = 1; h <= 18; h++) {
          if (!scoredHolesByTeam[String(tn)]?.has(String(h))) return { status: 200, body: "not_yet" };
        }
      }
    }

    // Per-flight shortness: max roster within each flight; slots only for strict.
    const rosterOf = (tn: any) => rps.filter((rp) => rp.team_number === tn).length;
    const dropoutsOf = (tn: any) => rps.filter((rp) => rp.team_number === tn && rp.dropped_after_hole != null).length;
    const flightMax: Record<string, number> = {};
    for (const tn of teamNums) {
      if (familyOf(flightOfTeam(tn)?.format) !== "strict") continue;
      const fid = String(flightOfTeam(tn)?.id);
      flightMax[fid] = Math.max(flightMax[fid] ?? 0, rosterOf(tn));
    }

    // Round-wide eligible pool: non-team-card, not dropped, full 1..18 scores.
    const pool = rps
      .filter((rp) => familyOf(flightOfTeam(rp.team_number)?.format) !== "team_card"
        && rp.dropped_after_hole == null
        && (scoredHolesByRp[String(rp.id)]?.size ?? 0) >= 18)
      .map((rp) => rp.id)
      .sort((a, b) => Number(a) - Number(b));

    const draws: Array<{ team: any; start: number }> = [];
    for (const tn of [...teamNums].sort((a, b) => Number(a) - Number(b))) {
      const f = flightOfTeam(tn);
      if (familyOf(f?.format) !== "strict") continue;
      const startSlots = (flightMax[String(f?.id)] ?? 0) - rosterOf(tn);
      for (let i = 0; i < startSlots; i++) draws.push({ team: tn, start: 1 });
      for (const rp of rps.filter((r) => r.team_number === tn && r.dropped_after_hole != null)) {
        draws.push({ team: tn, start: (rp.dropped_after_hole as number) + 1 });
      }
    }

    if (draws.length > pool.length) return { status: 200, body: "pool_too_small" };

    const available = [...pool];
    db.tables.blind_draws ??= [];
    for (const d of draws) {
      const teamRosterIds = rps.filter((rp) => rp.team_number === d.team).map((rp) => String(rp.id));
      const idx = available.findIndex((id) => !teamRosterIds.includes(String(id)));
      if (idx < 0) return { status: 200, body: "pool_too_small" };
      const pickedRpId = available.splice(idx, 1)[0];
      const drawnPlayerId = rps.find((rp) => looseEq(rp.id, pickedRpId))?.player_id;
      db.tables.blind_draws.push({
        id: db.allocId("blind_draws"),
        round_id: roundId,
        short_team_number: d.team,
        drawn_player_id: drawnPlayerId,
        hole_range_start: d.start,
        hole_range_end: 18,
        random_seed: 1,
      });
    }

    round.is_complete = true;
    return { status: 200, body: "finalized" };
  }

  // Unknown RPC — succeed benignly so unrelated flows don't crash.
  return { status: 200, body: null };
}

async function handleRest(
  method: string,
  table: string,
  url: URL,
  bodyText: string,
  headers: Record<string, string>,
  db: MockDb,
): Promise<{ status: number; body: any; contentRange?: string }> {
  const rows = db.tables[table] ?? (db.tables[table] = []);
  const params = url.searchParams;
  const select = params.get("select") ?? "*";
  const wantsRepresentation = (headers["prefer"] ?? "").includes("return=representation");

  if (method === "POST") {
    const isUpsert = (headers["prefer"] ?? "").includes("resolution=merge-duplicates");
    const payload = bodyText ? JSON.parse(bodyText) : [];
    const incoming: Row[] = Array.isArray(payload) ? payload : [payload];
    const onConflict = (params.get("on_conflict") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const out: Row[] = [];
    for (const r of incoming) {
      if (isUpsert && onConflict.length > 0) {
        const match = rows.find((existing) => onConflict.every((c) => looseEq(existing[c], r[c])));
        if (match) {
          // ignoreDuplicates → leave as-is; otherwise merge.
          if (!(headers["prefer"] ?? "").includes("resolution=ignore-duplicates")) {
            Object.assign(match, r);
          }
          out.push(match);
          continue;
        }
      }
      const created = { id: r.id ?? db.allocId(table), ...r };
      rows.push(created);
      out.push(created);
    }
    return { status: 201, body: wantsRepresentation ? out : null };
  }

  if (method === "PATCH") {
    let target = [...rows];
    for (const [k, v] of params.entries()) {
      if (RESERVED.has(k)) continue;
      target = applyParamFilter(target, k, v);
    }
    const patch = bodyText ? JSON.parse(bodyText) : {};
    for (const r of target) Object.assign(r, patch);
    return { status: 200, body: wantsRepresentation ? target : null };
  }

  if (method === "DELETE") {
    let toDelete = [...rows];
    for (const [k, v] of params.entries()) {
      if (RESERVED.has(k)) continue;
      toDelete = applyParamFilter(toDelete, k, v);
    }
    db.tables[table] = rows.filter((r) => !toDelete.includes(r));
    return { status: 200, body: wantsRepresentation ? toDelete : null };
  }

  // GET / HEAD (select). Apply column filters (eq/in/is/...). `or=` is ignored
  // by design — per-test stores only hold rows relevant to the scenario.
  let result = [...rows];
  for (const [k, v] of params.entries()) {
    if (RESERVED.has(k)) continue;
    result = applyParamFilter(result, k, v);
  }
  result = applyEmbeds(table, select, result, db);

  // order=col.asc/desc — needed by the flights resolver (order=sort_order.asc).
  const orderRaw = params.get("order");
  if (orderRaw) {
    const [col, dir] = orderRaw.split(".");
    const asc = dir !== "desc";
    result = [...result].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return asc ? cmp : -cmp;
    });
  }
  // limit=N — getPrimaryFlightForRound uses order=sort_order.asc&limit=1.
  const limitRaw = params.get("limit");
  if (limitRaw) {
    const n = parseInt(limitRaw, 10);
    if (Number.isFinite(n)) result = result.slice(0, n);
  }

  const total = result.length;
  const contentRange = total > 0 ? `0-${total - 1}/${total}` : `*/0`;
  return { status: 200, body: method === "HEAD" ? null : result, contentRange };
}

export async function fulfillFromMock(route: Route, request: Request, db: MockDb): Promise<void> {
  const url = new URL(request.url());
  const target = tableFromPath(url.pathname);
  const method = request.method().toUpperCase();
  const headers = request.headers();

  if (!target) {
    // Non-REST supabase endpoints (auth, realtime, storage) — succeed empty.
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return;
  }

  let res: { status: number; body: any; contentRange?: string };
  try {
    if (target.kind === "rpc") {
      const args = request.postData() ? JSON.parse(request.postData()!) : {};
      res = handleRpc(target.name, args, db);
    } else {
      res = await handleRest(method, target.table, url, request.postData() ?? "", headers, db);
    }
  } catch (err) {
    res = { status: 500, body: { message: `mock error: ${(err as Error).message}` } };
  }

  // PostgREST single-object negotiation. `.single()` / `.maybeSingle()` send
  // Accept: application/vnd.pgrst.object+json, and real PostgREST then returns a
  // bare object (or null for 0 rows), NOT an array. postgrest-js only
  // array-unwraps client-side for `.maybeSingle()` — `.single()` (e.g.
  // loadRoundResults reading `rounds`) trusts the server shape, so without this
  // it would read fields off an array. Mirror the server for REST reads.
  if (target.kind === "rest" && Array.isArray(res.body)) {
    const accept = headers["accept"] ?? "";
    if (accept.includes("application/vnd.pgrst.object+json")) {
      res.body = res.body.length > 0 ? res.body[0] : null;
    }
  }

  const respHeaders: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };
  if (res.contentRange) respHeaders["content-range"] = res.contentRange;

  await route.fulfill({
    status: res.status,
    headers: respHeaders,
    body: res.body == null ? "" : JSON.stringify(res.body),
  });
}

/**
 * Install Supabase interception + the prod-safety guard on a Playwright context.
 * Returns the MockDb so tests/global-setup can seed and assert against it.
 */
export async function installSupabaseMock(context: BrowserContext, db: MockDb): Promise<void> {
  // Hard prod guard: abort and record any request that reaches the prod ref.
  await context.route(`**${PROD_PROJECT_REF}**`, async (route, request) => {
    db.prodHits.push(request.url());
    await route.abort();
  });

  // Everything to the sentinel Supabase host is served by the mock.
  await context.route("https://e2e-supabase.local/**", (route, request) =>
    fulfillFromMock(route, request, db),
  );
}

/** Throw if any request leaked to production. Call in fixture teardown. */
export function assertNoProdHits(db: MockDb): void {
  if (db.prodHits.length > 0) {
    throw new Error(
      `PROD SAFETY VIOLATION: ${db.prodHits.length} request(s) hit the production project ref:\n` +
        db.prodHits.map((u) => `  - ${u}`).join("\n"),
    );
  }
}
