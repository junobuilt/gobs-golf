// Edge-compatible PIN-session helpers. Used by both `src/middleware.ts`
// (Edge runtime) and the /admin/login server action. HMAC-SHA256 via Web
// Crypto only — no Node `crypto` import, no `Buffer`.

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const HEX_HMAC_LEN = 64; // SHA-256 → 32 bytes → 64 hex chars

function getSecret(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s) {
    console.error(
      "ADMIN_COOKIE_SECRET is not set — admin sessions cannot be signed or verified."
    );
    return "";
  }
  return s;
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signSession(): Promise<string> {
  const secret = getSecret();
  if (!secret) return "";
  const expiresAtMs = Date.now() + NINETY_DAYS_MS;
  const message = String(expiresAtMs);
  const sig = await hmacHex(message, secret);
  return `${message}.${sig}`;
}

export async function verifySession(
  value: string | undefined | null
): Promise<boolean> {
  if (!value) return false;
  const secret = getSecret();
  if (!secret) return false;

  const idx = value.indexOf(".");
  if (idx <= 0 || idx === value.length - 1) return false;

  const tsStr = value.slice(0, idx);
  const sig = value.slice(idx + 1);

  if (!/^\d+$/.test(tsStr)) return false;
  if (sig.length !== HEX_HMAC_LEN) return false;
  if (!/^[0-9a-f]+$/.test(sig)) return false;

  const expiresAtMs = Number(tsStr);
  if (!Number.isFinite(expiresAtMs)) return false;
  if (expiresAtMs <= Date.now()) return false;

  const expected = await hmacHex(tsStr, secret);
  return timingSafeEqual(sig, expected);
}

// ── Backup admin session (expiring substitute credential) ────────────────────
// Distinct cookie from `admin_session`. Value shape: `b.<credId>.<expiresAtMs>.<hmac>`.
// The `b.` prefix is folded into the signed message so a primary-session cookie
// (whose message is pure digits) can never be replayed as a backup cookie, and
// vice-versa — domain separation while reusing ADMIN_COOKIE_SECRET. Like the
// primary helpers this is pure Web Crypto so middleware (Edge) can verify it
// with NO DB round-trip (expiry + signature only); the per-request credential
// re-check that gives immediate-revoke lives in the middleware itself.

function backupMessage(credId: number, expiresAtMs: number): string {
  return `b.${credId}.${expiresAtMs}`;
}

export async function signBackupSession(
  credId: number,
  expiresAtMs: number
): Promise<string> {
  const secret = getSecret();
  if (!secret) return "";
  const message = backupMessage(credId, expiresAtMs);
  const sig = await hmacHex(message, secret);
  return `${message}.${sig}`;
}

/**
 * Verify a backup-session cookie's signature + expiry (no DB). Returns the
 * decoded `{ credId, expiresAtMs }` when authentic and unexpired, else null so
 * the caller can branch. The credential's *live* status (revoked / superseded)
 * is NOT checked here — that's the middleware's per-request DB re-check.
 */
export async function verifyBackupSession(
  value: string | undefined | null
): Promise<{ credId: number; expiresAtMs: number } | null> {
  if (!value) return null;
  const secret = getSecret();
  if (!secret) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [prefix, credStr, tsStr, sig] = parts;

  if (prefix !== "b") return null;
  if (!/^\d+$/.test(credStr)) return null;
  if (!/^\d+$/.test(tsStr)) return null;
  if (sig.length !== HEX_HMAC_LEN) return null;
  if (!/^[0-9a-f]+$/.test(sig)) return null;

  const credId = Number(credStr);
  const expiresAtMs = Number(tsStr);
  if (!Number.isFinite(credId) || !Number.isFinite(expiresAtMs)) return null;
  if (expiresAtMs <= Date.now()) return null;

  const expected = await hmacHex(backupMessage(credId, expiresAtMs), secret);
  if (!timingSafeEqual(sig, expected)) return null;
  return { credId, expiresAtMs };
}

// Per-request re-check that a backup credential is still LIVE (R4 immediate-
// revoke): the row exists, is not revoked, and has not expired. This is the DB
// half of the backup path — verifyBackupSession only proves the cookie's
// signature + expiry (no DB). Runs ONLY on the backup path (a valid primary
// session never reaches it — R6). Fails CLOSED on any error / unreachable DB:
// an admin gate must deny on doubt. Edge-compatible (fetch + Web env only, no
// supabase-js). SSOT — imported by both middleware.ts (the /admin gate) and the
// /api/admin/status route (the tournament-scorecard admin check); do NOT
// duplicate the query.
export async function backupCredentialLive(credId: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const nowIso = new Date().toISOString();
    const q = new URL(`${url}/rest/v1/admin_backup_pin`);
    q.searchParams.set("select", "id");
    q.searchParams.set("id", `eq.${credId}`);
    q.searchParams.set("revoked_at", "is.null");
    q.searchParams.set("expires_at", `gt.${nowIso}`);
    q.searchParams.set("limit", "1");

    const res = await fetch(q.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}
