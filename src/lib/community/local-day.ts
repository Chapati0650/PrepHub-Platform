/**
 * Calendar days in the time zone PrepHub's schools keep (2026-10-26).
 *
 * Split out of goal.ts, which imports the database, so a client component —
 * the announcement form, which has to show "until Nov 5" the same way the
 * server stored it — can use the same day arithmetic. goal.ts re-exports
 * everything here, so existing imports are unchanged.
 */

/**
 * The time zone a school's dates are calendar days in. The same zone the
 * weekly Rush leaderboard turns over in: PrepHub's partner districts are in
 * Texas, and "ends on the 15th" has to mean the end of the 15th there, not in
 * UTC, where it would end at 6pm.
 */
export const GOAL_TIME_ZONE = "America/Chicago";

/** How far ahead of UTC the zone's wall clock is at `at`, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock `hh:mm:ss.ms` on a `YYYY-MM-DD` in the zone, or null for anything that isn't such a date. */
function wallClockOnDay(date: string, timeZone: string, [h, min, sec, ms]: [number, number, number, number]): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const naive = Date.UTC(year, month - 1, day, h, min, sec, ms);
  const check = new Date(naive);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null; // 2026-02-30 and friends
  // The offset is read at the guess and re-read at the result, which settles
  // a guess that straddles a DST change.
  let result = naive - zoneOffsetMs(check, timeZone);
  result = naive - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/**
 * The last millisecond of a calendar day (`YYYY-MM-DD`, what a date input
 * gives) in the zone. Null for anything that isn't such a date.
 */
export function endOfLocalDay(date: string, timeZone: string = GOAL_TIME_ZONE): Date | null {
  return wallClockOnDay(date, timeZone, [23, 59, 59, 999]);
}

/** The first millisecond of a calendar day in the zone — midnight there, not in UTC. */
export function startOfLocalDay(date: string, timeZone: string = GOAL_TIME_ZONE): Date | null {
  return wallClockOnDay(date, timeZone, [0, 0, 0, 0]);
}

/** The `YYYY-MM-DD` a moment falls on in the zone, for a date input. */
export function localDateInputValue(at: Date | null, timeZone: string = GOAL_TIME_ZONE): string {
  if (!at) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Dec 15", in the zone. */
export function formatGoalDate(at: Date, timeZone: string = GOAL_TIME_ZONE): string {
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

/**
 * "December 15, 2026", in the zone. Rendered on the server (UTC) and again in
 * the browser, so naming the zone is also what keeps the two from disagreeing.
 */
export function formatLongLocalDate(at: Date | string, timeZone: string = GOAL_TIME_ZONE): string {
  return new Date(at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone });
}
