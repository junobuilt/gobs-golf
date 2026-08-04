// The admin-preview server action (migration 040). It reuses the SAME auth the
// /admin middleware uses (verifySession over the signed cookies) and fails
// CLOSED: with no valid admin cookie — the state of any player request — it must
// return false so the preview doorway stays shut. Outside a request scope
// `cookies()` throws; the action must swallow that and return false, never throw.

import { describe, it, expect } from "vitest";
import { isAdminSession } from "@/app/tournament/adminPreview";

describe("isAdminSession — fail closed", () => {
  it("returns false (not admin) when no admin session is present", async () => {
    // No request scope / no admin_session cookie → the gate denies.
    await expect(isAdminSession()).resolves.toBe(false);
  });
});
