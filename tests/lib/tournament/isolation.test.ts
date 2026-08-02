// Isolation regression under REAL tournament data (proves Phase 1.1 holds):
// a round created through the tournament data layer must never surface on a
// league read, even when finalized.

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
import { loadRoundsList } from "@/lib/round/loadRoundsList";
import { createSession, createTournament } from "@/lib/tournament/mutations";

function seed(): FakeData {
  return {
    rounds: [],
    tees: [],
    holes: [],
    round_players: [],
    players: [],
    scores: [],
    tournaments: [],
    tournament_players: [],
    tournament_sessions: [],
  };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

describe("tournament round isolation (real data layer)", () => {
  it("a finalized tournament round is absent from loadRoundsList and the homepage query", async () => {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    const session = await createSession({ tournamentId: t.id, dayNumber: 1, name: "Day 1", format: "four_ball_match", playedOn: "2026-08-01" });
    const roundId = session.round_id!;
    // Finalize it, so ONLY the tournament_id filter can exclude it (not is_complete).
    (fakeRef.current.data.rounds as any[]).find((r) => r.id === roundId).is_complete = true;

    // History finalized list.
    const items = await loadRoundsList();
    expect(items.map((i) => i.roundId)).not.toContain(roundId);

    // Homepage query shape (.or is a fake no-op; .is("tournament_id", null) does the work).
    const { data: home } = await fakeRef.current
      .from("rounds")
      .select("id, played_on, is_complete")
      .or("played_on.eq.2026-08-01,and(played_on.eq.2026-07-31,is_complete.eq.false)")
      .is("tournament_id", null);
    expect((home as any[]).map((r) => r.id)).not.toContain(roundId);
  });

  it("NEGATIVE CONTROL: without the tournament_id filter the same round surfaces", async () => {
    const t = await createTournament({ name: "Cup", startedOn: "2026-08-01", sideAName: "USA", sideBName: "Canada", holderSide: "b" });
    const session = await createSession({ tournamentId: t.id, dayNumber: 1, name: "Day 1", format: "singles_match", playedOn: "2026-08-01" });
    const roundId = session.round_id!;
    (fakeRef.current.data.rounds as any[]).find((r) => r.id === roundId).is_complete = true;

    const { data } = await fakeRef.current.from("rounds").select("id").eq("is_complete", true);
    expect((data as any[]).map((r) => r.id)).toContain(roundId); // exists; only the filter hides it
  });
});
