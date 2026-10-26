import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { logServerError } from "@/lib/logger";

export type RateLimitConfig = { limit: number; windowMs: number };

// Global Engineering Requirements §3/§10 — rate limits must be centralized
// rather than scattered hardcoded values, and are required on: login,
// password-reset requests, school-email verification requests, and account
// creation. Deliberately generous windows/limits so ordinary student usage
// (a mistyped password, a student re-requesting a verification email) is
// never blocked — these exist to slow down automated abuse, not to gate
// normal retries.
//
// **Per-IP and per-identity limits are separate entries, with very different
// numbers, and that separation is the whole point.** They were one shared
// config until 2026-10-21, which made them unusable for a school: every
// student on a campus network shares one public NAT address, so a homeroom of
// thirty signing up together was thirty signups from one IP, against a limit
// of five an hour. The sixth student — in the room, with us standing there —
// would have been told to come back later. A computer lab logging in at the
// start of a period hit the same wall at ten.
//
// So the two dimensions now carry the protection they are each actually good
// for. The per-identity limit is the security-relevant one: it is what stops
// an attacker working on one account, and it stays tight, because no real
// person needs eleven password attempts in five minutes. The per-IP limit is
// a flood guard against one host spraying many accounts, and it is set where
// a whole campus fits underneath it. An attacker from a single address is
// still slowed by two orders of magnitude versus no limit at all.
export const RATE_LIMITS = {
  /** One account under attack. Tight: no real person needs an eleventh try. */
  LOGIN_PER_EMAIL: { limit: 10, windowMs: 5 * 60 * 1000 },
  /**
   * One network. Sized for a 2,000-student campus at the first bell, where
   * most of the school signs in from one address within a few minutes — a
   * number that only became a real ceiling once counts were shared across
   * server instances (below); a per-instance count was quietly far looser.
   */
  LOGIN_PER_IP: { limit: 1_500, windowMs: 5 * 60 * 1000 },

  /**
   * Account creation has no per-identity dimension to key on — an address can
   * only ever hold one account, which the unique constraint already enforces
   * — so the per-IP limit is the only tool here. Sized for two large
   * homerooms back to back, with retries.
   */
  ACCOUNT_CREATION_PER_IP: { limit: 200, windowMs: 60 * 60 * 1000 },

  /**
   * The same, for an address on a partner district's domain: a rollout day,
   * when a whole school creates accounts from one network in the same hour.
   * Bulk fake signups gain nothing from a partner domain, because an account
   * there unlocks nothing until its inbox confirms it.
   */
  ACCOUNT_CREATION_PER_IP_PARTNER: { limit: 3_000, windowMs: 60 * 60 * 1000 },

  /** Stops one student's inbox being flooded with reset mail. */
  PASSWORD_RESET_PER_EMAIL: { limit: 5, windowMs: 15 * 60 * 1000 },
  PASSWORD_RESET_PER_IP: { limit: 100, windowMs: 15 * 60 * 1000 },

  /**
   * Already keyed per authenticated account rather than per IP, so a campus
   * never shares a bucket and this one needs no second dimension.
   */
  SCHOOL_EMAIL_VERIFICATION_REQUEST: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;

type Bucket = { count: number; resetAt: number };

// Two stores, and the choice is made by "are the Upstash variables set", the
// same way storage.ts chooses R2.
//
// The fallback is a process-local, in-memory Map. On serverless each warm
// instance keeps its own Map and a cold start begins with an empty one, so
// the effective limit is per-instance and resets unpredictably — a
// determined attacker spread across instances gets more than the numbers
// above suggest. It still makes a naive scripted loop against one account
// unproductive, which is why the per-identity limits are kept tight.
//
// With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set, counts live
// in Redis and every instance shares them, so the numbers above mean what
// they say. A store that is slow or down never blocks a login: the request
// is counted locally instead and the failure logged.
const buckets = new Map<string, Bucket>();

// Opportunistic sweep triggered by size rather than a timer, so an
// unbounded-growth guard can't leak a setInterval across Next.js dev-mode
// hot reloads.
const SWEEP_THRESHOLD = 10_000;
function sweepExpired(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

// The pure counting logic — kept side-effect-free (no environment checks)
// so its behavior is fully exercised by unit tests regardless of NODE_ENV.
// Call sites use `checkRateLimitEnforced` below, not this directly.
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (bucket.count >= config.limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Rate limiting is enforced in production only. Local dev has no reverse
// proxy setting a real client IP, so every request shares one "unknown"
// bucket — harmless during manual dev browsing, but e2e suites legitimately
// create dozens of accounts and log in dozens of times per run from that
// same shared bucket, which would trip these limits well before any real
// abuse threshold. GER §9's "non-production work must not use production
// credentials" is the same non-prod-gets-relaxed-behavior spirit applied
// here. `checkRateLimit` itself stays enforced-agnostic and pure.
export function isRateLimitingEnforced(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function checkRateLimitEnforced(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  if (!isRateLimitingEnforced()) return { allowed: true, retryAfterMs: 0 };
  const store = sharedStore();
  if (store) {
    const shared = await checkRateLimitShared(key, config, store);
    if (shared) return shared;
    logServerError("Rate-limit store unreachable; counted on this instance instead", { errorType: "RateLimitStore" });
  }
  return checkRateLimit(key, config);
}

export type SharedStore = { url: string; token: string };

function sharedStore(): SharedStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

/** Long enough for a healthy round trip, short enough that a login never waits on a sick store. */
const SHARED_STORE_TIMEOUT_MS = 1_500;

/**
 * A fixed-window count in Redis: one key per bucket per window, incremented
 * and given an expiry in a single round trip. Returns null when the store
 * can't answer in time, which the caller treats as "count locally".
 *
 * Keys are hashed before they leave the app. They contain email addresses
 * and IP addresses, and a rate-limit counter has no need to hold either in
 * readable form in a third party's database.
 */
export async function checkRateLimitShared(
  key: string,
  config: RateLimitConfig,
  store: SharedStore,
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<RateLimitResult | null> {
  const window = Math.floor(now / config.windowMs);
  const windowKey = `rl:${createHash("sha256").update(key).digest("base64url").slice(0, 32)}:${config.windowMs}:${window}`;
  try {
    const response = await fetchImpl(`${store.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${store.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", windowKey],
        ["PEXPIRE", windowKey, String(config.windowMs)],
      ]),
      signal: AbortSignal.timeout(SHARED_STORE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const [incremented] = (await response.json()) as { result?: unknown }[];
    if (typeof incremented?.result !== "number") return null;
    if (incremented.result > config.limit) {
      return { allowed: false, retryAfterMs: (window + 1) * config.windowMs - now };
    }
    return { allowed: true, retryAfterMs: 0 };
  } catch {
    return null;
  }
}

// Test-only escape hatch — production code never needs to clear buckets mid-process.
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}

// Best-effort client IP for rate-limit keying and abuse logging.
// x-nf-client-connection-ip is checked first — Netlify's own header for the
// true connecting client IP, set directly by its edge network rather than
// relying on a proxy chain. Added after a real production incident: every
// visitor was silently sharing one "unknown" bucket (x-forwarded-for/x-real-ip
// were both absent under this host), so heavy automated testing against
// production exhausted ACCOUNT_CREATION's 5-per-hour limit for literally
// everyone — including real visitors on completely unrelated devices/networks
// — which looked identical to a broken auth flow (stuck-on-login-forever)
// rather than what it actually was.
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const netlifyIp = h.get("x-nf-client-connection-ip");
  if (netlifyIp) return netlifyIp.trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}
