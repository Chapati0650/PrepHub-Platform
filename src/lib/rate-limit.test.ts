import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  checkRateLimitEnforced,
  isRateLimitingEnforced,
  __resetRateLimitsForTests,
  RATE_LIMITS,
} from "@/lib/rate-limit";

beforeEach(() => {
  __resetRateLimitsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows requests up to the configured limit", () => {
    const config = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("k1", config).allowed).toBe(true);
    expect(checkRateLimit("k1", config).allowed).toBe(true);
    expect(checkRateLimit("k1", config).allowed).toBe(true);
  });

  it("blocks the request once the limit is exceeded within the window", () => {
    const config = { limit: 2, windowMs: 60_000 };
    checkRateLimit("k2", config);
    checkRateLimit("k2", config);

    const result = checkRateLimit("k2", config);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the bucket once the window has elapsed", () => {
    const config = { limit: 1, windowMs: 60_000 };
    checkRateLimit("k3", config);
    expect(checkRateLimit("k3", config).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(checkRateLimit("k3", config).allowed).toBe(true);
  });

  it("tracks independent keys separately", () => {
    const config = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("student-a", config).allowed).toBe(true);
    expect(checkRateLimit("student-b", config).allowed).toBe(true);
    // Both now at their individual limit.
    expect(checkRateLimit("student-a", config).allowed).toBe(false);
    expect(checkRateLimit("student-b", config).allowed).toBe(false);
  });

  it("defines a centralized config entry for every endpoint required by the Global Engineering Requirements", () => {
    expect(RATE_LIMITS.LOGIN.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.ACCOUNT_CREATION.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.PASSWORD_RESET_REQUEST.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.SCHOOL_EMAIL_VERIFICATION_REQUEST.limit).toBeGreaterThan(0);
  });
});

describe("isRateLimitingEnforced / checkRateLimitEnforced", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });

  it("is not enforced outside production, so e2e suites and local dev never collide on a shared bucket", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isRateLimitingEnforced()).toBe(false);

    const config = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimitEnforced("dev-key", config).allowed).toBe(true);
    expect(checkRateLimitEnforced("dev-key", config).allowed).toBe(true);
    expect(checkRateLimitEnforced("dev-key", config).allowed).toBe(true);
  });

  it("is enforced in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isRateLimitingEnforced()).toBe(true);

    const config = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimitEnforced("prod-key", config).allowed).toBe(true);
    expect(checkRateLimitEnforced("prod-key", config).allowed).toBe(false);
  });
});
