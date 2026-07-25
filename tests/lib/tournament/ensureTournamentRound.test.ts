// ensureTournamentRound — returns an existing tournament round, creates when
// absent, and throws LeagueRoundOwnsDateError when a league round owns the date.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeData } from "../../components/fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return fakeRef.current;
  },
}));
vi.mock("@/lib/date", () => ({ todayLocal: () => "2026-08-01", yesterdayLocal: () => "2026-07-31" }));

import { FakeSupabase } from "../../components/fake-supabase";
import { ensureTournamentRound, LeagueRoundOwnsDateError } from "@/lib/tournament/mutations";

const DATE = "2026-08-15";
const T_ID = 7;

function baseSeed(rounds: any[] = []): FakeData {
  return {
    rounds,
    tees: [],
    holes: [],
    round_players: [],
    players: [],
    scores: [],
    tournaments: [{ id: T_ID, name: "T", is_active: true, started_on: "2026-08-01", side_a_name: "USA", side_b_name: "Canada", holder_side: "b", season_id: null, ended_on: null, notes: null }],
    tournament_players: [],
    tournament_sessions: [],
  };
}

describe("ensureTournamentRound", () => {
  it("returns an existing tournament round for the date without inserting", async () => {
    fakeRef.current = new FakeSupabase(
      baseSeed([{ id: 500, played_on: DATE, course_id: 1, is_complete: false, tournament_id: T_ID, season_id: null, format: null }]),
    );
    const id = await ensureTournamentRound(T_ID, DATE);
    expect(id).toBe(500);
    // No insert happened.
    expect((fakeRef.current.data.rounds as any[]).length).toBe(1);
  });

  it("creates a tournament round when none exists (tournament_id set, season_id/format NULL)", async () => {
    fakeRef.current = new FakeSupabase(baseSeed([]));
    const id = await ensureTournamentRound(T_ID, DATE);
    const round = (fakeRef.current.data.rounds as any[]).find((r) => r.id === id);
    expect(round.tournament_id).toBe(T_ID);
    expect(round.season_id).toBe(null);
    expect(round.format).toBe(null);
    expect(round.played_on).toBe(DATE);
  });

  it("throws LeagueRoundOwnsDateError when a league round owns the date (23505, empty re-fetch)", async () => {
    // A league round (tournament_id null) already owns DATE. The tournament-
    // scoped lookup misses it, the insert hits 23505, and the tournament-scoped
    // re-fetch is still empty → league owns the date.
    fakeRef.current = new FakeSupabase(
      baseSeed([{ id: 900, played_on: DATE, course_id: 1, is_complete: true, tournament_id: null, season_id: 3, format: "2_ball" }]),
    );
    fakeRef.current.setOptions({
      failWrite: (op: any) => (op.table === "rounds" ? { code: "23505", message: "duplicate key" } : false),
    });

    const err = await ensureTournamentRound(T_ID, DATE).catch((e) => e);
    expect(err).toBeInstanceOf(LeagueRoundOwnsDateError);
    expect(err).toMatchObject({ code: "league_round_owns_date", date: DATE });
    // The league round is untouched.
    expect((fakeRef.current.data.rounds as any[])).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: 23505 but a concurrent tournament round appears → returns it, no throw", async () => {
    // Same 23505 collision, but this time the re-fetch DOES find a tournament
    // round (a concurrent tournament insert landed first). Must return it.
    const fake = new FakeSupabase(baseSeed([]));
    fakeRef.current = fake;
    fake.setOptions({
      failWrite: (op: any) => {
        if (op.table === "rounds") {
          // simulate the concurrent tournament-round insert landing first
          (fake.data.rounds as any[]).push({ id: 777, played_on: DATE, course_id: 1, is_complete: false, tournament_id: T_ID, season_id: null, format: null });
          return { code: "23505", message: "duplicate key" };
        }
        return false;
      },
    });

    const id = await ensureTournamentRound(T_ID, DATE);
    expect(id).toBe(777); // returned the concurrently-created tournament round, did not throw
  });
});
