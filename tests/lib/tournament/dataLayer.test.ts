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
vi.mock("@/lib/date", () => ({
  todayLocal: () => "2026-08-01",
  yesterdayLocal: () => "2026-07-31",
}));

import { FakeSupabase } from "../../components/fake-supabase";
import {
  getActiveTournament,
  getTournamentPlayers,
  getTournamentSessions,
  getTournamentWithSessions,
} from "@/lib/tournament/queries";
import {
  createSession,
  createTournament,
  endTournament,
  setPlayerSide,
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
});
