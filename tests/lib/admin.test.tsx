// @vitest-environment jsdom
//
// Tests for the admin URL flag + edit-mode helpers in src/lib/admin.ts.
// Validates that ?admin=1 / ?edit=1 are correctly read, and that the
// helpers preserve other query params when mutating the URL.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const searchParamsRef = { current: new URLSearchParams("") };

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import {
  useIsAdmin,
  useIsRoundEditMode,
  buildSearchString,
  enterRoundEditMode,
  exitRoundEditMode,
  withAdminFlags,
} from "@/lib/admin";

function ProbeIsAdmin({ onValue }: { onValue: (v: boolean) => void }) {
  onValue(useIsAdmin());
  return null;
}

function ProbeIsEditing({ onValue }: { onValue: (v: boolean) => void }) {
  onValue(useIsRoundEditMode());
  return null;
}

describe("useIsAdmin", () => {
  beforeEach(() => cleanup());

  it("returns true when ?admin=1 is present", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    let value = false;
    render(<ProbeIsAdmin onValue={v => { value = v; }} />);
    expect(value).toBe(true);
  });

  it("returns false when admin param is absent", () => {
    searchParamsRef.current = new URLSearchParams("");
    let value = true;
    render(<ProbeIsAdmin onValue={v => { value = v; }} />);
    expect(value).toBe(false);
  });

  it("returns false for ?admin=0 or other values", () => {
    searchParamsRef.current = new URLSearchParams("admin=0");
    let value = true;
    render(<ProbeIsAdmin onValue={v => { value = v; }} />);
    expect(value).toBe(false);
  });
});

describe("useIsRoundEditMode", () => {
  beforeEach(() => cleanup());

  it("returns true when ?edit=1 is present", () => {
    searchParamsRef.current = new URLSearchParams("edit=1");
    let value = false;
    render(<ProbeIsEditing onValue={v => { value = v; }} />);
    expect(value).toBe(true);
  });

  it("returns false when edit param is absent", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    let value = true;
    render(<ProbeIsEditing onValue={v => { value = v; }} />);
    expect(value).toBe(false);
  });
});

describe("buildSearchString", () => {
  it("returns empty string for empty params + no changes", () => {
    expect(buildSearchString(new URLSearchParams(""), {})).toBe("");
  });

  it("preserves existing params while setting new ones", () => {
    const current = new URLSearchParams("team=2");
    const result = buildSearchString(current, { admin: "1", edit: "1" });
    // Order-insensitive check
    expect(result.startsWith("?")).toBe(true);
    const next = new URLSearchParams(result.slice(1));
    expect(next.get("team")).toBe("2");
    expect(next.get("admin")).toBe("1");
    expect(next.get("edit")).toBe("1");
  });

  it("deletes params when value is null", () => {
    const current = new URLSearchParams("admin=1&edit=1&team=2");
    const result = buildSearchString(current, { edit: null });
    const next = new URLSearchParams(result.slice(1));
    expect(next.has("edit")).toBe(false);
    expect(next.get("admin")).toBe("1");
    expect(next.get("team")).toBe("2");
  });
});

describe("enterRoundEditMode / exitRoundEditMode", () => {
  it("enter calls router.replace with both admin and edit set", () => {
    const replace = vi.fn();
    enterRoundEditMode(
      { replace },
      "/round/5/summary",
      new URLSearchParams("team=3"),
    );
    expect(replace).toHaveBeenCalledTimes(1);
    const href = replace.mock.calls[0][0] as string;
    expect(href.startsWith("/round/5/summary?")).toBe(true);
    const next = new URLSearchParams(href.split("?")[1]);
    expect(next.get("admin")).toBe("1");
    expect(next.get("edit")).toBe("1");
    expect(next.get("team")).toBe("3");
  });

  it("exit drops edit flag but preserves admin and other params", () => {
    const replace = vi.fn();
    exitRoundEditMode(
      { replace },
      "/round/5/scorecard",
      new URLSearchParams("admin=1&edit=1&team=2"),
    );
    const href = replace.mock.calls[0][0] as string;
    const next = new URLSearchParams(href.split("?")[1] ?? "");
    expect(next.has("edit")).toBe(false);
    expect(next.get("admin")).toBe("1");
    expect(next.get("team")).toBe("2");
  });
});

describe("withAdminFlags", () => {
  it("returns href unchanged when neither flag is set", () => {
    const result = withAdminFlags("/round/5/scorecard", new URLSearchParams(""));
    expect(result).toBe("/round/5/scorecard");
  });

  it("appends admin and edit flags to a bare href", () => {
    const result = withAdminFlags(
      "/round/5/scorecard",
      new URLSearchParams("admin=1&edit=1"),
    );
    const search = result.split("?")[1];
    const next = new URLSearchParams(search);
    expect(next.get("admin")).toBe("1");
    expect(next.get("edit")).toBe("1");
  });

  it("merges with existing href query params", () => {
    const result = withAdminFlags(
      "/round/5/scorecard?team=2",
      new URLSearchParams("admin=1"),
    );
    const next = new URLSearchParams(result.split("?")[1]);
    expect(next.get("team")).toBe("2");
    expect(next.get("admin")).toBe("1");
  });
});
