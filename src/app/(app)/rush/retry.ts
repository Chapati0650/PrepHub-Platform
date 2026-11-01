import { isStaleServerActionError } from "@/lib/stale-build";

/**
 * Resends a rush action that failed to arrive — a dropped request on a school
 * network, a function that cold-started too slowly — a couple of times before
 * the runner says anything. Safe for serve and submit alike: serving reuses
 * the question's existing row (its clock keeps running from when it was
 * first served), and a repeated submit is answered with the recorded result.
 * A stale build is never retried, because only a reload fixes it.
 */
export async function withRetry<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= attempts || isStaleServerActionError(err)) throw err;
      await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt));
    }
  }
}
