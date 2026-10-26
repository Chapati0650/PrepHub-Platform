import { createHmac, timingSafeEqual } from "node:crypto";

// One-click opt-out from the daily reminder, reachable from the email itself.
// The only other way off was to sign in and find the toggle in Settings, which
// a student who stopped using PrepHub won't do: they mark the mail as spam
// instead, and a spam complaint counts against the one sending domain that
// also carries password resets, district confirmations and school
// announcements.
//
// The link carries the account id and an HMAC of it under AUTH_SECRET, so it
// can't be forged for someone else and needs no table. It never expires, the
// way an unsubscribe link shouldn't.

const PURPOSE = "unsubscribe:daily_reminder";

function signature(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}:${userId}`).digest("base64url");
}

/** Null when no secret is configured: an unsigned link would let anyone opt anyone out. */
export function unsubscribeToken(userId: string, secret = process.env.AUTH_SECRET): string | null {
  if (!secret) return null;
  return `${userId}.${signature(userId, secret)}`;
}

/** The account id the token was made for, or null if it isn't genuine. */
export function verifyUnsubscribeToken(token: string, secret = process.env.AUTH_SECRET): string | null {
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(userId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
