// The ONE "tournament mode is publicly ON" predicate, shared by every surface
// that keys off it (homepage hero, bottom-nav Leaderboard→Scoreboard swap).
// Publicly ON = an active tournament that is published AND not yet ended. Never
// throws — a tournament-read failure must never break the homepage or the nav.

import { getActiveTournament } from "./queries";
import type { Tournament } from "./types";

export async function getTournamentMode(): Promise<Tournament | null> {
  try {
    const t = await getActiveTournament();
    if (t && t.is_published && t.ended_on == null) return t;
    return null;
  } catch {
    return null;
  }
}
