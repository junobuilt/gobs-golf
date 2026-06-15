// @vitest-environment node
//
// Backup-session cookie helpers (src/lib/adminAuth.ts). Covers the expiry
// binding (R3), tamper rejection, and the domain separation that stops a
// primary cookie from being replayed as a backup one (and vice-versa).

import { describe, it, expect, beforeEach } from "vitest";
import {
  signSession,
  verifySession,
  signBackupSession,
  verifyBackupSession,
} from "@/lib/adminAuth";

const SECRET =
  "test-secret-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = SECRET;
});

const FUTURE = () => Date.now() + 3 * 24 * 60 * 60 * 1000;

describe("signBackupSession + verifyBackupSession", () => {
  it("round-trips: decodes credId + expiresAtMs for an authentic, unexpired cookie", async () => {
    const exp = FUTURE();
    const value = await signBackupSession(42, exp);
    expect(value).toMatch(/^b\.42\.\d+\.[0-9a-f]{64}$/);
    await expect(verifyBackupSession(value)).resolves.toEqual({
      credId: 42,
      expiresAtMs: exp,
    });
  });

  it("rejects an expired backup cookie even with a valid signature (R3)", async () => {
    const past = Date.now() - 1000;
    const value = await signBackupSession(7, past);
    await expect(verifyBackupSession(value)).resolves.toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const value = await signBackupSession(1, FUTURE());
    const parts = value.split(".");
    const sig = parts[3];
    parts[3] = sig.slice(0, -1) + (sig.slice(-1) === "0" ? "1" : "0");
    await expect(verifyBackupSession(parts.join("."))).resolves.toBeNull();
  });

  it("rejects a forged credId (signature bound to the original cred)", async () => {
    const exp = FUTURE();
    const value = await signBackupSession(1, exp);
    const parts = value.split("."); // b.1.<exp>.<sig>
    parts[1] = "999"; // swap credId, keep the old signature
    await expect(verifyBackupSession(parts.join("."))).resolves.toBeNull();
  });

  it("DOMAIN SEPARATION — a primary session cookie is not a valid backup cookie", async () => {
    const primary = await signSession();
    await expect(verifyBackupSession(primary)).resolves.toBeNull();
  });

  it("DOMAIN SEPARATION — a backup session cookie is not a valid primary cookie", async () => {
    const backup = await signBackupSession(5, FUTURE());
    await expect(verifySession(backup)).resolves.toBe(false);
  });

  it("rejects malformed backup cookies", async () => {
    await expect(verifyBackupSession(undefined)).resolves.toBeNull();
    await expect(verifyBackupSession(null)).resolves.toBeNull();
    await expect(verifyBackupSession("")).resolves.toBeNull();
    await expect(verifyBackupSession("b.1.123")).resolves.toBeNull(); // too few parts
    await expect(verifyBackupSession("x.1.999999999999.aa")).resolves.toBeNull(); // wrong prefix
    await expect(
      verifyBackupSession("b.abc.999999999999." + "a".repeat(64))
    ).resolves.toBeNull(); // non-numeric credId
  });
});
