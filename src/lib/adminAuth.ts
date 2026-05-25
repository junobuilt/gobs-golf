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
