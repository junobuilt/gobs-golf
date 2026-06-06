// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import PlayerPickerSheet from "@/components/teamFormation/PlayerPickerSheet";
import type { Player } from "@/app/admin/page";
import type { RoundPlayer } from "@/lib/teamFormation/smartJoin";

afterEach(() => cleanup());

const alice: Player = {
  id: 1,
  full_name: "Alice Anderson",
  display_name: "Alice",
  handicap_index: 10,
  is_active: true,
  preferred_tee_id: null,
};
const bob: Player = {
  id: 2,
  full_name: "Bob Brown",
  display_name: "Bob",
  handicap_index: 8,
  is_active: true,
  preferred_tee_id: null,
};
const carol: Player = {
  id: 3,
  full_name: "Carol Chen",
  display_name: "Carol",
  handicap_index: 12,
  is_active: true,
  preferred_tee_id: null,
};

const bobRp: RoundPlayer = {
  id: 101,
  player_id: 2,
  team_number: 2,
  players: { full_name: "Bob Brown", display_name: "Bob" },
};
const carolRp: RoundPlayer = {
  id: 102,
  player_id: 3,
  team_number: 0,
  players: { full_name: "Carol Chen", display_name: "Carol" },
};

describe("PlayerPickerSheet — form_team mode", () => {
  it("renders all active players with disambiguated short names", () => {
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice, bob, carol]}
        roundPlayers={[]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // First name + minimum last-name suffix, derived from full_name (the
    // display_name nickname is intentionally ignored).
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.getByText("Bob B")).toBeInTheDocument();
    expect(screen.getByText("Carol C")).toBeInTheDocument();
  });

  it("expands the suffix to disambiguate a shared first name (two Waynes)", () => {
    const wayneH: Player = {
      id: 10, full_name: "Wayne Hashimoto", display_name: "Wayne",
      handicap_index: null, is_active: true, preferred_tee_id: null,
    };
    const wayneV: Player = {
      id: 11, full_name: "Wayne Vincent", display_name: "Wayne",
      handicap_index: null, is_active: true, preferred_tee_id: null,
    };
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[wayneH, wayneV]}
        allActivePlayers={[wayneH, wayneV]}
        roundPlayers={[]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Wayne H")).toBeInTheDocument();
    expect(screen.getByText("Wayne V")).toBeInTheDocument();
  });

  it("shows Team N caption for already-assigned players", () => {
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice, bob, carol]}
        roundPlayers={[bobRp]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Team 2")).toBeInTheDocument();
  });

  it("CTA is disabled at 0 selected", () => {
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice]}
        roundPlayers={[]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Start scorecard" })).toBeDisabled();
  });

  it("CTA is enabled when 1+ player selected", () => {
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice]}
        roundPlayers={[]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Click the list row (the button containing "Alice")
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("Alice"))!);
    expect(screen.getByRole("button", { name: "Start scorecard" })).not.toBeDisabled();
  });

  it("selecting a player adds a chip; tapping the chip X removes the selection", () => {
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice]}
        roundPlayers={[]}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("Alice"))!);
    // Chip appears — there should now be two elements with "Alice A" text
    expect(screen.getAllByText("Alice A").length).toBeGreaterThan(1);
    // Remove chip via × button
    fireEvent.click(screen.getByLabelText("Remove Alice A"));
    // CTA should be disabled again (selection cleared)
    expect(screen.getByRole("button", { name: "Start scorecard" })).toBeDisabled();
  });

  it("tapping CTA calls onResolve with a SmartJoinResult", () => {
    const onResolve = vi.fn();
    render(
      <PlayerPickerSheet
        mode="form_team"
        activePlayers={[alice]}
        roundPlayers={[]}
        onResolve={onResolve}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("Alice"))!);
    fireEvent.click(screen.getByRole("button", { name: "Start scorecard" }));
    expect(onResolve).toHaveBeenCalledOnce();
    const result = onResolve.mock.calls[0][0];
    expect(result.kind).toBe("create_new");
    expect((result as { playerIds: number[] }).playerIds).toContain(1);
  });
});

describe("PlayerPickerSheet — add_to_team mode", () => {
  it("list excludes all team_number > 0 players", () => {
    render(
      <PlayerPickerSheet
        mode="add_to_team"
        teamNumber={3}
        activePlayers={[alice, bob, carol]}
        roundPlayers={[bobRp, carolRp]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice A")).toBeInTheDocument();
    expect(screen.queryByText("Bob B")).not.toBeInTheDocument(); // team_number=2, hidden
    expect(screen.getByText("Carol C")).toBeInTheDocument(); // team_number=0, visible
  });

  it("CTA is labeled with the team number", () => {
    render(
      <PlayerPickerSheet
        mode="add_to_team"
        teamNumber={3}
        activePlayers={[alice]}
        roundPlayers={[]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Add to Team 3" })).toBeInTheDocument();
  });

  it("onAdd called with selected player ids", () => {
    const onAdd = vi.fn();
    render(
      <PlayerPickerSheet
        mode="add_to_team"
        teamNumber={3}
        activePlayers={[alice, carol]}
        roundPlayers={[carolRp]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("Alice"))!);
    fireEvent.click(screen.getByRole("button", { name: "Add to Team 3" }));
    expect(onAdd).toHaveBeenCalledWith([1]);
  });
});
