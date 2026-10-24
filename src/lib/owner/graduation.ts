import { prisma } from "@/lib/prisma";

/**
 * The annual graduation rollover (PRD-017 §10).
 *
 * §10 describes "the automatic July 1 cutoff" and the Owner-facing
 * `markGraduated` was written as the manual override that runs "ahead of" it —
 * but the automatic half was never built, so until now the only way a cohort
 * left was the Owner clicking through them one membership at a time. At a
 * pilot campus of forty that is tedious; at a district where five hundred
 * seniors leave on the same day it does not happen at all, and every one of
 * them keeps district-funded access into a year the district is not paying
 * for.
 *
 * Runs from the daily cron. Idempotent by construction: the update is guarded
 * on `status: "ACTIVE"`, so a second run the same day finds nothing to do, and
 * a day the cron misses is simply caught by the next one.
 */

/** July. The month a US school year rolls over. */
const ROLLOVER_MONTH = 6; // zero-based: 6 = July

/**
 * The last graduation year that has already happened, as of `now`.
 *
 * Pure, because the whole correctness of this feature is in one comparison and
 * an off-by-one would either graduate a cohort a year early — cutting access
 * to students mid-senior-year — or a year late. Before July, the current
 * calendar year's class has not finished yet, so the cutoff is the year
 * before; from July onward it is the current year.
 */
export function graduationCutoffYear(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= ROLLOVER_MONTH ? year : year - 1;
}

/** Written in chunks so one district's cohort can't make a single huge statement. */
const CHUNK = 500;

export type GraduationSweepResult = { graduated: number; cutoffYear: number };

export async function runGraduationSweep(now: Date = new Date()): Promise<GraduationSweepResult> {
  const cutoffYear = graduationCutoffYear(now);

  // Ids first, because each graduation also needs its own
  // MembershipHistoryEvent row — PRD-017's audit trail is the point of that
  // table, and a bulk status change with no record of it would be worse than
  // no automation.
  const due = await prisma.studentMembership.findMany({
    where: { status: "ACTIVE", expectedGraduationYear: { lte: cutoffYear } },
    select: { id: true },
  });

  let graduated = 0;
  for (let i = 0; i < due.length; i += CHUNK) {
    const ids = due.slice(i, i + CHUNK).map((m) => m.id);
    const result = await prisma.$transaction(async (tx) => {
      // Still guarded on ACTIVE inside the transaction: between the read above
      // and here, the Owner may have graduated or removed one by hand, and the
      // count below has to reflect what this run actually changed.
      const updated = await tx.studentMembership.updateMany({
        where: { id: { in: ids }, status: "ACTIVE" },
        data: { status: "GRADUATED", graduatedAt: now },
      });
      await tx.membershipHistoryEvent.createMany({
        data: ids.map((membershipId) => ({
          membershipId,
          eventType: "GRADUATION" as const,
          // No performedByAccountId: nobody did this, the calendar did. The
          // column is nullable precisely for a system-initiated transition.
          optionalReason: `Automatic July rollover: class of ${cutoffYear}`,
        })),
      });
      return updated.count;
    });
    graduated += result;
  }

  return { graduated, cutoffYear };
}
