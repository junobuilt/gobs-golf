// @vitest-environment jsdom
//
// E6 — extracted shared PlayedWithPanel. Pure render of compute buckets; the
// bucket split (6+ / 3–5 / 1–2 / 0) happens inside the component.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => React.createElement("a", { href, ...rest }, children),
}));

import PlayedWithPanel from "@/components/playedWith/PlayedWithPanel";

afterEach(() => cleanup());

describe("PlayedWithPanel", () => {
  it("splits partners into the 6+ / 3–5 / 1–2 buckets", () => {
    render(
      <PlayedWithPanel
        seasonScoped={false}
        partners={[
          { id: 1, display_name: "Freq F", rounds_together: 8 },
          { id: 2, display_name: "Some S", rounds_together: 4 },
          { id: 3, display_name: "Once O", rounds_together: 1 },
        ]}
        neverPlayed={[{ id: 4, display_name: "Never N" }]}
      />,
    );

    // 6+ bucket renders the bar with the raw count.
    expect(screen.getByText("Freq F")).toBeInTheDocument();
    // 3–5 and 1–2 buckets render "name · count" pills.
    expect(screen.getByText("Some S · 4")).toBeInTheDocument();
    expect(screen.getByText("Once O · 1")).toBeInTheDocument();
    // Never-played pill (no count).
    expect(screen.getByText("Never N")).toBeInTheDocument();
  });

  it("uses focalPlayerName in the 'played with everyone' copy", () => {
    render(
      <PlayedWithPanel
        seasonScoped={false}
        partners={[{ id: 1, display_name: "Freq F", rounds_together: 8 }]}
        neverPlayed={[]}
        focalPlayerName="Bill C"
      />,
    );
    expect(screen.getByText("Bill C has played with everyone")).toBeInTheDocument();
  });

  it("shows 'No partners this season yet' when season-scoped with zero partners", () => {
    render(<PlayedWithPanel seasonScoped partners={[]} neverPlayed={[{ id: 9, display_name: "X Y" }]} />);
    expect(screen.getByText("No partners this season yet")).toBeInTheDocument();
  });

  it("collapses the never-played bucket past the cap with a Show all toggle", () => {
    // Zero-padded so alphabetical sort is also numeric order (P00..P24).
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      display_name: `P${String(i).padStart(2, "0")} Z`,
    }));
    render(<PlayedWithPanel seasonScoped={false} partners={[]} neverPlayed={many} />);
    // 20 visible by default → P20..P24 hidden until Show all.
    expect(screen.queryByText("P24 Z")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show all (25)"));
    expect(screen.getByText("P24 Z")).toBeInTheDocument();
  });
});
