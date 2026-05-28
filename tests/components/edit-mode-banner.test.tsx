// @vitest-environment jsdom
//
// Tests for the EditModeBanner component — Phase D.2 conditional Finalize
// vs Done behavior, plus the existing edit-mode gating.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const searchParamsRef = vi.hoisted(() => ({ current: new URLSearchParams("") }));
const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const routeParamsRef = vi.hoisted(() => ({ current: { id: "1" } as Record<string, string> }));

// supabase mock — controls the was_finalized fetch.
const wasFinalizedRef = vi.hoisted(() => ({ current: false as boolean | null }));
const fromMock = vi.hoisted(() => vi.fn());

const finalizeRoundAdminMock = vi.hoisted(() => vi.fn(async (_id: number) => undefined));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/round/1/summary",
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: refreshMock }),
  useParams: () => routeParamsRef.current,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/round/finalizeRoundAdmin", () => ({
  finalizeRoundAdmin: finalizeRoundAdminMock,
}));

function setRoundResponse(row: { was_finalized: boolean; is_complete: boolean } | null) {
  fromMock.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "maybeSingle"];
    methods.forEach(m => {
      chain[m] = vi.fn(() => {
        if (m === "maybeSingle") {
          return Promise.resolve({ data: row, error: null });
        }
        return chain;
      });
    });
    return chain;
  });
}
// Back-compat shim for existing tests: assume is_complete=false (reopened
// state when was_finalized=true; live round when false).
function setWasFinalizedResponse(value: boolean | null) {
  wasFinalizedRef.current = value;
  if (value == null) { setRoundResponse(null); return; }
  setRoundResponse({ was_finalized: value, is_complete: false });
}

import EditModeBanner from "@/components/round/EditModeBanner";

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

beforeEach(() => {
  cleanup();
  replaceMock.mockClear();
  refreshMock.mockClear();
  finalizeRoundAdminMock.mockClear();
  fromMock.mockReset();
  setWasFinalizedResponse(false);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EditModeBanner — gating", () => {
  it("does not render when only ?admin=1 is set", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<EditModeBanner />);
    expect(screen.queryByTestId("edit-mode-banner")).toBeNull();
  });

  it("does not render when only ?edit=1 is set", () => {
    searchParamsRef.current = new URLSearchParams("edit=1");
    render(<EditModeBanner />);
    expect(screen.queryByTestId("edit-mode-banner")).toBeNull();
  });
});

describe("EditModeBanner — Done branch (was_finalized = false)", () => {
  it("renders Done button when was_finalized is false", async () => {
    setWasFinalizedResponse(false);
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    expect(screen.getByTestId("edit-mode-banner")).toBeInTheDocument();
    expect(screen.getByTestId("edit-mode-done-button")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-round-button")).toBeNull();
  });

  it("Done drops only ?edit=1 from the URL", async () => {
    setWasFinalizedResponse(false);
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1&team=2");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    fireEvent.click(screen.getByTestId("edit-mode-done-button"));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href.startsWith("/round/1/summary")).toBe(true);
    const next = new URLSearchParams(href.split("?")[1] ?? "");
    expect(next.has("edit")).toBe(false);
    expect(next.get("admin")).toBe("1");
    expect(next.get("team")).toBe("2");
  });
});

describe("EditModeBanner — Finalize branch (was_finalized = true)", () => {
  it("renders Finalize Round button when was_finalized is true", async () => {
    setWasFinalizedResponse(true);
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    expect(screen.getByTestId("finalize-round-button")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-mode-done-button")).toBeNull();
  });

  it("Finalize tap → DangerModal → Confirm calls finalizeRoundAdmin and drops ?edit=1", async () => {
    setWasFinalizedResponse(true);
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });

    fireEvent.click(screen.getByTestId("finalize-round-button"));
    expect(screen.getByText(/finalize this round\?/i)).toBeInTheDocument();

    // DangerModal has a 1.5s delay before Confirm is tappable.
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });

    fireEvent.click(screen.getByRole("button", { name: /^finalize$/i }));
    await act(async () => { await flushMicrotasks(); });

    expect(finalizeRoundAdminMock).toHaveBeenCalledTimes(1);
    expect(finalizeRoundAdminMock).toHaveBeenCalledWith(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    const next = new URLSearchParams(href.split("?")[1] ?? "");
    expect(next.has("edit")).toBe(false);
  });

  it("Cancel on the Finalize modal closes it without calling finalizeRoundAdmin", async () => {
    setWasFinalizedResponse(true);
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });

    fireEvent.click(screen.getByTestId("finalize-round-button"));
    expect(screen.getByText(/finalize this round\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/finalize this round\?/i)).toBeNull();
    expect(finalizeRoundAdminMock).not.toHaveBeenCalled();
  });
});

describe("EditModeBanner — D1.11 admin edit-in-place (is_complete=true, was_finalized=true)", () => {
  // Regression test for the bug caught in browser verification 2026-05-27:
  // an admin opening a finalized round with ?admin=1&edit=1 was being
  // shown the "Finalize Round" button because the banner only checked
  // was_finalized, not is_complete. The round is still finalized — the
  // banner should show Done (drops ?edit=1) to exit edit mode without
  // re-running the finalize write.
  it("shows Done (not Finalize) when is_complete=true regardless of was_finalized", async () => {
    setRoundResponse({ was_finalized: true, is_complete: true });
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    expect(screen.getByTestId("edit-mode-done-button")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-round-button")).toBeNull();
  });

  it("shows Finalize only when is_complete=false AND was_finalized=true (truly reopened)", async () => {
    setRoundResponse({ was_finalized: true, is_complete: false });
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    expect(screen.getByTestId("finalize-round-button")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-mode-done-button")).toBeNull();
  });

  it("shows Done on a live first-time round (is_complete=false, was_finalized=false)", async () => {
    setRoundResponse({ was_finalized: false, is_complete: false });
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    await act(async () => { await flushMicrotasks(); });
    expect(screen.getByTestId("edit-mode-done-button")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-round-button")).toBeNull();
  });
});
