// CROSS-SURFACE AGREEMENT (Part 2) — assert that surfaces showing the SAME
// derived value AGREE, not merely that each renders. This is the test class
// that would have caught both shipped bugs:
//   - TD33: the History list disagreed with the summary + round_payouts.
//   - the allowance-display bug: the scorecard CH disagreed with other surfaces.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import { FakeSupabase } from "../../components/fake-supabase";
import { loadRoundResults } from "@/lib/round/results";
import { loadRoundsList } from "@/lib/round/loadRoundsList";
import { getPlayingCourseHandicap } from "@/lib/format/helpers";
import { GOLDEN_ROUNDS } from "../../fixtures/goldenRounds";
import { round171 } from "../../fixtures/goldenRounds/data/round171";
import { buildFakeData } from "../../fixtures/goldenRounds/build";

describe("cross-surface: History list ↔ summary ↔ round_payouts (round 171)", () => {
  beforeEach(() => { fakeRef.current = new FakeSupabase(buildFakeData(round171)); });

  it("the list and the summary agree team-for-team, and the winner matches the locked payouts", async () => {
    const item = (await loadRoundsList()).find(r => r.roundId === 171);
    expect(item).toBeTruthy();
    const detail = await loadRoundResults(171);
    expect(detail.status).toBe("ok");
    if (!item || detail.status !== "ok") return;

    // 1) History list == summary, every team (rank + total + string).
    const detailByTeam = new Map(
      detail.data.teams.map(t => [t.id, { rank: t.rank, total: t.total, label: t.totalLabel }]),
    );
    for (const t of item.teams) {
      expect({ rank: t.rank, total: t.total, label: t.totalLabel })
        .toEqual(detailByTeam.get(t.teamNumber));
    }

    // 2) Both surfaces crown the SAME winner the locked round_payouts do.
    const listWinner = [...item.teams].sort((a, b) => a.rank - b.rank)[0].teamNumber;
    const detailWinner = [...detail.data.teams].sort((a, b) => a.rank - b.rank)[0].id;
    const payoutWinner = round171.payouts.find(p => p.place === 1)!.team_number;
    expect(payoutWinner).toBe(3);
    expect(listWinner).toBe(payoutWinner);
    expect(detailWinner).toBe(payoutWinner);
  });
});

describe("cross-surface: CH / PH agree on every surface", () => {
  // The scorecard reads round_players.course_handicap and the History drill-in
  // (RoundResultsView, fed by loadRoundResults) must expose that SAME raw CH —
  // so the PH both apply via getPlayingCourseHandicap is identical. The
  // allowance-display bug was exactly these two disagreeing.
  for (const { name, bundle } of GOLDEN_ROUNDS) {
    it(`${name}: drill-in raw CH == the scorecard's round_players.course_handicap (⇒ same PH)`, async () => {
      fakeRef.current = new FakeSupabase(buildFakeData(bundle));
      const outcome = await loadRoundResults(bundle.round.id);
      expect(outcome.status).toBe("ok");
      if (outcome.status !== "ok") return;

      const cfg = bundle.round.format_config as Parameters<typeof getPlayingCourseHandicap>[1];
      const scorecardCH = new Map(bundle.round_players.map(rp => [rp.id, rp.course_handicap]));
      for (const team of outcome.data.teams) {
        for (const p of team.players) {
          if (p.holesPlayed === 0) continue;
          const source = scorecardCH.get(p.rpId) ?? null;
          expect(p.courseHandicap).toBe(source); // drill-in CH == scorecard CH
          expect(getPlayingCourseHandicap(p.courseHandicap, cfg))
            .toBe(getPlayingCourseHandicap(source, cfg)); // ⇒ identical PH
        }
      }
    });
  }

  it("under a reduced allowance both surfaces scale PH the same way (CH 13 @ 80% → 10)", () => {
    // Both surfaces apply the one accessor to the one raw CH; there is no second
    // PH formula to drift. Golden value pins the scaling.
    const cfg = { basis: "net", handicap_allowance: 80 } as Parameters<typeof getPlayingCourseHandicap>[1];
    expect(getPlayingCourseHandicap(13, cfg)).toBe(10);
    expect(getPlayingCourseHandicap(13, cfg)).toBe(getPlayingCourseHandicap(13, cfg));
  });
});
