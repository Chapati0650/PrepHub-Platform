import { prisma } from "@/lib/prisma";

// The Owner's funnel, from the source tables where they exist (a signup is
// a User row, a completed Diagnostic is a DiagnosticSession row) and from
// events only where nothing else records the moment (a paywall view, a
// checkout start). Counting from tables means the numbers are right even
// for the months before events existed.

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

  const [signups, diagStarted, diagCompleted, freeSetCompleted, paywallViews, checkoutStarts, subscribed, pageViews, referrers, signupRows, diagRows, subRows] =
    await Promise.all([
      prisma.user.count({ where: { ...REAL_STUDENT, createdAt: { gte: since } } }),
      prisma.diagnosticSession.count({ where: { startedAt: { gte: since }, student: REAL_STUDENT } }),
      prisma.diagnosticSession.count({ where: { status: "COMPLETED", completedAt: { gte: since }, student: REAL_STUDENT } }),
      prisma.practiceSet.count({ where: { setNumber: 1, status: "COMPLETED", completedAt: { gte: since }, student: REAL_STUDENT } }),
      prisma.analyticsEvent.groupBy({ by: ["userId"], where: { name: "paywall_viewed", createdAt: { gte: since } } }).then((r) => r.length),
      prisma.analyticsEvent.groupBy({ by: ["userId"], where: { name: "checkout_started", createdAt: { gte: since } } }).then((r) => r.length),
      prisma.subscription.count({ where: { createdAt: { gte: since }, stripeCustomerId: { startsWith: "cus_" }, user: REAL_STUDENT } }),
      prisma.analyticsEvent.count({ where: { name: "page_view", createdAt: { gte: since } } }),
      prisma.analyticsEvent.groupBy({ by: ["referrer"], where: { name: "page_view", createdAt: { gte: since }, referrer: { not: null } }, _count: { _all: true }, orderBy: { _count: { referrer: "desc" } }, take: 8 }),
      prisma.user.findMany({ where: { ...REAL_STUDENT, createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.diagnosticSession.findMany({ where: { status: "COMPLETED", completedAt: { gte: since }, student: REAL_STUDENT }, select: { completedAt: true } }),
      prisma.subscription.findMany({ where: { createdAt: { gte: since }, stripeCustomerId: { startsWith: "cus_" }, user: REAL_STUDENT }, select: { createdAt: true } }),
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

  // Per-day series for the chart, oldest first.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const series = new Map<string, { signups: number; diagnosticsCompleted: number; subscribed: number }>();
  for (let i = days - 1; i >= 0; i--) series.set(dayKey(new Date(Date.now() - i * 86400e3)), { signups: 0, diagnosticsCompleted: 0, subscribed: 0 });
  for (const r of signupRows) series.get(dayKey(r.createdAt))!.signups++;
  for (const r of diagRows) if (r.completedAt) { const s = series.get(dayKey(r.completedAt)); if (s) s.diagnosticsCompleted++; }
  for (const r of subRows) { const s = series.get(dayKey(r.createdAt)); if (s) s.subscribed++; }

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
