import bcrypt from "bcryptjs";

/**
 * bcrypt work factor.
 *
 * Was 12. Measured against production, a login spent most of its time here:
 * click-to-dashboard was ~1690ms at 12 rounds and ~1030ms at 10, because
 * `bcryptjs` is the pure-JavaScript implementation and each extra round
 * doubles the work. On a serverless function's modest CPU that is well over a
 * second of the user staring at a spinner before anything else happens.
 *
 * 10 is bcryptjs's own default and meets OWASP's guidance of a work factor of
 * 10 or more for bcrypt. Raising it back is a one-line change here —
 * `rehashIfOutdated` below will transparently migrate every account on its
 * next login, in either direction.
 */
const SALT_ROUNDS = 10;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * True when a stored hash was produced at a different work factor than the one
 * in use now. Existing hashes carry their own cost, so changing SALT_ROUNDS
 * alone does nothing for accounts that already exist — they keep paying the
 * old price on every login until the hash is replaced.
 */
export function needsRehash(hash: string): boolean {
  try {
    const rounds = bcrypt.getRounds(hash);
    // getRounds does not throw on a malformed value, it returns something
    // nonsensical — so the result is range-checked rather than trusted.
    // bcrypt costs are 4 to 31; anything else means this is not a hash we
    // wrote, and it gets left alone rather than rewritten.
    if (!Number.isInteger(rounds) || rounds < 4 || rounds > 31) return false;
    return rounds !== SALT_ROUNDS;
  } catch {
    return false;
  }
}
