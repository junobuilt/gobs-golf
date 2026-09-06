// @vitest-environment node
//
// Backup Admin PIN v2 server actions (src/app/admin/settings/backupActions.ts):
// mint (now player-scoped, calendar-expiry), list, revoke.
//
// v1's header claimed the backup-LOGIN verify path was untestable for want of
// next/headers + cookies + redirect mocks. That is no longer true and no longer
// this file's problem: the login path — including which credential a submitted
// PIN resolves to — is covered by tests/lib/backupLogin.test.ts. This file
// covers the assign/list/revoke side.
//
// The fake below applies filters, ordering, insert and update for real, so
// "excludes revoked", "excludes expired" and "does not revoke on mint" are
// exercised by the code under test rather than by a pre-shaped fixture.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  creds: [] as Record<string, unknown>[],
  players: [] as Record<string, unknown>[],
  updates: [] as { match: Record<string, unknown>; payload: Record<string, unknown> }[],
  nextId: 100,
}));

vi.mock("@/lib/supabase", () => {
  function from(table: string) {
    const source = () => (table === "players" ? h.players : h.creds);
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let orderKey: string | null = null;
    let ascending = true;
    let limitN: number | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    const matchDesc: Record<string, unknown> = {};

    const run = () => {
      let out = source().filter((r) => filters.every((f) => f(r)));
      if (orderKey) {
        const key = orderKey;
        out = out.slice().sort((a, b) => {
          const av = new Date(String(a[key])).getTime();
          const bv = new Date(String(b[key])).getTime();
          return ascending ? av - bv : bv - av;
        });
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        matchDesc[col] = val;
        filters.push((r) => String(r[col]) === String(val));
        return chain;
      },
      is: (col: string) => {
        matchDesc[col] = null;
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
      insert: async (row: Record<string, unknown>) => {
        h.creds.push({
          id: h.nextId++,
          created_at: new Date().toISOString(),
          revoked_at: null,
          ...row,
        });
        return { data: null, error: null };
      },
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (updatePayload) {
          const targets = run();
          h.updates.push({ match: { ...matchDesc }, payload: updatePayload });
          for (const t of targets) Object.assign(t, updatePayload);
          return resolve({ data: targets, error: null });
        }
        return resolve({ data: run(), error: null });
      },
    };
    return chain;
  }
  return { supabase: { from } };
});

import {
  mintBackupPin,
  listBackupPins,
  revokeBackupPin,
} from "@/app/admin/settings/backupActions";
import { verifyBackupPin } from "@/lib/backupPin";
import { endOfDayVancouverISO } from "@/lib/date";

// Pinned "now": 2026-09-05 18:00 Vancouver (= 2026-09-06 01:00Z). Deliberately
// an evening hour, when the UTC date is ALREADY TOMORROW — the case that breaks
// a naive past-date check and would reject a same-day PIN.
const NOW = new Date("2026-09-06T01:00:00.000Z");
const TODAY_VANCOUVER = "2026-09-05";

beforeEach(async () => {
  h.creds.length = 0;
  h.players.length = 0;
  h.updates.length = 0;
  h.nextId = 100;
  process.env.ADMIN_COOKIE_SECRET =
    "test-pepper-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  // Fake only Date — scrypt's callback comes off the libuv threadpool, not a timer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  h.players.push(
    { id: 1, full_name: "John Doe", is_active: true },
    { id: 2, full_name: "Mary Roe", is_active: true },
    { id: 3, full_name: "Gone Fishing", is_active: false }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function assign(over: Partial<Record<string, string>> = {}) {
  return mintBackupPin(
    null,
    fd({
      pin: "1234",
      player_id: "1",
      expires_on: "2026-10-05",
      ...over,
    } as Record<string, string>)
  );
}

/** Seed an existing credential directly. */
async function seedCred(row: Record<string, unknown>) {
  const { hashBackupPin } = await import("@/lib/backupPin");
  h.creds.push({
    id: h.nextId++,
    pin_hash: row.pin ? await hashBackupPin(String(row.pin)) : "scrypt$1$aa$bb",
    created_at: new Date(Date.now() - DAY_MS).toISOString(),
    revoked_at: null,
    player_id: null,
    holder_name: null,
    expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
    ...row,
  });
}

describe("mintBackupPin — validation", () => {
  it("rejects a non-4-digit PIN without writing anything", async () => {
    const res = await assign({ pin: "12" });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(h.creds).toHaveLength(0);
  });

  it("rejects a date in the past", async () => {
    const res = await assign({ expires_on: "2026-09-04" });
    expect(res?.ok).toBe(false);
    expect(h.creds).toHaveLength(0);
  });

  it("ACCEPTS today's date — a same-day PIN must be possible", async () => {
    // The admin is at the course handing a PIN to a substitute for that day.
    const res = await assign({ expires_on: TODAY_VANCOUVER });
    expect(res?.ok).toBe(true);
    // And it really does grant the rest of the day, not zero seconds.
    expect(res?.ok && new Date(res.expiresAt).getTime()).toBeGreaterThan(
      NOW.getTime()
    );
  });

  it("rejects a date more than one year out, accepts one exactly a year out", async () => {
    expect((await assign({ expires_on: "2027-09-06" }))?.ok).toBe(false);
    h.creds.length = 0;
    expect((await assign({ expires_on: "2027-09-05" }))?.ok).toBe(true);
  });

  it("rejects a malformed or unreal date", async () => {
    expect((await assign({ expires_on: "" }))?.ok).toBe(false);
    expect((await assign({ expires_on: "2026-02-30" }))?.ok).toBe(false);
    expect(h.creds).toHaveLength(0);
  });

  it("rejects a missing player and an inactive one", async () => {
    expect((await assign({ player_id: "999" }))?.ok).toBe(false);
    expect((await assign({ player_id: "3" }))?.ok).toBe(false); // is_active false
    expect((await assign({ player_id: "" }))?.ok).toBe(false);
    expect(h.creds).toHaveLength(0);
  });
});

describe("mintBackupPin — one person, one PIN", () => {
  it("rejects a second PIN for a player who already holds one, naming the expiry", async () => {
    await seedCred({
      player_id: 1,
      holder_name: "John Doe",
      expires_at: endOfDayVancouverISO("2027-08-29")!,
    });
    const res = await assign({ pin: "5678" });
    expect(res?.ok).toBe(false);
    expect(res?.ok === false && res.error).toBe(
      "John Doe already has a PIN (expires August 29, 2027). Remove it first."
    );
    expect(h.creds).toHaveLength(1); // nothing added
  });

  it("does NOT count a revoked or expired credential as already-held", async () => {
    await seedCred({ player_id: 1, holder_name: "John Doe", revoked_at: new Date().toISOString() });
    await seedCred({
      player_id: 1,
      holder_name: "John Doe",
      expires_at: new Date(Date.now() - DAY_MS).toISOString(),
    });
    expect((await assign())?.ok).toBe(true);
  });

  it("the NULL-player_id pre-upgrade row blocks nobody", async () => {
    await seedCred({ player_id: null, holder_name: null }); // the live pre-upgrade credential
    expect((await assign({ player_id: "1" }))?.ok).toBe(true);
    expect((await assign({ player_id: "2", pin: "4321" }))?.ok).toBe(true);
  });
});

describe("mintBackupPin — PIN collisions", () => {
  it("rejects a PIN already in use by an active credential", async () => {
    await seedCred({ pin: "1234", player_id: 2, holder_name: "Mary Roe" });
    const res = await assign({ pin: "1234", player_id: "1" });
    expect(res?.ok).toBe(false);
    expect(res?.ok === false && res.error).toBe(
      "That PIN is already in use. Choose different digits."
    );
  });

  it("allows a PIN whose only other use is on a revoked credential", async () => {
    await seedCred({ pin: "1234", player_id: 2, revoked_at: new Date().toISOString() });
    expect((await assign({ pin: "1234" }))?.ok).toBe(true);
  });
});

describe("mintBackupPin — writes", () => {
  it("stores a peppered scrypt hash (never plaintext) that verifies", async () => {
    const res = await assign({ pin: "4821" });
    expect(res?.ok).toBe(true);
    const stored = String(h.creds[0].pin_hash);
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain("4821");
    await expect(verifyBackupPin("4821", stored)).resolves.toBe(true);
    await expect(verifyBackupPin("0000", stored)).resolves.toBe(false);
  });

  it("snapshots the holder's full name and links the player", async () => {
    const res = await assign({ player_id: "2" });
    expect(res?.ok && res.holderName).toBe("Mary Roe");
    expect(h.creds[0].holder_name).toBe("Mary Roe");
    expect(h.creds[0].player_id).toBe(2);
  });

  it("does NOT revoke existing credentials — v1's supersede behavior is GONE", async () => {
    // This is the behavioral heart of v2: several holders coexist.
    await seedCred({ player_id: 2, holder_name: "Mary Roe", pin: "9876" });
    const before = h.creds[0].revoked_at;

    expect((await assign({ player_id: "1", pin: "1234" }))?.ok).toBe(true);

    expect(h.creds[0].revoked_at).toBe(before);
    expect(h.creds[0].revoked_at).toBeNull();
    expect(h.creds).toHaveLength(2);
    // No UPDATE was issued at all during a mint.
    expect(h.updates).toHaveLength(0);
  });
});

describe("expiry resolves to end-of-day Vancouver", () => {
  it("keeps a PIN valid all day on its date in summer (PDT)", async () => {
    const res = await assign({ expires_on: "2027-08-29" });
    expect(res?.ok && res.expiresAt).toBe("2027-08-30T06:59:59.999Z");
  });

  it("and in winter (PST) — one hour later in UTC across the DST boundary", async () => {
    const res = await assign({ expires_on: "2027-01-15" });
    expect(res?.ok && res.expiresAt).toBe("2027-01-16T07:59:59.999Z");
  });

  it("resolves both sides of the spring-forward and fall-back days", async () => {
    expect(endOfDayVancouverISO("2027-03-14")).toBe("2027-03-15T06:59:59.999Z"); // DST starts
    expect(endOfDayVancouverISO("2027-03-13")).toBe("2027-03-14T07:59:59.999Z");
    expect(endOfDayVancouverISO("2027-11-07")).toBe("2027-11-08T07:59:59.999Z"); // DST ends
    expect(endOfDayVancouverISO("2027-11-06")).toBe("2027-11-07T06:59:59.999Z");
  });
});

describe("listBackupPins", () => {
  it("returns active holders soonest-expiry-first and NEVER a hash", async () => {
    await seedCred({
      player_id: 1, holder_name: "John Doe",
      expires_at: new Date(Date.now() + 9 * DAY_MS).toISOString(),
    });
    await seedCred({
      player_id: 2, holder_name: "Mary Roe",
      expires_at: new Date(Date.now() + 2 * DAY_MS).toISOString(),
    });

    const list = await listBackupPins();
    expect(list.map((r) => r.holderName)).toEqual(["Mary Roe", "John Doe"]);
    for (const row of list) {
      expect(Object.keys(row)).not.toContain("pin_hash");
      expect(JSON.stringify(row)).not.toContain("scrypt");
    }
  });

  it("excludes revoked and expired credentials without deleting them", async () => {
    await seedCred({ holder_name: "Active", player_id: 1 });
    await seedCred({ holder_name: "Revoked", player_id: 2, revoked_at: new Date().toISOString() });
    await seedCred({
      holder_name: "Expired", player_id: 2,
      expires_at: new Date(Date.now() - DAY_MS).toISOString(),
    });

    const list = await listBackupPins();
    expect(list.map((r) => r.holderName)).toEqual(["Active"]);
    // The rows survive — admin_backup_audit.credential_id references them.
    expect(h.creds).toHaveLength(3);
  });

  it("reports the pre-upgrade credential as holderName null", async () => {
    await seedCred({ player_id: null, holder_name: null });
    const list = await listBackupPins();
    expect(list[0].holderName).toBeNull();
    expect(list[0].playerId).toBeNull();
    expect(list[0].createdAt).toBeTruthy(); // the UI shows this instead of a name
  });

  it("KEEPS a removed player's name — a null player_id alone is not 'pre-upgrade'", async () => {
    // players.id is FK'd ON DELETE SET NULL, so deactivating/removing a player
    // nulls player_id while holder_name survives. Branding the pre-upgrade row
    // off player_id would relabel a real, named holder as "Unnamed" and leave
    // the admin unable to tell who is holding that credential.
    await seedCred({ player_id: null, holder_name: "John Doe" });
    const list = await listBackupPins();
    expect(list[0].holderName).toBe("John Doe");
    expect(list[0].playerId).toBeNull();
  });
});

describe("revokeBackupPin", () => {
  it("revokes exactly one credential by id and leaves the others alone", async () => {
    await seedCred({ player_id: 1, holder_name: "John Doe" });
    await seedCred({ player_id: 2, holder_name: "Mary Roe" });
    const target = Number(h.creds[0].id);

    const res = await revokeBackupPin(target);
    expect(res.ok).toBe(true);

    expect(h.creds[0].revoked_at).toBeTruthy();
    expect(h.creds[1].revoked_at).toBeNull();

    const list = await listBackupPins();
    expect(list.map((r) => r.holderName)).toEqual(["Mary Roe"]);
  });

  it("scopes the update by id — never 'the active one'", async () => {
    await seedCred({ player_id: 1 });
    await revokeBackupPin(Number(h.creds[0].id));
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].match).toHaveProperty("id");
  });
});
