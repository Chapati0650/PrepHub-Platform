import { formatGoalDate } from "@/lib/community/goal";
import { GOAL_TIME_ZONE } from "@/lib/community/local-day";

export type DueTone = "overdue" | "soon" | "later" | "none";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since the epoch of `at`'s calendar date in the schools' time zone (America/Chicago). */
function localDayNumber(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: GOAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS);
}

/**
 * How a due date reads on the student's Homework page, in words so urgency is
 * never carried by color alone. A due date is the end of the teacher's day, so
 * anything due tonight reads "today", tomorrow "tomorrow" (calendar days in Chicago).
 * Homework that was already due when the student joined is never "overdue"
 * (`setBeforeJoining`): it reads "was due" in neutral tone.
 */
export function describeDue(
  dueAt: Date | null,
  now: Date,
  opts: { setBeforeJoining?: boolean } = {},
): { text: string; tone: DueTone } {
  if (!dueAt) return { text: "No due date", tone: "none" };
  const ms = dueAt.getTime() - now.getTime();
  if (ms <= 0) {
    return { text: `Was due ${formatGoalDate(dueAt)}`, tone: opts.setBeforeJoining ? "later" : "overdue" };
  }
  // Calendar days in the schools' zone, not rolling 24-hour windows: those read "Due in 3 days" for
  // Wednesday 23:59 on a Monday morning, one more than the calendar (review, 2026-11-09).
  const days = localDayNumber(dueAt) - localDayNumber(now);
  if (days <= 0) return { text: "Due today", tone: "soon" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { text: `Due in ${days} days · ${formatGoalDate(dueAt)}`, tone: "later" };
  return { text: `Due ${formatGoalDate(dueAt)}`, tone: "later" };
}
