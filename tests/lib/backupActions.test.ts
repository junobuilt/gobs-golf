// @vitest-environment node
//
// mintBackupPin server action (src/app/admin/settings/backupActions.ts). The
// backup-login verify path lives in login/actions.ts (needs next/headers +
// cookies + redirect mocks the repo has no precedent for); the security-critical
// invariants it depends on are proven here at the action + primitive layer:
//   - the stored credential is a peppered scrypt hash, never the plaintext PIN
//   - the minted hash actually verifies with verifyBackupPin (mint ↔ verify tie)
//   - minting SUPERSEDES the prior active credential (revoke-then-insert)
//   - validation rejects non-4-digit PINs and clamps duration to 1/3/7 (default 3)

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── In-memory anon-client mock ───────────────────────────────────────────────
type Op = { table: string; kind: string; payload?: unknown };
const ops: Op[] = [];

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const record = (kind: string, payload?: unknown) => {
    ops.push({ table, kind, payload });
    return chain;
  };
  // Awaitable terminus: resolves to a benign success shape.
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  for (const m of ["update", "insert", "select", "is", "gt", "order", "limit"]) {
    chain[m] = (payload?: unknown) => record(m, payload);
  }
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

import { mintBackupPin } from "@/app/admin/settings/backupActions";
import { verifyBackupPin } from "@/lib/backupPin";

beforeEach(() => {
  ops.length = 0;
  process.env.ADMIN_COOKIE_SECRET =
    "test-pepper-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
});

function fd(pin: string, days?: string) {
  const f = new FormData();
  f.set("pin", pin);
  if (days !== undefined) f.set("days", days);
  return f;
}

describe("mintBackupPin", () => {
  it("rejects a non-4-digit PIN without writing anything", async () => {
    const res = await mintBackupPin(null, fd("12"));
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(ops.length).toBe(0);
  });

  it("stores a peppered scrypt hash (never plaintext) that verifies", async () => {
    const res = await mintBackupPin(null, fd("4821", "7"));
    expect(res?.ok).toBe(true);

    const insert = ops.find((o) => o.kind === "insert");
    expect(insert).toBeTruthy();
    const stored = (insert!.payload as { pin_hash: string }).pin_hash;
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain("4821");
    await expect(verifyBackupPin("4821", stored)).resolves.toBe(true);
    await expect(verifyBackupPin("0000", stored)).resolves.toBe(false);
  });

  it("supersedes the prior active credential — revokes before inserting", async () => {
    await mintBackupPin(null, fd("1234", "3"));
    const updateIdx = ops.findIndex((o) => o.kind === "update");
    const insertIdx = ops.findIndex((o) => o.kind === "insert");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(updateIdx);
    // The revoke stamps revoked_at.
    expect((ops[updateIdx].payload as { revoked_at: string }).revoked_at).toBeTruthy();
  });

  it("honors the chosen duration and clamps unknown values to the 3-day default", async () => {
    const day = 24 * 60 * 60 * 1000;
    const res1 = await mintBackupPin(null, fd("1111", "1"));
    expect(res1?.ok && new Date(res1.expiresAt).getTime() - Date.now()).toBeLessThan(1.1 * day);

    ops.length = 0;
    const resBad = await mintBackupPin(null, fd("1111", "99"));
    expect(resBad?.ok && new Date(resBad.expiresAt).getTime() - Date.now()).toBeGreaterThan(2.9 * day);
    expect(resBad?.ok && new Date(resBad!.expiresAt).getTime() - Date.now()).toBeLessThan(3.1 * day);
  });
});
