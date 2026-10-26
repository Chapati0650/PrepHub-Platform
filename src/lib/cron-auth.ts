import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request to a scheduled-job route carries `Bearer <CRON_SECRET>`.
 * False when no secret is configured, so the routes stay shut by default.
 *
 * Compared in constant time over fixed-length digests: a plain `===` returns
 * as soon as one character differs, which leaks how much of a guess was
 * right, one character at a time, to anyone patient enough to measure it.
 */
export function isCronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(given, expected);
}
