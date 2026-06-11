// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MoveTeamSheet from "@/components/flights/MoveTeamSheet";
import type { Flight } from "@/lib/flights/resolve";

afterEach(() => cleanup());

const flights: Flight[] = [
  { id: 10, round_id: 1, name: "3-Man", sort_order: 1, format: "2_ball", format_config: { basis: "net", handicap_allowance: 80 }, format_locked_at: null },
  { id: 20, round_id: 1, name: "4-Man", sort_order: 2, format: "texas_scramble", format_config: { basis: "net" }, format_locked_at: null },
];
const teamCounts = new Map([[10, 3], [20, 4]]);

function renderSheet(overrides: Partial<React.ComponentProps<typeof MoveTeamSheet>> = {}) {
  const onMove = vi.fn();
  const onNewFlight = vi.fn();
  const onCancel = vi.fn();
  render(
    <MoveTeamSheet
      teamNumber={3}
      teamRoster="Larry · Mike · Don"
      flights={flights}
      currentFlightId={10}
      teamCounts={teamCounts}
      onMove={onMove}
      onNewFlight={onNewFlight}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onMove, onNewFlight, onCancel };
}

describe("MoveTeamSheet", () => {
  it("lists each flight with format · allowance · team-count meta", () => {
    renderSheet();
    expect(screen.getByText("Move Team 3 to…")).toBeTruthy();
    expect(screen.getByText("Larry · Mike · Don")).toBeTruthy();
    // 3-Man: 2-Ball · 80% · 3 teams ; 4-Man: team-card → no allowance segment
    expect(screen.getByText(/2-Ball · 80% · 3 teams/)).toBeTruthy();
    expect(screen.getByText(/Texas Scramble · 4 teams/)).toBeTruthy();
  });

  it("tapping a DIFFERENT flight calls onMove with that flight id", () => {
    const { onMove, onCancel } = renderSheet();
    fireEvent.click(screen.getByText("4-Man"));
    expect(onMove).toHaveBeenCalledWith(20);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("tapping the CURRENT (selected) flight is a no-op cancel, not a move", () => {
    const { onMove, onCancel } = renderSheet();
    fireEvent.click(screen.getByText("3-Man"));
    expect(onMove).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("'+ New flight' and 'Cancel' fire their callbacks", () => {
    const { onNewFlight, onCancel } = renderSheet();
    fireEvent.click(screen.getByText("+ New flight"));
    expect(onNewFlight).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
