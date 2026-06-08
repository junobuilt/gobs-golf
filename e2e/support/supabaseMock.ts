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
    for (const t of KNOWN_TABLES) {
      const rows = (seed as any)[t] ?? [];
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
