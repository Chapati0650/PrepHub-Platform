import { headers } from "next/headers";

export type RateLimitConfig = { limit: number; windowMs: number };

// Global Engineering Requirements §3/§10 — rate limits must be centralized
// rather than scattered hardcoded values, and are required on: login,
// password-reset requests, school-email verification requests, and account
// creation. Deliberately generous windows/limits so ordinary student usage
// (a mistyped password, a student re-requesting a verification email) is
// never blocked — these exist to slow down automated abuse, not to gate
// normal retries.
export const RATE_LIMITS = {
  LOGIN: { limit: 10, windowMs: 5 * 60 * 1000 },
  ACCOUNT_CREATION: { limit: 5, windowMs: 60 * 60 * 1000 },
  PASSWORD_RESET_REQUEST: { limit: 5, windowMs: 15 * 60 * 1000 },
  SCHOOL_EMAIL_VERIFICATION_REQUEST: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;

type Bucket = { count: number; resetAt: number };

// A single process-local, in-memory limiter — deliberately "lightweight"
// (GER §3) for this single-instance monolith (see CLAUDE.md). If this ever
// runs across multiple instances, swap this Map for a shared store (e.g.
// Redis) behind the same `checkRateLimit` signature; no call site would need
// to change.
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

export function checkRateLimitEnforced(key: string, config: RateLimitConfig): RateLimitResult {
  if (!isRateLimitingEnforced()) return { allowed: true, retryAfterMs: 0 };
  return checkRateLimit(key, config);
}

// Test-only escape hatch — production code never needs to clear buckets mid-process.
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}

// Best-effort client IP for rate-limit keying and abuse logging.
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}
