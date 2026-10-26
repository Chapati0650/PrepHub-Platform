import { prisma } from "@/lib/prisma";
import { BATCH_PAUSE_MS, sendEmailBatch } from "@/lib/email";
import { logEmailDeliveryFailure } from "@/lib/logger";

/**
 * The outbound email queue.
 *
 * A district announcement or roster invitation goes to thousands of
 * addresses. Resend's batch endpoint takes a hundred per call, so two
 * thousand students is twenty-odd sequential calls — more than a serverless
 * request gets. Sending straight from the request that triggered it meant the
 * function was killed partway through, having delivered an unknowable subset,
 * with no record of which addresses got it and no way to retry.
 *
 * So the pattern everywhere in the app is: write the rows (ideally in the same
 * transaction as the thing being announced, so there is no state where the
 * announcement exists and its mail does not), then drain. The triggering
 * request drains for a short budget itself, which means a 40-student campus
 * sees its mail go out immediately; whatever is left is picked up by the
 * scheduled run a few minutes later.
 *
 * Nothing here ever throws at a caller. A queue that can fail the operation
 * that enqueued it would be worse than no queue (CLAUDE.md: optional side
 * effects must never block or fail the core operation).
 */

/** How many rows one drain run will claim. 100 is one provider batch. */
const DRAIN_CLAIM_LIMIT = 300;

/**
 * How long a request-time drain is allowed to spend before leaving the rest to
 * the scheduled run. Deliberately well inside any host's request limit: the
 * point is that the administrator who clicked Publish is not kept waiting, not
 * that this one request finishes the job.
 */
const REQUEST_DRAIN_BUDGET_MS = 4_000;

/**
 * A claim older than this is treated as abandoned and retried. Longer than any
 * plausible drain run, so a slow run is never double-sent out from under
 * itself; short enough that a killed run's mail is not stranded for long.
 */
const CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Give up on a row after this many tries. A permanently bad address would
 * otherwise be claimed, fail and be re-claimed forever, crowding out real mail
 * on every scheduled run.
 */
export const MAX_ATTEMPTS = 5;

export type EnqueuedEmail = { to: string; subject: string; body: string };

/**
 * Rows to insert for a one-subject-many-recipients send.
 *
 * Returned as data rather than written here so a caller can insert them inside
 * its own transaction — `prisma.queuedEmail.createMany({ data: queueRows(...) })`
 * works the same inside `$transaction` as outside it.
 */
export function queueRows(
  kind: string,
  recipients: string[],
  { subject, text }: { subject: string; text: string },
): { kind: string; to: string; subject: string; body: string }[] {
  const unique = [...new Set(recipients.filter((r) => r && r.includes("@")))];
  return unique.map((to) => ({ kind, to, subject, body: text }));
}

/** Convenience for callers with no transaction of their own. */
export async function enqueueEmails(
  kind: string,
  recipients: string[],
  message: { subject: string; text: string },
): Promise<number> {
  const rows = queueRows(kind, recipients, message);
  if (rows.length === 0) return 0;
  await prisma.queuedEmail.createMany({ data: rows });
  return rows.length;
}

export type DrainResult = {
  sent: number;
  failed: number;
  /**
   * Rows still unsent and still retryable, read after this run's own sends.
   *
   * A snapshot, not a guarantee: a drain that overlaps another sees the other
   * run's in-flight rows as still pending, because they are. Treat it as "is
   * there more to do", which is all any caller uses it for.
   */
  remaining: number;
};

/**
 * Sends what is waiting, oldest first, until the claim limit or the time
 * budget runs out.
 *
 * Claiming is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 * LOCKED)`, which is the one shape that makes two concurrent runs safe: the
 * scheduled run and a request-time drain can overlap freely, and each walks
 * away with a disjoint set of rows rather than both sending the same mail.
 * `SKIP LOCKED` is why this is raw SQL — Prisma has no way to express it, and
 * without it the second run blocks on the first instead of moving past it.
 */
export async function drainEmailQueue({
  limit = DRAIN_CLAIM_LIMIT,
  budgetMs,
}: { limit?: number; budgetMs?: number } = {}): Promise<DrainResult> {
  const deadline = budgetMs === undefined ? null : Date.now() + budgetMs;
  let sent = 0;
  let failed = 0;

  while (true) {
    if (deadline !== null && Date.now() >= deadline) break;

    const claimed = await claimBatch(Math.min(limit - sent - failed, 100));
    if (claimed.length === 0) break;

    // One provider call per claim, whatever the rows say: an announcement's
    // hundred identical messages and a hundred personal reminders cost the
    // same single request.
    const result = await sendEmailBatch(claimed.map((r) => ({ to: r.to, subject: r.subject, text: r.body })));

    const ids = claimed.map((r) => r.id);
    if (result.failed === 0) {
      await prisma.queuedEmail.updateMany({
        where: { id: { in: ids } },
        data: { sentAt: new Date(), claimedAt: null, lastError: null },
      });
      sent += claimed.length;
    } else {
      // The provider reports per-batch, not per-address, so a partial
      // failure is retried as a whole. A duplicate email is a far smaller
      // problem than an announcement a student never receives, and
      // MAX_ATTEMPTS bounds how often that can happen.
      await prisma.queuedEmail.updateMany({
        where: { id: { in: ids } },
        data: { claimedAt: null, lastError: `provider rejected ${result.failed} of ${ids.length}` },
      });
      failed += claimed.length;
      logEmailDeliveryFailure("Queued email batch failed", {
        kind: claimed[0]?.kind,
        recipients: ids.length,
      });
    }

    if (sent + failed >= limit) break;
    // Back-to-back claims would be back-to-back provider calls; the pause is
    // the same one sendEmailBatch takes between its own batches.
    if (claimed.length === 100) await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
  }

  const remaining = await prisma.queuedEmail.count({
    where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS } },
  });
  return { sent, failed, remaining };
}

/**
 * Drains for a few seconds from inside the request that enqueued the mail, so
 * a small school's announcement arrives at once instead of waiting for the
 * next scheduled run. Never throws and never blocks past its budget.
 */
export async function drainForRequest(): Promise<void> {
  try {
    await drainEmailQueue({ budgetMs: REQUEST_DRAIN_BUDGET_MS });
  } catch (err) {
    logEmailDeliveryFailure("Request-time email drain failed", {
      errorType: err instanceof Error ? err.name : "Unknown",
    });
  }
}

type ClaimedRow = { id: string; kind: string; to: string; subject: string; body: string };

async function claimBatch(limit: number): Promise<ClaimedRow[]> {
  if (limit <= 0) return [];
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "queued_emails"
       SET "claimedAt" = NOW(), "attempts" = "attempts" + 1
     WHERE "id" IN (
             SELECT "id"
               FROM "queued_emails"
              WHERE "sentAt" IS NULL
                AND "attempts" < ${MAX_ATTEMPTS}
                AND ("claimedAt" IS NULL OR "claimedAt" < ${staleBefore})
              ORDER BY "createdAt"
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
           )
    RETURNING "id", "kind", "to", "subject", "body"
  `;
}

export type QueueHealth = {
  pending: number;
  /** Rows that have exhausted their retries and will never be sent. */
  deadLettered: number;
  oldestPendingAt: Date | null;
  /**
   * How long the oldest waiting row has waited, in whole minutes.
   *
   * Derived here rather than by the page that shows it, because reading the
   * clock during a render is exactly the impure call React's lint rule
   * forbids — and this is already a server-side read of a moving value.
   */
  oldestPendingMinutes: number;
};

/**
 * What the Owner status page shows. "Pending" climbing and never falling is
 * the one symptom that means the scheduled drain has stopped running, which is
 * otherwise completely silent — students simply never hear from their school.
 */
export async function getQueueHealth(): Promise<QueueHealth> {
  const [pending, deadLettered, oldest] = await Promise.all([
    prisma.queuedEmail.count({ where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS } } }),
    prisma.queuedEmail.count({ where: { sentAt: null, attempts: { gte: MAX_ATTEMPTS } } }),
    prisma.queuedEmail.findFirst({
      where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const oldestPendingAt = oldest?.createdAt ?? null;
  return {
    pending,
    deadLettered,
    oldestPendingAt,
    oldestPendingMinutes: oldestPendingAt
      ? Math.floor((Date.now() - oldestPendingAt.getTime()) / 60_000)
      : 0,
  };
}
