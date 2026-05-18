// Client-side singleton for the score write queue. Lazy-initialized on
// first call to getWriteQueue() so that SSR never touches it. The queue
// outlives any individual page mount — that's the whole point of the
// durability guarantee — which means we cannot put it in a React useRef.

import * as Sentry from "@sentry/nextjs";
import { supabase } from "@/lib/supabase";
import { WriteQueue } from "./WriteQueue";
import type { QueueItem, SentryReporter, TerminalReason, WriteResult } from "./types";

let instance: WriteQueue | null = null;

/**
 * Return the singleton WriteQueue. Constructs and starts the queue on
 * first call; subsequent calls return the same instance. Throws on the
 * server — components must guard with `typeof window !== "undefined"` or
 * call this only from useEffect.
 */
export function getWriteQueue(): WriteQueue {
  if (typeof window === "undefined") {
    throw new Error("getWriteQueue() called during SSR");
  }
  if (instance === null) {
    instance = new WriteQueue({
      writer: supabaseUpsertWriter,
      sentry: sentryReporter,
    });
    instance.start();
  }
  return instance;
}

/**
 * Test-only: tear down the singleton so the next getWriteQueue() call
 * builds a fresh one. Combined with localStorage.clear() in beforeEach,
 * this gives each test a clean slate.
 */
export function resetWriteQueueForTesting(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

const supabaseUpsertWriter = async (item: QueueItem): Promise<WriteResult> => {
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
