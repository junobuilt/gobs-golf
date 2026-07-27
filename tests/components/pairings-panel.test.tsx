// @vitest-environment jsdom
//
// Phase 2.2b — PairingsPanel. Strokes on screen equal the loader (cross-surface
// rule), singles renders two distinct matches, partial groups flag amber, the
// builder creates a group, a failed mutation surfaces the banner, and the
// has-scores rule blocks removal. Plus the pure error-copy mapping.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import type { FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-08-01", yesterdayLocal: () => "2026-08-01" };
});

import { FakeSupabase } from "./fake-supabase";
import PairingsPanel from "@/app/admin/components/PairingsPanel";
import { loadSessionMatches } from "@/lib/tournament/loadMatch";
import { mutationMessage, loaderMessage } from "@/app/admin/components/pairingsCopy";
import {
  EmptyGroupError,
  GroupHasScoresError,
  GroupOverfilledError,
  PlayerAlreadyGroupedError,
  PlayerNotAssignedToSideError,
  PlayerSideMismatchError,
} from "@/lib/tournament/mutations";
import { MatchHolesMissingError, MixedTeesInMatchError } from "@/lib/tournament/loadMatch";
import type { Tournament, TournamentSession } from "@/lib/tournament/types";

const PLAYERS = [
  { id: 1, full_name: "Al Apple", display_name: "Al", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
  { id: 2, full_name: "Art Ash", display_name: "Art", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
  { id: 3, full_name: "Abe Ache", display_name: "Abe", handicap_index: 12, is_active: true, preferred_tee_id: 1 },
  { id: 4, full_name: "Bo Birch", display_name: "Bo", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
  { id: 5, full_name: "Bud Bell", display_name: "Bud", handicap_index: 11, is_active: true, preferred_tee_id: 1 },
  { id: 6, full_name: "Ben Bay", display_name: "Ben", handicap_index: 9, is_active: true, preferred_tee_id: 1 },
];

const TOURN: Tournament = { id: 1, name: "Cup", season_id: null, side_a_name: "USA", side_b_name: "Canada", holder_side: "b", started_on: "2026-08-01", ended_on: null, is_active: true, notes: null };

function session(format: "greensomes" | "four_ball_match" | "singles_match"): TournamentSession {
  return { id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1 — Test", format, played_on: "2026-08-01", is_locked: false };
}

const holes =(teeId: number) => Array.from({ length: 18 }, (_, i) => ({ id: teeId * 100 + i, tee_id: teeId, hole_number: i + 1, par: 4, stroke_index: i + 1 }));

function baseData(format: "greensomes" | "four_ball_match" | "singles_match", extra: Partial<FakeData>): FakeData {
  return {
    rounds: [{ id: 50, played_on: "2026-08-01", course_id: 1, tournament_id: 1, season_id: null }],
    tees: [
      { id: 1, color: "White", slope_rating: 113, course_rating: 72, par: 72, sort_order: 1 },
      { id: 2, color: "Blue", slope_rating: 130, course_rating: 72, par: 72, sort_order: 2 },
      { id: 4, color: "Combo", slope_rating: 113, course_rating: 72, par: 72, sort_order: 3 }, // DEFAULT_TEE_ID
    ],
    holes: [...holes(1), ...holes(2), ...holes(4)],
    round_players: [],
    players: PLAYERS.map((p) => ({ id: p.id, full_name: p.full_name, display_name: p.display_name, handicap_index: p.handicap_index, is_active: p.is_active })),
    scores: [],
    team_scores: [],
    tournaments: [TOURN as any],
    // createGroup validates against the DB side assignments (the roster prop only
    // drives the pickers), so they must exist here too.
    tournament_players: PLAYERS.map((p) => ({ id: p.id, tournament_id: 1, player_id: p.id, side: p.id <= 3 ? "a" : "b" })),
    // loadSessionMatches reads the session (and its format) from the DB, so it
    // must exist here, not only as the rendered prop.
    tournament_sessions: [{ id: 9, tournament_id: 1, round_id: 50, day_number: 1, name: "Day 1 — Test", format, played_on: "2026-08-01", is_locked: false }],
    tournament_matches: [],
    ...extra,
  } as FakeData;
}

// A four-ball group already created: A=Al(10),Art(10) vs B=Bo(10),Bud(11).
function fourBallGroupData(): FakeData {
  return baseData("four_ball_match", {
    round_players: [
      { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 102, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 103, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
      { id: 104, round_id: 50, player_id: 5, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
    ],
    tournament_matches: [
      { id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
    ],
  });
}

afterEach(() => cleanup());

describe("pairingsCopy — each typed error has its own message", () => {
  it("maps every mutation error to distinct copy and unknown to a generic", () => {
    const msgs = [
      mutationMessage(new EmptyGroupError(), "USA", "Canada"),
      mutationMessage(new GroupOverfilledError("b", 3), "USA", "Canada"),
      mutationMessage(new PlayerNotAssignedToSideError(1), "USA", "Canada"),
      mutationMessage(new PlayerSideMismatchError(1, "a", "b"), "USA", "Canada"),
      mutationMessage(new PlayerAlreadyGroupedError(1), "USA", "Canada"),
      mutationMessage(new GroupHasScoresError(), "USA", "Canada"),
      mutationMessage(new Error("boom"), "USA", "Canada"),
    ];
    expect(new Set(msgs).size).toBe(msgs.length); // all distinct
    expect(msgs[1]).toMatch(/Canada/); // overfilled names the side
    expect(loaderMessage(new MixedTeesInMatchError(1, [1, 2]))).toMatch(/different tees/);
    expect(loaderMessage(new MatchHolesMissingError(1, 1))).toMatch(/no holes/);
    expect(loaderMessage(new Error("x"))).toBeNull();
  });
});

describe("PairingsPanel — rendering", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
  });

  it("renders each player's match strokes EQUAL to the loader's values", async () => {
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    await screen.findByText("Bud");

    // Expected strokes from the same loader the card reads.
    const [m] = await loadSessionMatches(9);
    const expected = new Map<string, number>();
    for (const p of [...m.sideA.players, ...m.sideB.players]) expected.set(p.displayName, p.matchStrokes);
    expect(expected.get("Bud")).toBe(1); // sanity: HI 11 low-man-off gets 1
    expect(expected.get("Al")).toBe(0);

    for (const [name, strokes] of expected) {
      const row = screen.getByText(name).closest("div") as HTMLElement;
      expect(within(row).getByText(String(strokes))).toBeTruthy();
    }
  });

  it("shows the header group/player counts and the tee label", async () => {
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    expect(await screen.findByText(/1 group · 4 players · 2 unassigned/)).toBeTruthy();
    expect(screen.getByText(/White tees/)).toBeTruthy();
  });

  it("greensomes shows each side's collapsed team handicap", async () => {
    fakeRef.current = new FakeSupabase(
      baseData("greensomes", {
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 2, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 103, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
          { id: 104, round_id: 50, player_id: 5, team_number: 2, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        team_scores: [],
        tournament_matches: [{ id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null }],
      }),
    );
    render(<PairingsPanel session={session("greensomes")} tournament={TOURN} onClose={() => {}} />);
    await screen.findByText("Al");
    expect(screen.getByText(/Team CH 10/)).toBeTruthy();
    expect(screen.getByText(/Team CH 11/)).toBeTruthy();
  });

  it("singles renders two distinct matches in one group", async () => {
    fakeRef.current = new FakeSupabase(
      baseData("singles_match", {
        round_players: [
          { id: 101, round_id: 50, player_id: 1, team_number: 1, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 102, round_id: 50, player_id: 4, team_number: 2, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 103, round_id: 50, player_id: 2, team_number: 3, tee_id: 1, course_handicap: 10, handicap_index_snapshot: 10 },
          { id: 104, round_id: 50, player_id: 5, team_number: 4, tee_id: 1, course_handicap: 11, handicap_index_snapshot: 11 },
        ],
        tournament_matches: [
          { id: 500, tournament_id: 1, session_id: 9, match_number: 1, group_number: 1, side_a_team_number: 1, side_b_team_number: 2, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
          { id: 501, tournament_id: 1, session_id: 9, match_number: 2, group_number: 1, side_a_team_number: 3, side_b_team_number: 4, status: "pending", result: null, result_source: "engine", closed_out_hole: null, scorer_label: null, admin_note: null },
        ],
      }),
    );
    render(<PairingsPanel session={session("singles_match")} tournament={TOURN} onClose={() => {}} />);
    await screen.findByText("Match 1");
    expect(screen.getByText("Match 2")).toBeTruthy();
    expect(screen.getByText(/1 group · 4 players/)).toBeTruthy(); // one foursome, not two
  });

  it("flags a partial group amber with the reason", async () => {
    const d = fourBallGroupData();
    d.round_players = (d.round_players as any[]).filter((r) => r.player_id !== 5); // drop a Canada player
    fakeRef.current = new FakeSupabase(d);
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    expect(await screen.findByText(/Waiting on 1 Canada player/)).toBeTruthy();
  });
});

describe("PairingsPanel — builder", () => {
  beforeEach(() => {
    fakeRef.current = new FakeSupabase(baseData("four_ball_match", {}));
  });

  function pick(aria: string, name: string) {
    fireEvent.focus(screen.getByLabelText(aria));
    fireEvent.click(screen.getByRole("option", { name }));
  }

  it("creates a four-ball group and it appears with loader strokes", async () => {
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Group" }));

    pick("USA slot 1", "Al");
    pick("USA slot 2", "Art");
    pick("Canada slot 1", "Bo");
    pick("Canada slot 2", "Bud");
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));

    await waitFor(() => expect((fakeRef.current.data.tournament_matches as any[]).length).toBe(1));
    // The new card shows Bud with the loader stroke (1).
    await screen.findByText("Bud");
    const row = screen.getByText("Bud").closest("div") as HTMLElement;
    expect(within(row).getByText("1")).toBeTruthy();
  });

  it("surfaces a banner when the create mutation fails (no silent failure)", async () => {
    fakeRef.current.setOptions({ failWrite: (op: any) => (op.table === "tournament_matches" ? { message: "boom" } : false) });
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add Group" }));

    pick("USA slot 1", "Al");
    pick("Canada slot 1", "Bo");
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));

    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
  });
});

describe("PairingsPanel — has-scores rule", () => {
  it("Remove is blocked with a clear message once the group has a score", async () => {
    const d = fourBallGroupData();
    (d.scores as any[]).push({ id: 9999, round_player_id: 101, hole_number: 1, strokes: 4 });
    fakeRef.current = new FakeSupabase(d);
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/has scores entered and can't be removed/)).toBeTruthy();
  });
});

// §1 regression — bug 2.2c: selecting a player in Edit blanked the field.
describe("PairingsPanel — Edit slot selection (bug 2.2c)", () => {
  const inputVal = (aria: string) => (screen.getByLabelText(aria) as HTMLInputElement).value;

  it("selecting a player keeps their name in the field, still lists them, and excludes them from other slots", async () => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // Slot 1 currently = Al (side a). Select Abe (side a, ungrouped).
    fireEvent.focus(await screen.findByLabelText("USA slot 1"));
    fireEvent.click(screen.getByRole("option", { name: "Abe" }));
    // The field shows "Abe" — NOT blank (this was the bug).
    expect(inputVal("USA slot 1")).toBe("Abe");

    // Re-open slot 1 → Abe is still in its own option list.
    fireEvent.focus(screen.getByLabelText("USA slot 1"));
    expect(screen.getByRole("option", { name: "Abe" })).toBeTruthy();

    // Close slot 1, open slot 2 → Abe is excluded there (picked in another slot).
    fireEvent.mouseDown(document.body);
    fireEvent.focus(screen.getByLabelText("USA slot 2"));
    expect(screen.queryByRole("option", { name: "Abe" })).toBeNull();
  });

  it("persists the swap on save", async () => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.focus(await screen.findByLabelText("USA slot 1"));
    fireEvent.click(screen.getByRole("option", { name: "Abe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const team1 = (fakeRef.current.data.round_players as any[]).filter((r) => r.team_number === 1).map((r) => r.player_id);
      expect(team1).toContain(3); // Abe in
      expect(team1).not.toContain(1); // Al out
    });
  });

  it("lets a swapped-out player be re-selected in the same session and saves back unchanged", async () => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // Swap slot 1 Al → Abe, then change your mind and pick Al again (same modal).
    fireEvent.focus(await screen.findByLabelText("USA slot 1"));
    fireEvent.click(screen.getByRole("option", { name: "Abe" }));
    fireEvent.focus(screen.getByLabelText("USA slot 1"));
    fireEvent.click(screen.getByRole("option", { name: "Al" })); // Al is re-listed now
    expect(inputVal("USA slot 1")).toBe("Al");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const team1 = (fakeRef.current.data.round_players as any[]).filter((r) => r.team_number === 1).map((r) => r.player_id);
      expect(team1).toContain(1); // Al restored
      expect(team1).not.toContain(3); // Abe never saved
    });
  });
});

// §2 UI — fill an empty seat / clear an occupied one, in place.
describe("PairingsPanel — Edit fill & clear", () => {
  function partialFourBall(): FakeData {
    const d = fourBallGroupData();
    d.round_players = (d.round_players as any[]).filter((r) => r.player_id !== 5); // drop a Canada player
    return d;
  }

  it("fills an empty Canada seat and the amber note clears", async () => {
    fakeRef.current = new FakeSupabase(partialFourBall());
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    expect(await screen.findByText(/Waiting on 1 Canada player/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.focus(await screen.findByLabelText("Canada slot 2")); // the empty seat
    fireEvent.click(screen.getByRole("option", { name: "Bud" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect((fakeRef.current.data.round_players as any[]).some((r) => r.player_id === 5)).toBe(true));
    await waitFor(() => expect(screen.queryByText(/Waiting on/)).toBeNull());
  });

  it("clears an occupied seat via the × and the amber note returns", async () => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // The × clear button inside the USA-slot-1 field (label "Clear selection").
    const slot1 = await screen.findByLabelText("USA slot 1");
    const clearBtn = within(slot1.closest("div")!.parentElement as HTMLElement).getByLabelText("Clear selection");
    fireEvent.click(clearBtn);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect((fakeRef.current.data.round_players as any[]).some((r) => r.player_id === 1)).toBe(false));
    expect(await screen.findByText(/Waiting on 1 USA player/)).toBeTruthy();
  });
});

// §2 correction — a partial-failure Save reloads the real DB state before showing
// the error, so the modal never displays what the admin only *thought* was saved.
describe("PairingsPanel — Edit partial failure reload", () => {
  it("earlier ops persist, error shows, and the reloaded modal matches the DB", async () => {
    fakeRef.current = new FakeSupabase(fourBallGroupData());
    // The tee change is per-player updates (payload has no player_id); the swap is
    // an update whose payload carries player_id. Fail ONLY the swap so the tee
    // change persists first and the swap does not.
    fakeRef.current.setOptions({
      failWrite: (op: any) =>
        op.type === "update" && op.table === "round_players" && op.payload && "player_id" in op.payload
          ? { message: "boom" }
          : false,
    });
    render(<PairingsPanel session={session("four_ball_match")} tournament={TOURN} onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } }); // tee → Blue (id 2)
    fireEvent.focus(await screen.findByLabelText("USA slot 1"));
    fireEvent.click(screen.getByRole("option", { name: "Abe" })); // swap Al → Abe (will fail to write)
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // Error shown inline; the tee change DID persist; the swap did NOT.
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    await waitFor(() => {
      const g1TeamA = (fakeRef.current.data.round_players as any[]).filter((r) => r.team_number === 1);
      expect(g1TeamA.every((r) => r.tee_id === 2)).toBe(true); // tee persisted
      expect(g1TeamA.some((r) => r.player_id === 1)).toBe(true); // Al still there (swap failed)
    });
    // The reloaded modal reflects the DB: slot 1 is still Al, the tee is Blue.
    await waitFor(() => expect((screen.getByLabelText("USA slot 1") as HTMLInputElement).value).toBe("Al"));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("2");
  });
});
