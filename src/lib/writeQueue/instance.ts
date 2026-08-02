// Client-side singleton for the score write queue. Lazy-initialized on
// first call to getWriteQueue() so that SSR never touches it. The queue
// outlives any individual page mount — that's the whole point of the
// durability guarantee — which means we cannot put it in a React useRef.

import * as Sentry from "@sentry/nextjs";
import { supabase } from "@/lib/supabase";
import { WriteQueue } from "./WriteQueue";
import type {
  QueueItem,
  ScorePayload,
  SentryReporter,
  TeamScorePayload,
  TerminalReason,
  WriteResult,
} from "./types";

let instance: WriteQueue<ScorePayload> | null = null;
let teamInstance: WriteQueue<TeamScorePayload> | null = null;

// Distinct localStorage namespace so a stuck greensomes team item never shares
// state with — or blocks the drain of — individual scores.
const TEAM_STORAGE_KEY = "gobs:team-write-queue:v1";

/**
 * Return the singleton WriteQueue. Constructs and starts the queue on
 * first call; subsequent calls return the same instance. Throws on the
 * server — components must guard with `typeof window !== "undefined"` or
 * call this only from useEffect.
 */
export function getWriteQueue(): WriteQueue<ScorePayload> {
  if (typeof window === "undefined") {
    throw new Error("getWriteQueue() called during SSR");
  }
  if (instance === null) {
    instance = new WriteQueue<ScorePayload>({
      writer: supabaseUpsertWriter,
      sentry: sentryReporter,
    });
    instance.start();
  }
  return instance;
}

/**
 * Return the singleton team-score WriteQueue (tournament greensomes). Same
 * durability/retry/backoff as the individual score queue, but writes to
 * `team_scores` and keeps its own localStorage namespace. Constructs + starts
 * on first call. Throws on the server, like getWriteQueue().
 */
export function getTeamWriteQueue(): WriteQueue<TeamScorePayload> {
  if (typeof window === "undefined") {
    throw new Error("getTeamWriteQueue() called during SSR");
  }
  if (teamInstance === null) {
    teamInstance = new WriteQueue<TeamScorePayload>({
      writer: teamScoreUpsertWriter,
      kind: "team_score_upsert",
      storageKey: TEAM_STORAGE_KEY,
      sentry: sentryReporter,
    });
    teamInstance.start();
  }
  return teamInstance;
}

/**
 * Test-only: tear down the singletons so the next getWriteQueue() /
 * getTeamWriteQueue() call builds a fresh one. Combined with
 * localStorage.clear() in beforeEach, this gives each test a clean slate.
 */
export function resetWriteQueueForTesting(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
  if (teamInstance) {
    teamInstance.stop();
    teamInstance = null;
  }
}

const supabaseUpsertWriter = async (item: QueueItem<ScorePayload>): Promise<WriteResult> => {
  try {
    const { error } = await supabase
      .from("scores")
      .upsert(
        {
          round_player_id: item.payload.round_player_id,
          hole_number: item.payload.hole_number,
          strokes: item.payload.strokes,
        },
        { onConflict: "round_player_id,hole_number" },
      );
    if (!error) return { success: true };
    return {
      success: false,
      classification: classifySupabaseError(error),
      terminalReason: getTerminalReason(error),
      error,
    };
  } catch (err) {
    // Thrown errors (network failure before HTTP response) are retryable.
    return { success: false, classification: "retry", error: err };
  }
};

// Greensomes alternate shot: one collapsed team score per (round, team, hole)
// at ball_index = 1. onConflict matches team_scores_round_team_hole_ball_key so
// re-entering a box overwrites in place (last-write-wins), same contract as the
// direct team-card upsert — but now durable/retrying under the queue.
const teamScoreUpsertWriter = async (item: QueueItem<TeamScorePayload>): Promise<WriteResult> => {
  try {
    const { error } = await supabase
      .from("team_scores")
      .upsert(
        {
          round_id: item.payload.round_id,
          team_number: item.payload.team_number,
          hole_number: item.payload.hole_number,
          ball_index: item.payload.ball_index,
          strokes: item.payload.strokes,
        },
        { onConflict: "round_id,team_number,hole_number,ball_index" },
      );
    if (!error) return { success: true };
    return {
      success: false,
      classification: classifySupabaseError(error),
      terminalReason: getTerminalReason(error),
      error,
    };
  } catch (err) {
    return { success: false, classification: "retry", error: err };
  }
};

/**
 * D.1: extract a known terminal sub-reason from a Supabase error so the
 * UI can show specialized copy. Today only `round_finalized` is recognized
 * (raised by the BEFORE INSERT/UPDATE trigger on `scores` when the parent
 * round is locked). Returns null when the error has no known sub-reason.
 */
export function getTerminalReason(err: unknown): TerminalReason {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; message?: string };
  if (e.code === "P0001" && typeof e.message === "string" &&
      e.message.includes("round_finalized")) {
    return "round_finalized";
  }
  return null;
}

/**
 * D8: 4xx-equivalent → terminal; 5xx + network → retry. Supabase's REST
 * layer uses PostgreSQL error codes (5-char SQLSTATE) for DB errors and
 * PGRST-prefixed codes for its own REST layer. Unknown → retry, so a
 * transient bug looks like a slow sync rather than a silent loss.
 */
export function classifySupabaseError(err: unknown): "retry" | "terminal" {
  if (!err || typeof err !== "object") return "retry";
  const e = err as { code?: string; message?: string; status?: number };
  const code = e.code;
  // PostgreSQL constraint violations (23xxx) → terminal. Includes FK
  // (23503) and unique (23505 — shouldn't happen with onConflict, but
  // guard anyway).
  if (typeof code === "string" && code.startsWith("23")) return "terminal";
  // RLS / privilege denied → terminal; retry can't fix permissions.
  if (code === "42501") return "terminal";
  // Statement timeout → retry. Transient.
  if (code === "57014") return "retry";
  // Supabase REST-layer errors. PGRST116 = no rows on .single(); other
  // PGRSTs are mostly connection/transport — treat as retry.
  if (typeof code === "string" && code.startsWith("PGRST")) return "retry";
  // HTTP status if present.
  if (typeof e.status === "number") {
    if (e.status >= 400 && e.status < 500) return "terminal";
    return "retry";
  }
  // Unknown shape → retry. We err toward "keep trying" rather than
  // silently dropping data.
  return "retry";
}

const sentryReporter: SentryReporter = {
  captureMessage(msg, ctx) {
    try {
      Sentry.captureMessage(msg, { level: "warning", extra: ctx });
    } catch {
      // Sentry shouldn't gate queue behavior. Swallow if it throws.
    }
  },
  captureException(err, ctx) {
    try {
      Sentry.captureException(err, { extra: ctx });
    } catch {
      // Same — never let Sentry crash the queue.
    }
  },
};
