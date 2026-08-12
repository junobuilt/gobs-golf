// @vitest-environment node
//
// The /admin gate still fails closed after backupCredentialLive moved to
// adminAuth: a request to /admin with NO admin cookie redirects to
// /admin/login (with the original path preserved as ?next=). Guards the extract
// refactor — the middleware's behavior must be unchanged.

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware /admin gate", () => {
  it("redirects to /admin/login when there is no session", async () => {
    const req = new NextRequest("https://gobs.example.com/admin");
    const res = await middleware(req);
    expect(res.status).toBe(307); // NextResponse.redirect default
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/admin/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("lets /admin/login through without a session (no redirect loop)", async () => {
    const req = new NextRequest("https://gobs.example.com/admin/login");
    const res = await middleware(req);
    // NextResponse.next() → not a redirect (no location header).
    expect(res.headers.get("location")).toBeNull();
  });
});
