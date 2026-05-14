// @vitest-environment jsdom
/**
 * Phase E — StaleFailureDialog component-level tests. Verifies render
 * variants, the View details toggle, retry → second-attempt escalation,
 * and the Forget confirmation flow.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import StaleFailureDialog from "@/components/scorecard/StaleFailureDialog";
import type { QueueItem } from "@/lib/writeQueue";

afterEach(() => cleanup());

function mkItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    kind: "score_upsert",
    payload: { round_id: 90, round_player_id: 553, hole_number: 3, strokes: 5 },
    enqueued_at: new Date("2026-05-11T17:30:00Z").getTime(),
    attempts: 3,
    last_attempt_at: Date.now(),
    next_attempt_at: Date.now(),
    state: "terminal_failure",
    display: {
      player_name: "Wayne H",
      hole_label: "Hole 3",
      round_date: "2026-05-11",
    },
    ...overrides,
  };
}

const items: QueueItem[] = [
  mkItem(),
  mkItem({
    id: "k",
    payload: { round_id: 90, round_player_id: 553, hole_number: 7, strokes: 4 },
    display: { player_name: "Kevin I", hole_label: "Hole 7", round_date: "2026-05-11" },
  }),
];

describe("StaleFailureDialog — first variant", () => {
  it("renders title, items, and three action buttons", () => {
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    expect(
      screen.getByText(/2 scores from your last round still need to sync/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hole 3 — Wayne H/)).toBeInTheDocument();
    expect(screen.getByText(/Hole 7 — Kevin I/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });

  it("singular grammar for 1 item", () => {
    render(
      <StaleFailureDialog
        items={[items[0]]}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    expect(
      screen.getByText(/1 score from your last round still needs to sync/i),
    ).toBeInTheDocument();
  });

  it("View details toggles the inline date display", () => {
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    // Before tap: no inline date (May 11) visible in list items.
    const list = screen.getByTestId("stale-failure-list");
    expect(list.textContent).not.toMatch(/May 11/);

    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(list.textContent).toMatch(/May 11/);
    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();
  });
});

describe("StaleFailureDialog — Retry path", () => {
  it("on retry success, no escalation to second variant (parent unmounts)", async () => {
    const onRetry = vi.fn(async () => true);
    render(
      <StaleFailureDialog
        items={items}
        onRetry={onRetry}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(onRetry).toHaveBeenCalled();
    // Still first variant (parent owns escalation logic by unmounting).
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  });

  it("on retry failure, escalates to second-attempt variant", async () => {
    const onRetry = vi.fn(async () => false);
    render(
      <StaleFailureDialog
        items={items}
        onRetry={onRetry}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(screen.getByText(/Still couldn't sync/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });

  it("shows 'Retrying…' while onRetry is in-flight", async () => {
    let resolveRetry!: (v: boolean) => void;
    const onRetry = vi.fn(() => new Promise<boolean>(r => { resolveRetry = r; }));
    render(
      <StaleFailureDialog
        items={items}
        onRetry={onRetry}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    await act(async () => {
      resolveRetry(true);
    });
  });
});

describe("StaleFailureDialog — Forget confirmation", () => {
  it("Forget opens the DangerModal; cancel dismisses without calling onForget", () => {
    const onForget = vi.fn();
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={onForget}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(
      screen.getByText("Permanently delete these unsaved scores?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByText("Permanently delete these unsaved scores?"),
    ).not.toBeInTheDocument();
    expect(onForget).not.toHaveBeenCalled();
  });

  it("Forget → confirm triggers onForget", async () => {
    vi.useFakeTimers();
    const onForget = vi.fn();
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={onForget}
        onCopyDetails={() => {}}
        onDismiss={() => {}}
        copyState="idle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    // DangerModal has a 1.5s confirm-button delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    // The dialog's Forget button + the DangerModal's Forget confirm
    // both match — the modal is appended after the dialog, so the
    // last one is the confirm.
    const forgetButtons = screen.getAllByRole("button", { name: "Forget" });
    fireEvent.click(forgetButtons[forgetButtons.length - 1]);
    expect(onForget).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("StaleFailureDialog — Dismissal", () => {
  it("Escape key calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={onDismiss}
        copyState="idle"
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("overlay click calls onDismiss; clicking the modal does not", () => {
    const onDismiss = vi.fn();
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={onDismiss}
        copyState="idle"
      />,
    );
    const overlay = screen.getByTestId("stale-failure-overlay");
    // Click on overlay — target === currentTarget — dismisses.
    fireEvent.click(overlay);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Click on the modal content (a button) — should NOT dismiss
    // (clickbubbles only fire if target === currentTarget).
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss while Forget confirm modal is open", () => {
    const onDismiss = vi.fn();
    render(
      <StaleFailureDialog
        items={items}
        onRetry={async () => true}
        onForget={() => {}}
        onCopyDetails={() => {}}
        onDismiss={onDismiss}
        copyState="idle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
