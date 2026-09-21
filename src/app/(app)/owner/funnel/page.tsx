import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getFunnelReport } from "@/lib/analytics/funnel";
import { PageHeader } from "@/components/page-header";

const WINDOWS = [7, 30, 90] as const;

// The Owner's funnel: signup → Diagnostic → free set → paywall → checkout →
// paid, for the last 7/30/90 days, from the source tables plus the few
// events nothing else records (src/lib/analytics). First-party on purpose:
// no third-party script, nothing for an ad blocker to hide, and the
// numbers that matter are written server-side where they happen.
export default async function OwnerFunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");
  const { days: daysParam } = await searchParams;
  const days = (WINDOWS as readonly number[]).includes(Number(daysParam)) ? Number(daysParam) : 30;
  const report = await getFunnelReport({ days });
  const max = Math.max(1, ...report.steps.map((s) => s.count));
  const dailyMax = Math.max(1, ...report.daily.map((d) => d.signups));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <PageHeader title="Funnel" description="Where students come from, how far they get, and who pays. Counted from the database, not a tracking script." />

      <div className="flex gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w}
            href={`/owner/funnel?days=${w}`}
            className={`rounded-full border px-4 py-1.5 text-sm ${w === days ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-foreground/30"}`}
          >
            Last {w} days
          </Link>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Funnel</h2>
        <ol className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {report.steps.map((s) => (
            <li key={s.label} className="flex items-center gap-4 p-4">
              <div className="w-56 shrink-0">
                <p className="text-sm">{s.label}</p>
                {s.ofPrevious !== null && <p className="text-xs text-muted-foreground">{s.ofPrevious}% of the step before</p>}
              </div>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / max) * 100}%` }} />
              </div>
              <p className="w-16 shrink-0 text-right font-heading text-xl font-semibold tabular-nums">{s.count}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          Paywall and checkout are distinct students who hit that moment in the window; the rest are rows created in the
          window. Test accounts (example.com) are excluded.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Signups per day</h2>
        <div className="flex h-40 items-end gap-px rounded-2xl border border-border p-4" role="img" aria-label="Signups per day">
          {report.daily.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.day}: ${d.signups} signups, ${d.diagnosticsCompleted} diagnostics, ${d.subscribed} subscribed`}>
              <div className="w-full rounded-t-sm bg-primary/80" style={{ height: `${(d.signups / dailyMax) * 100}%`, minHeight: d.signups ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {report.daily[0]?.day} → {report.daily[report.daily.length - 1]?.day}. Hover a bar for the day&apos;s numbers.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border p-5">
          <p className="text-sm text-muted-foreground">Public page views</p>
          <p className="mt-2 font-heading text-display-sm font-semibold tabular-nums">{report.visitors.pageViews}</p>
          <p className="mt-1 text-xs text-muted-foreground">Landing, signup, login and pricing — counted from the browser, so ad blockers hide some.</p>
        </div>
        <div className="rounded-2xl border border-border p-5">
          <p className="text-sm text-muted-foreground">Where visitors come from</p>
          {report.visitors.topReferrers.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No referrers recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border text-sm">
              {report.visitors.topReferrers.map((r) => (
                <li key={r.host} className="flex justify-between py-1.5 tabular-nums">
                  <span>{r.host}</span>
                  <span className="text-muted-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
