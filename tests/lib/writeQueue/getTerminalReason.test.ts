// D.1 — getTerminalReason recognizes the round_finalized failure mode
// (P0001 + message containing 'round_finalized') and returns null for
// everything else. The Sentry log and StaleFailureDialog branch both
// depend on this classifier.

import { describe, it, expect, vi } from "vitest";

// Avoid initializing the Supabase client during the import graph (env
// vars not set in the test environment). The function under test is
// pure and doesn't touch supabase at runtime.
vi.mock("@/lib/supabase", () => ({ supabase: {} as unknown }));

import { getTerminalReason } from "@/lib/writeQueue/instance";

describe("getTerminalReason", () => {
  it("returns 'round_finalized' for the trigger's P0001 error", () => {
    const err = {
      code: "P0001",
      message: "round_finalized",
      hint: "Round is finalized; score writes are rejected.",
    };
    expect(getTerminalReason(err)).toBe("round_finalized");
  });

  it("returns 'round_finalized' when message contains the marker", () => {
    // Defensive: PostgREST sometimes wraps the message. As long as
    // 'round_finalized' appears as a substring, we recognize it.
    const err = {
      code: "P0001",
      message: "ERROR: round_finalized\nCONTEXT: ...",
    };
    expect(getTerminalReason(err)).toBe("round_finalized");
  });

  it("returns null for other P0001 messages", () => {
    const err = {
      code: "P0001",
      message: "some other custom error",
    };
    expect(getTerminalReason(err)).toBeNull();
  });

  it("returns null for unrelated constraint errors", () => {
    const err = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };
    expect(getTerminalReason(err)).toBeNull();
  });

  it("returns null for network / unknown shapes", () => {
    expect(getTerminalReason(null)).toBeNull();
    expect(getTerminalReason(undefined)).toBeNull();
    expect(getTerminalReason("string error")).toBeNull();
    expect(getTerminalReason({})).toBeNull();
  });
});
