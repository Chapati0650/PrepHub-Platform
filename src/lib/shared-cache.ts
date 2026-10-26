import { unstable_cache } from "next/cache";

/**
 * Remembers an expensive read for a short while, shared across requests and,
 * on the host, across server instances.
 *
 * For figures that describe a whole school and are the same for everyone who
 * looks: a district's students opening School Community at the start of a
 * class period would otherwise each recompute it from every answer the school
 * has ever given. A minute's staleness is invisible on a page of totals.
 *
 * `unstable_cache` rather than the `use cache` directive, which in this
 * version of Next needs the app-wide Cache Components mode switched on — a
 * change to how every page renders, for the sake of a few reads. Results are
 * stored as JSON, so only cache functions that return plain numbers, strings
 * and objects of them: a `Date` would come back as a string.
 *
 * Outside a Next.js request (a unit test, a script, a cron run that isn't
 * rendering) there is no cache to use, and the read simply runs.
 */
export function cacheAcrossRequests<A extends unknown[], R>(
  name: string,
  read: (...args: A) => Promise<R>,
  revalidateSeconds: number,
): (...args: A) => Promise<R> {
  const cached = unstable_cache(read, [name], { revalidate: revalidateSeconds });
  return async (...args: A) => {
    try {
      return await cached(...args);
    } catch (err) {
      if (err instanceof Error && err.message.includes("incrementalCache missing")) return read(...args);
      throw err;
    }
  };
}
