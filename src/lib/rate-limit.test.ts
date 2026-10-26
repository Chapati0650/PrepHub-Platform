import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  checkRateLimitEnforced,
  checkRateLimitShared,
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
    expect(RATE_LIMITS.LOGIN_PER_EMAIL.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.LOGIN_PER_IP.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.ACCOUNT_CREATION_PER_IP.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.PASSWORD_RESET_PER_EMAIL.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.PASSWORD_RESET_PER_IP.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.SCHOOL_EMAIL_VERIFICATION_REQUEST.limit).toBeGreaterThan(0);
  });

  // The regression this guards: every student on a campus network shares one
  // public NAT address, so a per-IP limit sized for one household locks out a
  // whole homeroom. These floors are a deliberate statement that the per-IP
  // buckets must fit a classroom, not a person.
  it("sizes the per-IP buckets for a whole campus sharing one NAT address", () => {
    expect(RATE_LIMITS.ACCOUNT_CREATION_PER_IP.limit).toBeGreaterThanOrEqual(100);
    // A 2,000-student school's rollout day and first bell, from one address.
    expect(RATE_LIMITS.ACCOUNT_CREATION_PER_IP_PARTNER.limit).toBeGreaterThanOrEqual(2_000);
    expect(RATE_LIMITS.LOGIN_PER_IP.limit).toBeGreaterThanOrEqual(1_000);
    expect(RATE_LIMITS.PASSWORD_RESET_PER_IP.limit).toBeGreaterThanOrEqual(50);
  });

  // ...while the per-identity buckets stay tight, because that is where the
  // actual protection lives once the IP side has been opened up.
  it("keeps the per-identity buckets tight", () => {
    expect(RATE_LIMITS.LOGIN_PER_EMAIL.limit).toBeLessThanOrEqual(20);
    expect(RATE_LIMITS.PASSWORD_RESET_PER_EMAIL.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.LOGIN_PER_EMAIL.limit).toBeLessThan(RATE_LIMITS.LOGIN_PER_IP.limit);
  });
});

describe("isRateLimitingEnforced / checkRateLimitEnforced", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });

  it("is not enforced outside production, so e2e suites and local dev never collide on a shared bucket", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isRateLimitingEnforced()).toBe(false);

    const config = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimitEnforced("dev-key", config)).allowed).toBe(true);
    expect((await checkRateLimitEnforced("dev-key", config)).allowed).toBe(true);
    expect((await checkRateLimitEnforced("dev-key", config)).allowed).toBe(true);
  });

  it("is enforced in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isRateLimitingEnforced()).toBe(true);

    const config = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimitEnforced("prod-key", config)).allowed).toBe(true);
    expect((await checkRateLimitEnforced("prod-key", config)).allowed).toBe(false);
  });

  it("counts on this instance when the shared store is configured but unreachable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const config = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimitEnforced("fallback-key", config)).allowed).toBe(true);
    expect((await checkRateLimitEnforced("fallback-key", config)).allowed).toBe(false);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("checkRateLimitShared", () => {
  const store = { url: "https://redis.example", token: "secret-token" };
  const config = { limit: 3, windowMs: 60_000 };
  const NOW = Date.parse("2026-01-01T00:00:20.000Z");

  function storeReturning(count: number) {
    return vi.fn().mockResolvedValue(new Response(JSON.stringify([{ result: count }, { result: 1 }])));
  }

  it("allows a request while the shared count is within the limit", async () => {
    const fetchImpl = storeReturning(3);
    expect(await checkRateLimitShared("login:ip:1.2.3.4", config, store, NOW, fetchImpl)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it("blocks past the limit until the window ends", async () => {
    const result = await checkRateLimitShared("login:ip:1.2.3.4", config, store, NOW, storeReturning(4));
    // 20 seconds into a one-minute window.
    expect(result).toEqual({ allowed: false, retryAfterMs: 40_000 });
  });

  it("increments and expires the window's key in one round trip, without the raw email in it", async () => {
    const fetchImpl = storeReturning(1);
    await checkRateLimitShared("login:email:ada@school.edu", config, store, NOW, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://redis.example/pipeline");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    const commands = JSON.parse(init.body);
    expect(commands.map((c: string[]) => c[0])).toEqual(["INCR", "PEXPIRE"]);
    expect(commands[0][1]).toBe(commands[1][1]);
    expect(init.body).not.toContain("ada@school.edu");
  });

  it("gives the same key to the same bucket and window, and a new one next window", async () => {
    const fetchImpl = storeReturning(1);
    await checkRateLimitShared("k", config, store, NOW, fetchImpl);
    await checkRateLimitShared("k", config, store, NOW + 5_000, fetchImpl);
    await checkRateLimitShared("k", config, store, NOW + 60_000, fetchImpl);
    const keys = fetchImpl.mock.calls.map((call) => JSON.parse(call[1].body)[0][1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("answers null — count locally — when the store errors, times out or replies oddly", async () => {
    expect(await checkRateLimitShared("k", config, store, NOW, vi.fn().mockRejectedValue(new Error("timeout")))).toBeNull();
    expect(
      await checkRateLimitShared("k", config, store, NOW, vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))),
    ).toBeNull();
    expect(
      await checkRateLimitShared("k", config, store, NOW, vi.fn().mockResolvedValue(new Response(JSON.stringify([{ error: "ERR" }])))),
    ).toBeNull();
  });
});
