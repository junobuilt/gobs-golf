import { describe, it, expect } from "vitest";
import { backoffMs, STUCK_TOO_LONG_MS } from "@/lib/writeQueue/backoff";

describe("writeQueue/backoff", () => {
  it("returns 0 for attempts <= 0 (immediate first attempt)", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(-1)).toBe(0);
  });

  it("follows the locked schedule from D7", () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(4)).toBe(8_000);
    expect(backoffMs(5)).toBe(16_000);
    expect(backoffMs(6)).toBe(30_000);
    expect(backoffMs(7)).toBe(60_000);
    expect(backoffMs(8)).toBe(120_000);
  });

  it("holds at 120s steady-state beyond attempt 8", () => {
    expect(backoffMs(9)).toBe(120_000);
    expect(backoffMs(100)).toBe(120_000);
    expect(backoffMs(10_000)).toBe(120_000);
  });

  it("exposes STUCK_TOO_LONG_MS at 6 hours", () => {
    expect(STUCK_TOO_LONG_MS).toBe(6 * 60 * 60 * 1000);
  });
});
