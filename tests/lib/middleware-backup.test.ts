// @vitest-environment node
//
// Middleware backup-credential re-check (src/middleware.ts → backupCredentialLive).
// This is the R4 immediate-revoke control: every backup-authenticated request
// re-queries the row, so a revoked/expired credential is denied on the very next
// request. Fails CLOSED on any error (an admin gate denies on doubt).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { backupCredentialLive } from "@/middleware";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(impl: () => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("backupCredentialLive", () => {
  it("GRANTS when the active row is returned (in-window, unrevoked)", async () => {
    mockFetch(() => new Response(JSON.stringify([{ id: 5 }]), { status: 200 }));
    await expect(backupCredentialLive(5)).resolves.toBe(true);
  });

  it("DENIES when no row comes back (revoked or expired — the filters excluded it)", async () => {
    mockFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    await expect(backupCredentialLive(5)).resolves.toBe(false);
  });

  it("filters by id, revoked_at IS NULL, and expires_at > now", async () => {
    const spy = vi.fn(
      () => new Response(JSON.stringify([{ id: 5 }]), { status: 200 })
    );
    mockFetch(spy);
    await backupCredentialLive(5);
    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("id=eq.5");
    expect(url).toContain("revoked_at=is.null");
    expect(url).toContain("expires_at=gt.");
  });

  it("fails CLOSED on a non-OK response", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    await expect(backupCredentialLive(5)).resolves.toBe(false);
  });

  it("fails CLOSED when fetch throws (DB unreachable)", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    await expect(backupCredentialLive(5)).resolves.toBe(false);
  });

  it("fails CLOSED when Supabase env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    mockFetch(() => new Response(JSON.stringify([{ id: 5 }]), { status: 200 }));
    await expect(backupCredentialLive(5)).resolves.toBe(false);
  });
});
