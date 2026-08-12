// @vitest-environment node
//
// GET /api/admin/status — the public-route admin check behind the tournament
// scorecard's Clear button. Runs the SAME two checks the /admin middleware runs
// and returns ONLY { isAdmin }. Fails CLOSED. The adminAuth primitives and the
// cookie jar are mocked so this test pins the ROUTE's branching, not the crypto.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifySession: vi.fn(),
  verifyBackupSession: vi.fn(),
  backupCredentialLive: vi.fn(),
  cookies: new Map<string, string>(),
}));

vi.mock("@/lib/adminAuth", () => ({
  verifySession: h.verifySession,
  verifyBackupSession: h.verifyBackupSession,
  backupCredentialLive: h.backupCredentialLive,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = h.cookies.get(name);
      return v === undefined ? undefined : { value: v };
    },
  }),
}));

import { GET } from "@/app/api/admin/status/route";

async function isAdmin(): Promise<boolean> {
  const res = await GET();
  const body = (await res.json()) as { isAdmin: boolean };
  return body.isAdmin;
}

beforeEach(() => {
  h.verifySession.mockReset().mockResolvedValue(false);
  h.verifyBackupSession.mockReset().mockResolvedValue(null);
  h.backupCredentialLive.mockReset().mockResolvedValue(false);
  h.cookies.clear();
});

describe("GET /api/admin/status", () => {
  it("no cookie → false", async () => {
    await expect(isAdmin()).resolves.toBe(false);
  });

  it("valid primary session → true", async () => {
    h.cookies.set("admin_session", "primary");
    h.verifySession.mockResolvedValue(true);
    await expect(isAdmin()).resolves.toBe(true);
  });

  it("valid backup with a LIVE credential → true", async () => {
    h.cookies.set("admin_backup_session", "backup");
    h.verifyBackupSession.mockResolvedValue({ credId: 5, expiresAtMs: Date.now() + 1000 });
    h.backupCredentialLive.mockResolvedValue(true);
    await expect(isAdmin()).resolves.toBe(true);
  });

  it("valid backup whose credential is REVOKED → false", async () => {
    h.cookies.set("admin_backup_session", "backup");
    h.verifyBackupSession.mockResolvedValue({ credId: 5, expiresAtMs: Date.now() + 1000 });
    h.backupCredentialLive.mockResolvedValue(false); // revoked/superseded
    await expect(isAdmin()).resolves.toBe(false);
  });

  it("EXPIRED backup cookie (verifyBackupSession → null) → false, live-check never consulted", async () => {
    h.cookies.set("admin_backup_session", "backup");
    h.verifyBackupSession.mockResolvedValue(null); // signature/expiry failed
    await expect(isAdmin()).resolves.toBe(false);
    expect(h.backupCredentialLive).not.toHaveBeenCalled();
  });

  it("fails CLOSED when a check throws (route error) → false", async () => {
    h.cookies.set("admin_session", "primary");
    h.verifySession.mockRejectedValue(new Error("boom"));
    await expect(isAdmin()).resolves.toBe(false);
  });
});
