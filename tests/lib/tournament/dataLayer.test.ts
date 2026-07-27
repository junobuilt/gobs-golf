// Tournament data layer — queries.ts + mutations.ts against FakeSupabase.
// Covers the full create → assign sides → add day flow and asserts the day's
// round is tournament-owned (tournament_id set, season_id/format NULL).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));
// Keep the real addDaysISO / formatDisplayDate; only pin "today"/"yesterday".
vi.mock("@/lib/date", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date")>();
  return { ...actual, todayLocal: () => "2026-08-01", yesterdayLocal: () => "2026-07-31" };
});

import { FakeSupabase } from "../../components/fake-supabase";
import {
  getActiveTournament,
  getTournamentPlayers,
  getTournamentSessions,
  getTournamentWithSessions,
} from "@/lib/tournament/queries";
import {
  createSession,
  createStandardDays,
  createTournament,
  editSession,
  endTournament,
  LeagueRoundOwnsDateError,
  setPlayerSide,
  TournamentDayDateTakenError,
} from "@/lib/tournament/mutations";

function seed(): FakeData {
  return {
    rounds: [],
    tees: [],
    holes: [],
    round_players: [],
    players: [
      { id: 1, full_name: "Al A", display_name: "Al", handicap_index: 8, is_active: true },
      { id: 2, full_name: "Bo B", display_name: "Bo", handicap_index: 14, is_active: true },
    ],
    scores: [],
    tournaments: [],
    tournament_players: [],
    tournament_sessions: [],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("tournament data layer — create → assign → add day", () => {
  it("createTournament stores an active row; getActiveTournament reads it back", async () => {
    const t = await createTournament({
      name: "2026 GOBS Ryder Cup",
      startedOn: "2026-08-01",
      sideAName: "USA",
      sideBName: "Canada",
      holderSide: "b",
    });
    expect(t.id).toBeTruthy();
    expect(t.is_active).toBe(true);
    const active = await getActiveTournament();
    expect(active?.id).toBe(t.id);
    expect(active?.holder_side).toBe("b");
  });

  it("setPlayerSide upserts (idempotent) and null removes the row", async () => {
    const t = await createTournament({ name: "T", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    await setPlayerSide(t.id, 1, "a");
    await setPlayerSide(t.id, 2, "b");
    // Re-assign player 1 to b — must UPDATE the same row, not add a second.
    await setPlayerSide(t.id, 1, "b");
    let players = await getTournamentPlayers(t.id);
    expect(players).toHaveLength(2);
    expect(players.find((p) => p.player_id === 1)?.side).toBe("b");

    // Embed resolves the joined player record (name for display).
    const p1 = players.find((p) => p.player_id === 1)!;
    const rec = Array.isArray(p1.players) ? p1.players[0] : p1.players;
    expect(rec?.full_name).toBe("Al A");

    // null removes.
    await setPlayerSide(t.id, 1, null);
    players = await getTournamentPlayers(t.id);
    expect(players).toHaveLength(1);
    expect(players[0].player_id).toBe(2);
  });

  it("createSession creates a tournament-owned round and stores round_id on the session", async () => {
    const t = await createTournament({ name: "T", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    const session = await createSession({
      tournamentId: t.id,
      dayNumber: 1,
      name: "Day 1",
      format: "four_ball_match",
      playedOn: "2026-08-01",
    });
    expect(session.round_id).toBeTruthy();

    // The created round is tournament-owned: tournament_id set, season_id NULL,
    // format NULL.
    const round = (fakeRef.current.data.rounds as any[]).find((r) => r.id === session.round_id);
    expect(round.tournament_id).toBe(t.id);
    expect(round.season_id).toBe(null);
    expect(round.format).toBe(null);

    const sessions = await getTournamentSessions(t.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].round_id).toBe(session.round_id);
  });

  it("getTournamentWithSessions batches the three reads", async () => {
    const t = await createTournament({ name: "T", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    await setPlayerSide(t.id, 1, "a");
    await createSession({ tournamentId: t.id, dayNumber: 1, name: "Day 1", format: "singles_match", playedOn: "2026-08-01" });
    const full = await getTournamentWithSessions(t.id);
    expect(full?.tournament.id).toBe(t.id);
    expect(full?.players).toHaveLength(1);
    expect(full?.sessions).toHaveLength(1);
  });

  it("endTournament clears is_active so getActiveTournament returns null", async () => {
    const t = await createTournament({ name: "T", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    await endTournament(t.id);
    expect(await getActiveTournament()).toBe(null);
    const ended = (fakeRef.current.data.tournaments as any[]).find((x) => x.id === t.id);
    expect(ended.is_active).toBe(false);
    expect(ended.ended_on).toBe("2026-08-01");
  });

  // §2 — ended_on must never predate started_on. today is mocked "2026-08-01".
  it("endTournament on a not-yet-started tournament records started_on, not today", async () => {
    const t = await createTournament({ name: "Future", startedOn: "2026-08-05", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    await endTournament(t.id);
    const ended = (fakeRef.current.data.tournaments as any[]).find((x) => x.id === t.id);
    expect(ended.ended_on).toBe("2026-08-05");
    expect(ended.is_active).toBe(false);
  });
});

// §3 — auto-create the three standard days.
describe("createStandardDays", () => {
  it("creates the three standard days on consecutive dates, each with its own round", async () => {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    const { created, failed } = await createStandardDays(t.id, "2026-08-01");

    expect(failed).toHaveLength(0);
    expect(created.map((s) => s.format)).toEqual(["greensomes", "four_ball_match", "singles_match"]);
    expect(created.map((s) => s.played_on)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(created.map((s) => s.name)).toEqual(["Day 1 — Alternate Shot", "Day 2 — Best Ball", "Day 3 — Singles"]);
    expect(created.map((s) => s.day_number)).toEqual([1, 2, 3]);
    created.forEach((s) => expect(s.round_id).toBeTruthy());
    // Each day gets a DISTINCT round (the 032 bug was two days sharing one).
    expect(new Set(created.map((s) => s.round_id)).size).toBe(3);
    expect((fakeRef.current.data.tournament_sessions as any[]).length).toBe(3);
  });

  // §5 partial-collision path: a league round owns only the middle date.
  it("creates the days that succeed and reports the one blocked by a league round", async () => {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    fakeRef.current.setOptions({
      failWrite: (op: any) =>
        op.type === "insert" && op.table === "rounds" && op.payload?.[0]?.played_on === "2026-08-02"
          ? { code: "23505", message: "dup" }
          : false,
    });

    const { created, failed } = await createStandardDays(t.id, "2026-08-01");

    // Days 1 and 3 created; day 2 skipped but its number is NOT reused.
    expect(created.map((s) => s.played_on)).toEqual(["2026-08-01", "2026-08-03"]);
    expect(created.map((s) => s.day_number)).toEqual([1, 3]);
    expect(failed).toEqual([{ name: "Day 2 — Best Ball", format: "four_ball_match", date: "2026-08-02" }]);
    // Only the two survivors persisted.
    expect((fakeRef.current.data.tournament_sessions as any[]).length).toBe(2);
  });
});

// §4 — a session must never persist without its round.
describe("createSession round guarantee", () => {
  it("does not persist a session when the round can't be created", async () => {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    fakeRef.current.setOptions({
      failWrite: (op: any) => (op.type === "insert" && op.table === "rounds" ? { code: "23505", message: "dup" } : false),
    });

    await expect(
      createSession({ tournamentId: t.id, dayNumber: 1, name: "Day 1", format: "greensomes", playedOn: "2026-08-01" }),
    ).rejects.toBeInstanceOf(LeagueRoundOwnsDateError);
    expect((fakeRef.current.data.tournament_sessions as any[]).length).toBe(0);
  });
});

// §3.1 — editing a day; date changes MOVE the round and classify collisions.
describe("editSession", () => {
  async function makeDay(playedOn: string) {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    const s = await createSession({ tournamentId: t.id, dayNumber: 1, name: "Day 1 — Greensomes", format: "greensomes", playedOn });
    return { t, s };
  }

  it("date change moves the underlying round (never creates a second) and applies name/format", async () => {
    const { s } = await makeDay("2026-08-01");
    const roundsBefore = (fakeRef.current.data.rounds as any[]).length;

    await editSession(s, { name: "Day 1 — Singles", format: "singles_match", playedOn: "2026-08-04" });

    const rounds = fakeRef.current.data.rounds as any[];
    expect(rounds.length).toBe(roundsBefore); // moved, not duplicated
    expect(rounds.find((r) => r.id === s.round_id).played_on).toBe("2026-08-04");

    const session = (fakeRef.current.data.tournament_sessions as any[]).find((x) => x.id === s.id);
    expect(session.played_on).toBe("2026-08-04");
    expect(session.name).toBe("Day 1 — Singles");
    expect(session.format).toBe("singles_match");
  });

  it("a sibling tournament day on the target date surfaces the day-collision error (nothing moves)", async () => {
    const { s } = await makeDay("2026-08-01");
    // Step 1 (the played_on-only session update) hits the tournament UNIQUE.
    fakeRef.current.setOptions({
      failWrite: (op: any) =>
        op.type === "update" && op.table === "tournament_sessions" && !("name" in (op.payload ?? {}))
          ? { code: "23505", message: "dup" }
          : false,
    });

    await expect(
      editSession(s, { name: "x", format: "greensomes", playedOn: "2026-08-02" }),
    ).rejects.toBeInstanceOf(TournamentDayDateTakenError);

    // Nothing moved.
    expect((fakeRef.current.data.rounds as any[]).find((r) => r.id === s.round_id).played_on).toBe("2026-08-01");
    expect((fakeRef.current.data.tournament_sessions as any[]).find((x) => x.id === s.id).played_on).toBe("2026-08-01");
  });

  it("a league round on the target date surfaces the league error AND reverts the moved session date", async () => {
    const { s } = await makeDay("2026-08-01");
    // Step 1 (session move) succeeds; step 2 (round move) hits rounds_played_on_unique.
    fakeRef.current.setOptions({
      failWrite: (op: any) =>
        op.type === "update" && op.table === "rounds" ? { code: "23505", message: "dup" } : false,
    });

    await expect(
      editSession(s, { name: "x", format: "greensomes", playedOn: "2026-08-02" }),
    ).rejects.toBeInstanceOf(LeagueRoundOwnsDateError);

    // Compensating write restored the session date; the round never moved.
    expect((fakeRef.current.data.tournament_sessions as any[]).find((x) => x.id === s.id).played_on).toBe("2026-08-01");
    expect((fakeRef.current.data.rounds as any[]).find((r) => r.id === s.round_id).played_on).toBe("2026-08-01");
  });
});
