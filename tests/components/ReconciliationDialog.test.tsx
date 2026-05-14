// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import ReconciliationDialog from "@/components/scorecard/ReconciliationDialog";

afterEach(() => cleanup());

const items = [
  { player_name: "Wayne H", hole_label: "Hole 3", strokes: 5 },
  { player_name: "Kevin I", hole_label: "Hole 7", strokes: 4 },
];

describe("ReconciliationDialog — first-attempt variant", () => {
  it("renders count, items, and primary/secondary buttons", () => {
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    render(
      <ReconciliationDialog
        variant="first-attempt"
        items={items}
        onRetry={onRetry}
        onSkip={onSkip}
      />,
    );
    expect(screen.getByText("2 scores didn't sync")).toBeInTheDocument();
    expect(screen.getByText(/Hole 3 — Wayne H/)).toBeInTheDocument();
    expect(screen.getByText(/Hole 7 — Kevin I/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip and finish" })).toBeInTheDocument();
  });

  it("singular grammar for 1 item", () => {
    render(
      <ReconciliationDialog
        variant="first-attempt"
        items={[items[0]]}
        onRetry={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("1 score didn't sync")).toBeInTheDocument();
  });

  it("fires onRetry / onSkip", () => {
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    render(
      <ReconciliationDialog
        variant="first-attempt"
        items={items}
        onRetry={onRetry}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    expect(onRetry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip and finish" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("disables both buttons + shows 'Retrying…' when busy", () => {
    render(
      <ReconciliationDialog
        variant="first-attempt"
        items={items}
        onRetry={() => {}}
        onSkip={() => {}}
        busy={true}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retrying…" });
    const skip = screen.getByRole("button", { name: "Skip and finish" });
    expect(retry).toBeDisabled();
    expect(skip).toBeDisabled();
  });
});

describe("ReconciliationDialog — second-attempt variant", () => {
  it("renders three buttons and the advice paragraph", () => {
    render(
      <ReconciliationDialog
        variant="second-attempt"
        items={items}
        onRetry={() => {}}
        onSkip={() => {}}
        onCopyDetails={() => {}}
      />,
    );
    expect(screen.getByText("Still couldn't sync 2 scores.")).toBeInTheDocument();
    expect(
      screen.getByText(/Try again later when you have better signal/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish anyway" })).toBeInTheDocument();
  });

  it("renders 'Copied ✓' when copyState is 'copied'", () => {
    render(
      <ReconciliationDialog
        variant="second-attempt"
        items={items}
        onRetry={() => {}}
        onSkip={() => {}}
        onCopyDetails={() => {}}
        copyState="copied"
      />,
    );
    expect(screen.getByRole("button", { name: "Copied ✓" })).toBeInTheDocument();
  });

  it("fires onCopyDetails", () => {
    const onCopy = vi.fn();
    render(
      <ReconciliationDialog
        variant="second-attempt"
        items={items}
        onRetry={() => {}}
        onSkip={() => {}}
        onCopyDetails={onCopy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(onCopy).toHaveBeenCalled();
  });
});
