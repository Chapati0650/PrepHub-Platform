import { prisma } from "@/lib/prisma";
import { MAX_ATTEMPTS } from "@/lib/email-queue";

const DAY_MS = 86_400_000;

/** A sent email's row, body and address included, is kept this long for support questions. */
const SENT_EMAIL_KEEP_DAYS = 30;
/** Daily-reminder claims only matter for the reminder cadence, which looks back a week. */
const REMINDER_CLAIM_KEEP_DAYS = 90;
/** Rows deleted per statement, so one run never holds a long lock. */
const CHUNK = 5_000;

/**
 * Deletes outbound-mail rows nothing needs any more. Nothing did before this:
 * every email kept its full body and the recipient's address forever, which at
 * a district's scale is gigabytes a year of a student's email address sitting
 * in a table for no reason.
 *
 * Only the queue's sent (or permanently failed) rows and old daily-reminder
 * claims go. The once-per-account claims ("results", "finish_diagnostic") are
 * what stop those emails being sent twice, so they are kept for good, and
 * analytics events are left alone because the funnel reads them.
 */
export async function purgeExpiredMail(now = new Date()): Promise<{ queuedEmails: number; reminderClaims: number }> {
  const sentBefore = new Date(now.getTime() - SENT_EMAIL_KEEP_DAYS * DAY_MS);
  const claimsBefore = new Date(now.getTime() - REMINDER_CLAIM_KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);

  let queuedEmails = 0;
  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "queued_emails" WHERE "id" IN (
        SELECT "id" FROM "queued_emails"
         WHERE ("sentAt" IS NOT NULL AND "sentAt" < ${sentBefore})
            OR ("sentAt" IS NULL AND "attempts" >= ${MAX_ATTEMPTS} AND "createdAt" < ${sentBefore})
         LIMIT ${CHUNK}
      )`;
    queuedEmails += deleted;
    if (deleted < CHUNK) break;
  }

  let reminderClaims = 0;
  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "email_sends" WHERE "id" IN (
        SELECT "id" FROM "email_sends"
         WHERE "kind" = 'daily_reminder' AND "day" < ${claimsBefore}
         LIMIT ${CHUNK}
      )`;
    reminderClaims += deleted;
    if (deleted < CHUNK) break;
  }

  return { queuedEmails, reminderClaims };
}
