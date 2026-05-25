// @vitest-environment node
//
// Coverage for the cookie sign/verify helpers used by the /admin PIN gate.
// Runs in Node (uses globalThis.crypto.subtle from Node 20+; no DOM needed).

import { describe, it, expect, beforeEach } from "vitest";
import { signSession, verifySession, timingSafeEqual } from "@/lib/adminAuth";

const SECRET =
  "test-secret-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

beforeEach(() => {
  process.env.ADMIN_COOKIE_SECRET = SECRET;
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
  });
  it("returns false for differing strings of equal length", () => {
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
  });
  it("returns false for differing lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("signSession + verifySession", () => {
  it("round-trip: signSession produces a value verifySession accepts", async () => {
    const value = await signSession();
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    await expect(verifySession(value)).resolves.toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const value = await signSession();
    const [ts, sig] = value.split(".");
    // Flip the last hex char deterministically (stays valid hex).
    const flipped = sig.slice(0, -1) + (sig.slice(-1) === "0" ? "1" : "0");
    await expect(verifySession(`${ts}.${flipped}`)).resolves.toBe(false);
  });

  it("rejects an expired session even with a valid signature", async () => {
    // Hand-build an expired session: sign a past timestamp with the same
    // secret so the HMAC is structurally correct.
    const past = Date.now() - 1000;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(past)));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const expiredValue = `${past}.${hex}`;
    await expect(verifySession(expiredValue)).resolves.toBe(false);
  });

  it("rejects malformed cookies", async () => {
    await expect(verifySession(undefined)).resolves.toBe(false);
    await expect(verifySession(null)).resolves.toBe(false);
    await expect(verifySession("")).resolves.toBe(false);
    await expect(verifySession("nodothere")).resolves.toBe(false);
    await expect(verifySession(".abc")).resolves.toBe(false);
    await expect(verifySession("123.")).resolves.toBe(false);
    // Non-numeric timestamp
    await expect(
      verifySession(
        "abc.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
      )
    ).resolves.toBe(false);
    // Non-hex signature
    await expect(
      verifySession(
        "9999999999999.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
      )
    ).resolves.toBe(false);
    // Wrong-length signature
    await expect(verifySession("9999999999999.abc")).resolves.toBe(false);
  });
});
