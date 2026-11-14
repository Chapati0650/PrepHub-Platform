import { prisma } from "@/lib/prisma";
import { ADMIN_REMINDER_KIND, REMINDER_COOLDOWN_DAYS, REMINDER_SHOWN_DAYS } from "./reminder-message";

export { ADMIN_REMINDER_KIND, REMINDER_COOLDOWN_DAYS, REMINDER_SHOWN_DAYS };

// The record of reminders an administrator emailed from the Students page
// (2026-11-14). One `EmailSend` row per student per day, kind
// `admin_reminder` — the same claim table every other email uses, so a
// double-click or two administrators pressing Send at once can't mail a
// student twice, and `purgeExpiredMail` clears old rows.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each student's most recent reminder within the last `REMINDER_SHOWN_DAYS`, by student id. */
export async function lastRemindedAt(studentIds: string[], now: Date = new Date()): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (studentIds.length === 0) return result;
  const rows = await prisma.emailSend.findMany({
    where: {
      userId: { in: studentIds },
      kind: ADMIN_REMINDER_KIND,
      sentAt: { gte: new Date(now.getTime() - REMINDER_SHOWN_DAYS * DAY_MS) },
    },
    select: { userId: true, sentAt: true },
  });
  for (const r of rows) {
    const seen = result.get(r.userId);
    if (!seen || r.sentAt > seen) result.set(r.userId, r.sentAt);
  }
  return result;
}

/** Of `studentIds`, the ones reminded inside the cooldown. */
export async function recentlyReminded(studentIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await prisma.emailSend.findMany({
    where: {
      userId: { in: studentIds },
      kind: ADMIN_REMINDER_KIND,
      sentAt: { gte: new Date(now.getTime() - REMINDER_COOLDOWN_DAYS * DAY_MS) },
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}
