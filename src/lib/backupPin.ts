// Backup-admin-PIN hashing — Node `crypto` only (scrypt). Imported solely by
// server actions (login verify + the mint action); never reaches the client
// bundle. NOT marked `'server-only'` (kept LEAN), but treat it as server-only by
// usage.
//
// Posture note: `admin_backup_pin` is allow-all RLS like every other table in
// this repo (proper lockdown is parked for a future holistic RLS pass — see
// ROADMAP). Because the anon key is public, the stored hash is effectively
// world-readable, and a bare 4-digit-PIN scrypt hash is reversible in ~10^4
// guesses. To keep "scrypt hash at rest" meaningful under that posture we PEPPER
// the scrypt input with the server-only ADMIN_COOKIE_SECRET, which an anon
// reader does NOT possess — so the readable hash cannot be brute-forced offline.
// The expiry window remains the primary control; the pepper is defense-in-depth.

import {
  scrypt as _scrypt,
  randomBytes,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const SCRYPT_N = 16384; // CPU/memory cost
const KEY_LEN = 32;
const SALT_BYTES = 16;

// Promise wrapper that preserves the options overload (node:util.promisify
// resolves to the no-options signature, which drops the cost parameter).
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function getPepper(): string {
  const s = process.env.ADMIN_COOKIE_SECRET;
  if (!s) {
    // Mirror adminAuth.getSecret(): fail closed rather than hash without a
    // pepper. A blank pepper would silently weaken every stored hash.
    throw new Error(
      "ADMIN_COOKIE_SECRET is not set — refusing to hash a backup PIN."
    );
  }
  return s;
}

/**
 * Hash a 4-digit backup PIN for storage. Returns a self-describing string
 * `scrypt$<N>$<saltHex>$<hashHex>` — no schema column needed, no npm dep.
 */
export async function hashBackupPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(pin + getPepper(), salt, KEY_LEN, {
    N: SCRYPT_N,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Constant-time verify a candidate PIN against a stored `scrypt$...` string.
 * Returns false (never throws) on any malformed/unknown stored format.
 */
export async function verifyBackupPin(
  pin: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (!/^[0-9a-f]+$/.test(parts[2]) || !/^[0-9a-f]+$/.test(parts[3])) {
    return false;
  }

  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  let derived: Buffer;
  try {
    derived = await scrypt(pin + getPepper(), salt, expected.length, { N: n });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
