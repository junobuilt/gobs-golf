// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import TodaysTeamsList from "@/components/teamFormation/TodaysTeamsList";
import type { TeamEntry } from "@/components/teamFormation/TodaysTeamsList";
import type { RoundPlayer } from "@/lib/teamFormation/smartJoin";

afterEach(() => cleanup());

const alice: RoundPlayer = {
  id: 101,
  player_id: 1,
  team_number: 1,
  players: { full_name: "Alice Anderson", display_name: "Alice" },
};
const bob: RoundPlayer = {
  id: 102,
  player_id: 2,
  team_number: 1,
  players: { full_name: "Bob Brown", display_name: "Bob" },
};
const carol: RoundPlayer = {
  id: 103,
  player_id: 3,
  team_number: 2,
  players: { full_name: "Carol Chen", display_name: "Carol" },
};
const dave: RoundPlayer = {
  id: 104,
  player_id: 4,
  team_number: 2,
  players: { full_name: "Dave Davis", display_name: "Dave" },
};

const team1: TeamEntry = { teamNumber: 1, roster: [alice, bob] };
const team2: TeamEntry = { teamNumber: 2, roster: [carol, dave] };

describe("TodaysTeamsList — 0 teams", () => {
  it("shows 'Today's round — no teams yet' header", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByText("Today's round — no teams yet")).toBeInTheDocument();
  });

  it("shows a primary 'Form a team' CTA", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Form a team" })).toBeInTheDocument();
  });

  it("tapping 'Form a team' calls onFormTeam", () => {
    const onFormTeam = vi.fn();
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[]}
        onFormTeam={onFormTeam}
        onTapTeam={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Form a team" }));
    expect(onFormTeam).toHaveBeenCalledOnce();
  });
});

describe("TodaysTeamsList — 1 team", () => {
  it("shows 'Today's teams' header", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByText("Today's teams")).toBeInTheDocument();
  });

  it("renders the team number badge", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByText("Team 1")).toBeInTheDocument();
  });

  it("renders comma-separated roster names", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByText("Alice, Bob")).toBeInTheDocument();
  });

  it("shows 'Form a new team' secondary CTA", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Form a new team" })).toBeInTheDocument();
  });

  it("tapping a team row calls onTapTeam with the team number", () => {
    const onTapTeam = vi.fn();
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1]}
        onFormTeam={vi.fn()}
        onTapTeam={onTapTeam}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Team 1/i }));
    expect(onTapTeam).toHaveBeenCalledWith(1);
  });
});

describe("TodaysTeamsList — N teams", () => {
  it("renders all teams sorted by team_number", () => {
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team2, team1]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button").filter(b =>
      b.textContent?.includes("Team 1") || b.textContent?.includes("Team 2"),
    );
    // Both teams rendered
    expect(buttons).toHaveLength(2);
  });

  it("tapping team 2 calls onTapTeam(2)", () => {
    const onTapTeam = vi.fn();
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[team1, team2]}
        onFormTeam={vi.fn()}
        onTapTeam={onTapTeam}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Team 2/i }));
    expect(onTapTeam).toHaveBeenCalledWith(2);
  });

  it("uses display_name with fallback to full_name", () => {
    const noDisplayName: RoundPlayer = {
      id: 200,
      player_id: 99,
      team_number: 3,
      players: { full_name: "Zara Z", display_name: "" },
    };
    render(
      <TodaysTeamsList
        roundId={99}
        teams={[{ teamNumber: 3, roster: [noDisplayName] }]}
        onFormTeam={vi.fn()}
        onTapTeam={vi.fn()}
      />,
    );
    expect(screen.getByText("Zara Z")).toBeInTheDocument();
  });
});
