// @vitest-environment jsdom
//
// Tests for the admin Edit Round Scores button on the round summary
// header (rendered by RoundResultsView), including the DangerModal
// confirmation flow and its navigation to the scorecard with edit mode.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { LoadedRoundResults } from "@/lib/round/results";

const searchParamsRef = { current: new URLSearchParams("") };
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/round/7/summary",
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

// FormatChip pulls in Supabase; stub it so we don't need a fake.
vi.mock("@/components/format/FormatChip", () => ({
  default: () => null,
}));

import RoundResultsView from "@/components/round/RoundResultsView";

function buildResults(opts: { isComplete: boolean }): LoadedRoundResults {
  return {
    playedOn: "2026-05-17",
    isComplete: opts.isComplete,
    roundId: 7,
    format: "2_ball",
    formatConfig: { basis: "net", best_n: 2, override_holes: [] } as any,
    formatLocked: true,
    teams: [],
    maxThru: 18,
  };
}

beforeEach(() => {
  cleanup();
  replaceMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RoundResultsView — Edit Round Scores button", () => {
  it("renders the button when round is complete and ?admin=1", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<RoundResultsView data={buildResults({ isComplete: true })} />);
    expect(screen.getByTestId("edit-round-scores-button")).toBeInTheDocument();
  });

  it("hides the button when round is complete but ?admin is missing", () => {
    searchParamsRef.current = new URLSearchParams("");
    render(<RoundResultsView data={buildResults({ isComplete: true })} />);
    expect(screen.queryByTestId("edit-round-scores-button")).toBeNull();
  });

  it("hides the button when round is not complete (even with ?admin=1)", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<RoundResultsView data={buildResults({ isComplete: false })} />);
    expect(screen.queryByTestId("edit-round-scores-button")).toBeNull();
  });

  it("Cancel on the DangerModal closes it without router.replace", async () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<RoundResultsView data={buildResults({ isComplete: true })} />);
    fireEvent.click(screen.getByTestId("edit-round-scores-button"));
    expect(screen.getByText(/edit finalized round\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/edit finalized round\?/i)).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("Confirm navigates to the scorecard with ?admin=1&edit=1", async () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<RoundResultsView data={buildResults({ isComplete: true })} />);
    fireEvent.click(screen.getByTestId("edit-round-scores-button"));
    // DangerModal: 1.5s delay before confirm is tappable.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    fireEvent.click(screen.getByRole("button", { name: /edit scores/i }));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href.startsWith("/round/7/scorecard")).toBe(true);
    const next = new URLSearchParams(href.split("?")[1] ?? "");
    expect(next.get("admin")).toBe("1");
    expect(next.get("edit")).toBe("1");
  });
});
