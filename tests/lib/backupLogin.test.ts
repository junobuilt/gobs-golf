// @vitest-environment node
//
// Backup-PIN LOGIN path (src/app/admin/login/actions.ts → tryBackupLogin, via
// src/lib/backupCredentials.ts). This file closes the coverage gap that let the
// v1 single-credential lookup survive into v2 unchallenged.
//
// THE GAP (worth stating, because it is the reason this file exists): before
// v2, `tryBackupLogin` resolved ONE credential — `.order(created_at desc)
// .limit(1)` — and compared the entered PIN against it. Correct while exactly
// one credential could be active; catastrophic once several named people hold a
// PIN at once, because every holder except the most recently created one got
// "Incorrect PIN" with nothing in the logs. NOT ONE existing test would have
// failed: backupPin covers hashing, adminAuth-backup covers cookie signing,
// middleware-backup covers the id-scoped re-check, backupActions covers minting
// — none of them asserts WHICH credential a submitted PIN resolves to. The old
// header in backupActions.test.ts claimed the login path was untestable for want
// of next/headers + cookies + redirect mocks; those mocks are ~20 lines, below.
//
// NEGATIVE CONTROL: the Supabase fake below implements the filters (`is`, `gt`),
// ordering, AND `limit` for real, so restoring the old `.limit(1)` query makes
// these tests FAIL rather than error. Verified by reverting the source before
// committing.

import { describe, it, expect, beforeEach, vi } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Hoisted shared state (vi.mock factories are hoisted above imports) ───────
const h = vi.hoisted(() => ({
  creds: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  cookies: [] as { name: string; value: string; opts: { maxAge?: number } }[],
  redirects: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, opts: { maxAge?: number }) => {
      h.cookies.push({ name, value, opts });
    },
  }),
  headers: async () => ({
    get: (k: string) => (k === "user-agent" ? "vitest-agent" : null),
  }),
}));

// Real `redirect()` throws to halt the action; mirror that so control flow in
// verifyPin behaves as it does in Next.
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    h.redirects.push(target);
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${target};307;`;
    throw err;
  },
}));

// In-memory anon-client fake that APPLIES the filters, so "revoked" / "expired"
// exclusion is exercised by the code under test rather than by the fixture.
vi.mock("@/lib/supabase", () => {
  function from(table: string) {
    if (table === "admin_backup_audit") {
      return {
        insert: async (row: Record<string, unknown>) => {
          h.audit.push(row);
          return { data: null, error: null };
        },
      };
    }

    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let orderKey: string | null = null;
    let ascending = true;
    let limitN: number | null = null;

    const chain: Record<string, unknown> = {
      select: () => chain,
      is: (col: string) => {
        filters.push((r) => r[col] === null || r[col] === undefined);
        return chain;
      },
      gt: (col: string, val: string) => {
        filters.push(
          (r) => new Date(String(r[col])).getTime() > new Date(val).getTime()
        );
        return chain;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderKey = col;
        ascending = opts?.ascending !== false;
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        let out = h.creds.filter((r) => filters.every((f) => f(r)));
        if (orderKey) {
          const key = orderKey;
          out = out.slice().sort((a, b) => {
            const av = new Date(String(a[key])).getTime();
            const bv = new Date(String(b[key])).getTime();
            return ascending ? av - bv : bv - av;
          });
        }
        if (limitN !== null) out = out.slice(0, limitN);
        return resolve({ data: out, error: null });
      },
    };
    return chain;
  }
  return { supabase: { from } };
});

import { verifyPin } from "@/app/admin/login/actions";
import { hashBackupPin } from "@/lib/backupPin";
import { verifyBackupSession } from "@/lib/adminAuth";

beforeEach(() => {
  h.creds.length = 0;
  h.audit.length = 0;
  h.cookies.length = 0;
  h.redirects.length = 0;
  process.env.ADMIN_COOKIE_SECRET =
    "test-pepper-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  // Primary PIN must differ from every backup PIN under test, so the backup
  // path is genuinely the thing being exercised (R6: primary is tried first).
  process.env.ADMIN_PIN = "9999";
});

/** Seed one credential row. `expiresInMs` may be negative (already expired). */
async function seedCred(opts: {
  id: number;
  pin: string;
  expiresInMs: number;
  createdAgoMs?: number;
  revoked?: boolean;
}) {
  h.creds.push({
    id: opts.id,
    pin_hash: await hashBackupPin(opts.pin),
    expires_at: new Date(Date.now() + opts.expiresInMs).toISOString(),
    created_at: new Date(
      Date.now() - (opts.createdAgoMs ?? 0)
    ).toISOString(),
    revoked_at: opts.revoked ? new Date().toISOString() : null,
  });
}

/** Drive the real server action. Returns whether login succeeded. */
async function login(pin: string): Promise<boolean> {
  const fd = new FormData();
  fd.set("pin", pin);
  fd.set("next", "/admin");
  try {
    await verifyPin(null, fd);
    return false; // returned an error state instead of redirecting
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return true;
    throw e;
  }
}

describe("backup-PIN login with multiple simultaneous holders", () => {
  it("authenticates EVERY active holder, not just the newest credential", async () => {
    // Three people, three PINs, three credentials — created at different times
    // so a `created_at desc` LIMIT 1 would resolve only the last one.
    await seedCred({ id: 10, pin: "1111", expiresInMs: 5 * DAY_MS, createdAgoMs: 3 * DAY_MS });
    await seedCred({ id: 11, pin: "2222", expiresInMs: 6 * DAY_MS, createdAgoMs: 2 * DAY_MS });
    await seedCred({ id: 12, pin: "3333", expiresInMs: 7 * DAY_MS, createdAgoMs: 1 * DAY_MS });

    await expect(login("1111")).resolves.toBe(true);
    await expect(login("2222")).resolves.toBe(true);
    await expect(login("3333")).resolves.toBe(true);

    // Each login bound its cookie to its OWN credential.
    const ids = await Promise.all(
      h.cookies.map(async (c) => (await verifyBackupSession(c.value))?.credId)
    );
    expect(ids).toEqual([10, 11, 12]);

    // And audited against that same credential.
    expect(h.audit.map((a) => a.credential_id)).toEqual([10, 11, 12]);
  });

  it("rejects a PIN that matches no active credential", async () => {
    await seedCred({ id: 10, pin: "1111", expiresInMs: 5 * DAY_MS });
    await expect(login("4444")).resolves.toBe(false);
    expect(h.cookies).toHaveLength(0);
    expect(h.audit).toHaveLength(0);
  });

  it("revoking the middle holder leaves the other two working", async () => {
    await seedCred({ id: 10, pin: "1111", expiresInMs: 5 * DAY_MS, createdAgoMs: 3 * DAY_MS });
    await seedCred({ id: 11, pin: "2222", expiresInMs: 6 * DAY_MS, createdAgoMs: 2 * DAY_MS, revoked: true });
    await seedCred({ id: 12, pin: "3333", expiresInMs: 7 * DAY_MS, createdAgoMs: 1 * DAY_MS });

    await expect(login("1111")).resolves.toBe(true);
    await expect(login("2222")).resolves.toBe(false); // revoked
    await expect(login("3333")).resolves.toBe(true);
  });

  it("rejects an EXPIRED credential even though it was never revoked", async () => {
    // Mirrors prod row id=6: revoked_at IS NULL but expires_at already passed.
    await seedCred({ id: 6, pin: "1111", expiresInMs: -1 * DAY_MS });
    await expect(login("1111")).resolves.toBe(false);
    expect(h.cookies).toHaveLength(0);
  });

  it("binds the cookie to the MATCHING credential's expiry, not the newest one's", async () => {
    // The short-window holder logs in while a much longer-lived, more recently
    // created credential also exists. Binding to the wrong row would silently
    // extend this holder's access by 28 days.
    await seedCred({ id: 20, pin: "1111", expiresInMs: 2 * DAY_MS, createdAgoMs: 5 * DAY_MS });
    await seedCred({ id: 21, pin: "2222", expiresInMs: 30 * DAY_MS, createdAgoMs: 1 * DAY_MS });

    await expect(login("1111")).resolves.toBe(true);

    const cookie = h.cookies.at(-1)!;
    expect(cookie.name).toBe("admin_backup_session");

    const decoded = await verifyBackupSession(cookie.value);
    expect(decoded?.credId).toBe(20);

    const expected = new Date(String(h.creds[0].expires_at)).getTime();
    expect(decoded?.expiresAtMs).toBe(expected);

    // R3: maxAge tracks the matching credential's ~2-day window, not 30 days.
    expect(cookie.opts.maxAge).toBeGreaterThan(1.9 * 24 * 60 * 60);
    expect(cookie.opts.maxAge).toBeLessThan(2.1 * 24 * 60 * 60);
  });

  it("leaves the primary PIN path untouched (R6)", async () => {
    await seedCred({ id: 10, pin: "1111", expiresInMs: 5 * DAY_MS });
    await expect(login("9999")).resolves.toBe(true); // ADMIN_PIN
    // Primary issues admin_session, never a backup cookie, and never audits.
    expect(h.cookies.at(-1)!.name).toBe("admin_session");
    expect(h.audit).toHaveLength(0);
  });
});
