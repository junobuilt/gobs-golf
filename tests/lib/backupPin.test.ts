// @vitest-environment node
//
// Backup-PIN scrypt hashing (src/lib/backupPin.ts). The hash is anon-readable
// under the repo's allow-all RLS posture, so the PEPPER (ADMIN_COOKIE_SECRET) is
// what keeps a 4-digit hash from being brute-forced — these tests prove the
// pepper is load-bearing, plus the never-store-plaintext invariant.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hashBackupPin, verifyBackupPin } from "@/lib/backupPin";

const SECRET = "test-pepper-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = SECRET;
});
afterEach(() => {
  process.env.ADMIN_COOKIE_SECRET = SECRET;
});

describe("hashBackupPin / verifyBackupPin", () => {
  it("never stores plaintext — output is a scrypt$ string, not the PIN", async () => {
    const stored = await hashBackupPin("1234");
    expect(stored).toMatch(/^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(stored).not.toContain("1234");
  });

  it("round-trips: the minted PIN verifies, a wrong PIN does not", async () => {
    const stored = await hashBackupPin("1234");
    await expect(verifyBackupPin("1234", stored)).resolves.toBe(true);
    await expect(verifyBackupPin("1235", stored)).resolves.toBe(false);
  });

  it("uses a random salt — two hashes of the same PIN differ", async () => {
    const a = await hashBackupPin("0000");
    const b = await hashBackupPin("0000");
    expect(a).not.toBe(b);
    await expect(verifyBackupPin("0000", a)).resolves.toBe(true);
    await expect(verifyBackupPin("0000", b)).resolves.toBe(true);
  });

  it("PEPPER is load-bearing — a hash made under a different secret fails to verify", async () => {
    const stored = await hashBackupPin("1234");
    process.env.ADMIN_COOKIE_SECRET = "a-completely-different-pepper-value-xyz";
    await expect(verifyBackupPin("1234", stored)).resolves.toBe(false);
  });

  it("returns false (never throws) on malformed stored values", async () => {
    await expect(verifyBackupPin("1234", null)).resolves.toBe(false);
    await expect(verifyBackupPin("1234", "")).resolves.toBe(false);
    await expect(verifyBackupPin("1234", "1234")).resolves.toBe(false);
    await expect(verifyBackupPin("1234", "bcrypt$1$aa$bb")).resolves.toBe(false);
    await expect(verifyBackupPin("1234", "scrypt$x$zz$qq")).resolves.toBe(false);
  });

  it("refuses to hash without a pepper", async () => {
    delete process.env.ADMIN_COOKIE_SECRET;
    await expect(hashBackupPin("1234")).rejects.toThrow();
  });
});
