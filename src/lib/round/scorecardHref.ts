import type { Format } from "@/lib/scoring/types";
import { isTeamCardFormat } from "@/lib/format/helpers";

// Wave 1B — single routing decision for "open this team's card". Team-card
// formats (Shambles) route to the team-card surface; every other format keeps
// the individual scorecard. All entry points (homepage team links, post-
// team-formation pushes, the admin Round Setup "open scorecard" link) call this
// so the decision lives in one place.
export function scorecardHref(
  roundId: number | string,
  teamNumber: number,
  format: Format | null | undefined,
  opts?: { admin?: boolean; edit?: boolean },
): string {
  const surface = isTeamCardFormat(format ?? null) ? "team-card" : "scorecard";
  const extra: string[] = [];
  if (opts?.admin) extra.push("admin=1");
  if (opts?.edit) extra.push("edit=1");
  const base = `/round/${roundId}/${surface}?team=${teamNumber}`;
  return extra.length ? `${base}&${extra.join("&")}` : base;
}
