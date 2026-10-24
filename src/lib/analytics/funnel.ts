import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// The Owner's funnel, from the source tables where they exist (a signup is
// a User row, a completed Diagnostic is a DiagnosticSession row) and from
// events only where nothing else records the moment (a paywall view, a
// checkout start). Counting from tables means the numbers are right even
// for the months before events existed.
//
// Everything here is counted and grouped in the database. The per-day chart
// used to load every signup, every completed Diagnostic and every
// subscription in the window and bucket them in JavaScript, and the
// paywall/checkout steps used `groupBy({ by: ["userId"] }).then(r => r.length)`
// — one row per distinct user pulled back purely to take its length. Both are
// fine for a hundred students and both grow with the thing being measured,
// which is the wrong direction for a report whose whole job is to still work
// once there are thousands.

export type FunnelWindow = { days: number };

export type FunnelStep = { label: string; count: number; ofPrevious: number | null };

export type FunnelReport = {
  days: number;
  steps: FunnelStep[];
  visitors: { pageViews: number; topReferrers: { host: string; count: number }[] };
  daily: { day: string; signups: number; diagnosticsCompleted: number; subscribed: number }[];
};

const REAL_STUDENT = { role: "STUDENT" as const, email: { not: { contains: "example.com" } } };

export async function getFunnelReport({ days }: FunnelWindow): Promise<FunnelReport> {
  const since = new Date(Date.now() - days * 86400e3);

  const [signups, diagStarted, diagCompleted, freeSetCompleted, paywallViews, checkoutStarts, subscribed, pageViews, referrers, perDay] =
    await Promise.all([
      prisma.user.count({ where: { ...REAL_STUDENT, createdAt: { gte: since } } }),
      prisma.diagnosticSession.count({ where: { startedAt: { gte: since }, student: REAL_STUDENT } }),
      prisma.diagnosticSession.count({ where: { status: "COMPLETED", completedAt: { gte: since }, student: REAL_STUDENT } }),
      prisma.practiceSet.count({ where: { setNumber: 1, status: "COMPLETED", completedAt: { gte: since }, student: REAL_STUDENT } }),
      countDistinctUsers("paywall_viewed", since),
      countDistinctUsers("checkout_started", since),
      prisma.subscription.count({ where: { createdAt: { gte: since }, stripeCustomerId: { startsWith: "cus_" }, user: REAL_STUDENT } }),
      prisma.analyticsEvent.count({ where: { name: "page_view", createdAt: { gte: since } } }),
      prisma.analyticsEvent.groupBy({ by: ["referrer"], where: { name: "page_view", createdAt: { gte: since }, referrer: { not: null } }, _count: { _all: true }, orderBy: { _count: { referrer: "desc" } }, take: 8 }),
      dailyCounts(since),
    ]);

  const raw = [
    { label: "Signed up", count: signups },
    { label: "Started the Diagnostic", count: diagStarted },
    { label: "Completed the Diagnostic", count: diagCompleted },
    { label: "Completed the free Set 1", count: freeSetCompleted },
    { label: "Saw the paywall", count: paywallViews },
    { label: "Started checkout", count: checkoutStarts },
    { label: "Subscribed", count: subscribed },
  ];
  const steps: FunnelStep[] = raw.map((s, i) => ({
    ...s,
    ofPrevious: i === 0 ? null : raw[i - 1].count === 0 ? null : Math.round((s.count / raw[i - 1].count) * 100),
  }));

  // Per-day series for the chart, oldest first. Every day in the window is
  // present whether or not anything happened on it, so the chart has no gaps;
  // a day the database reports that the window does not cover is ignored
  // rather than asserted away. (That assertion was a real latent crash: the
  // signup loop used `series.get(...)!.signups++` where its two siblings
  // guarded with `if (s)`, so one row landing a bucket outside the window —
  // which the UTC day boundary makes entirely possible — took the whole Owner
  // funnel page down with a TypeError.)
  const series = new Map<string, { signups: number; diagnosticsCompleted: number; subscribed: number }>();
  for (let i = days - 1; i >= 0; i--) {
    series.set(dayKey(new Date(Date.now() - i * 86400e3)), { signups: 0, diagnosticsCompleted: 0, subscribed: 0 });
  }
  for (const row of perDay) {
    const bucket = series.get(dayKey(row.day));
    if (!bucket) continue;
    bucket.signups += row.signups;
    bucket.diagnosticsCompleted += row.diagnosticsCompleted;
    bucket.subscribed += row.subscribed;
  }

  return {
    days,
    steps,
    visitors: {
      pageViews,
      topReferrers: referrers.map((r) => ({ host: r.referrer ?? "direct", count: r._count._all })),
    },
    daily: [...series.entries()].map(([day, v]) => ({ day, ...v })),
  };
}

/** UTC calendar day, matching how the series buckets are keyed. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * How many distinct students produced this event in the window.
 *
 * `groupBy({ by: ["userId"] })` returns one row per user, which is the answer
 * but delivered the expensive way. `COUNT(DISTINCT ...)` returns the integer.
 */
async function countDistinctUsers(name: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT COUNT(DISTINCT "userId")::int AS total
      FROM "analytics_events"
     WHERE "name" = ${name}
       AND "createdAt" >= ${since}
  `;
  return Number(rows[0]?.total ?? 0);
}

type DailyRow = { day: Date; signups: number; diagnosticsCompleted: number; subscribed: number };

/**
 * One row per calendar day on which anything happened, with all three series
 * in it.
 *
 * `DATE_TRUNC` because Prisma cannot group a timestamp down to its date, and a
 * single UNION so the three series are one round trip rather than three
 * full-table reads. The test-account exclusion is the same
 * `email NOT LIKE '%example.com%'` rule `REAL_STUDENT` applies above — spelled
 * out here rather than shared, because one is a Prisma filter and the other is
 * SQL, and a wrong guess at which is in force would silently change the
 * numbers the Owner reads.
 */
async function dailyCounts(since: Date): Promise<DailyRow[]> {
  const realStudent = Prisma.sql`u."role" = 'STUDENT' AND u."email" NOT LIKE '%example.com%'`;
  return prisma.$queryRaw<DailyRow[]>`
    SELECT day,
           SUM(signups)::int     AS "signups",
           SUM(diagnostics)::int AS "diagnosticsCompleted",
           SUM(subscribed)::int  AS "subscribed"
      FROM (
        SELECT DATE_TRUNC('day', u."createdAt") AS day, COUNT(*)::int AS signups, 0 AS diagnostics, 0 AS subscribed
          FROM "users" u
         WHERE u."createdAt" >= ${since} AND ${realStudent}
         GROUP BY 1
        UNION ALL
        SELECT DATE_TRUNC('day', d."completedAt"), 0, COUNT(*)::int, 0
          FROM "diagnostic_sessions" d
          JOIN "users" u ON u."id" = d."studentId"
         WHERE d."status" = 'COMPLETED' AND d."completedAt" >= ${since} AND ${realStudent}
         GROUP BY 1
        UNION ALL
        SELECT DATE_TRUNC('day', s."createdAt"), 0, 0, COUNT(*)::int
          FROM "subscriptions" s
          JOIN "users" u ON u."id" = s."userId"
         WHERE s."createdAt" >= ${since}
           AND s."stripeCustomerId" LIKE 'cus_%'
           AND ${realStudent}
         GROUP BY 1
      ) parts
     GROUP BY day
  `;
}
