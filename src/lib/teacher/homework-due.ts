import { formatGoalDate } from "@/lib/community/goal";

export type DueTone = "overdue" | "soon" | "later" | "none";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How a due date reads on the student's Homework page, in words so urgency is
 * never carried by color alone. A due date is the end of the teacher's day, so
 * "days left" rounds up: 23:59 tonight is "today", 23:59 tomorrow "tomorrow".
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
  const days = Math.ceil(ms / DAY_MS);
  if (days <= 1) return { text: "Due today", tone: "soon" };
  if (days === 2) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 7) return { text: `Due in ${days} days · ${formatGoalDate(dueAt)}`, tone: "later" };
  return { text: `Due ${formatGoalDate(dueAt)}`, tone: "later" };
}
