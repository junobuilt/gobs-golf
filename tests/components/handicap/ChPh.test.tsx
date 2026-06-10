// @vitest-environment jsdom

// Golden-literal coverage for the shared CH · PH display (the single source for
// "CH {raw} · PH {playing}" across the scorecard, History drill-in, and profile).
// Spec golden: Thomas CH 13 @ 80% → PH 10.

import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import ChPh from "@/components/handicap/ChPh";

const ORANGE = "#c2410c";

describe("ChPh", () => {
  it("shows both numbers and accents PH when PH ≠ CH (80% round: CH 13 · PH 10)", () => {
    cleanup();
    const { container } = render(<ChPh ch={13} ph={10} />);
    expect(container.textContent).toBe("CH 13 · PH 10");
    expect(screen.getByText("PH 10")).toHaveStyle({ color: ORANGE });
  });

  it("at 100% (PH = CH) shows CH 13 · PH 13 with NO accent", () => {
    cleanup();
    const { container } = render(<ChPh ch={13} ph={13} />);
    expect(container.textContent).toBe("CH 13 · PH 13");
    expect(screen.getByText("PH 13")).not.toHaveStyle({ color: ORANGE });
  });

  it("negative control: a different CH/allowance pair yields a different literal", () => {
    cleanup();
    const { container } = render(<ChPh ch={20} ph={16} />);
    expect(container.textContent).toBe("CH 20 · PH 16");
    expect(container.textContent).not.toBe("CH 13 · PH 10");
    expect(screen.getByText("PH 16")).toHaveStyle({ color: ORANGE });
  });

  it("renders an em-dash for a null handicap", () => {
    cleanup();
    const { container } = render(<ChPh ch={null} ph={null} />);
    expect(container.textContent).toBe("CH — · PH —");
  });
});
