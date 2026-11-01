import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { emailFromAddress, isEmailConfigured } from "@/lib/email";
import { getQueueHealth } from "@/lib/email-queue";
import { R2_CONFIGURED } from "@/lib/content/storage";
import { prisma } from "@/lib/prisma";
import { TestEmailButton } from "./test-email-button";

export const metadata = { title: "Status" };

/**
 * Owner-only environment status.
 *
 * Built 2026-10-17 after transactional email turned out to have been dead in
 * production since launch, and diagnosing it took three rounds of guessing
 * between Netlify, Resend and DNS. GER §16 says backend logs are sufficient
 * for V1 and no Owner status page is required — which is true right up until
 * something is misconfigured and the only evidence lives in a serverless log
 * nobody can conveniently read.
 *
 * It reports *presence*, never values: a page that printed an API key would
 * be a worse problem than the one it solves. `process.env` is read on the
 * server and only the booleans cross to the client.
 */
export const dynamic = "force-dynamic";

type Check = {
  name: string;
  set: boolean;
  required: boolean;
  note: string;
};

/**
 * When the daily cron last did something visible. It writes no row of its
 * own, so this is the newest claim it records for the two lifecycle emails it
 * queues (src/lib/lifecycle/emails.ts) — one row. A proxy, not a heartbeat: an
 * evening where nobody is due a reminder queues nothing. Outside the component
 * because it reads the clock, which a render must not.
 */
async function getLastDailyRun(): Promise<{ lastCronAt: Date | null; cronQuiet: boolean }> {
  const lastClaim = await prisma.emailSend.findFirst({
    where: { kind: { in: ["daily_reminder", "finish_diagnostic"] } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  const lastCronAt = lastClaim?.sentAt ?? null;
  // The run is nightly; two missed evenings is the point to look.
  return { lastCronAt, cronQuiet: lastCronAt === null || Date.now() - lastCronAt.getTime() > 48 * 3600 * 1000 };
}

export default async function OwnerStatusPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");

  // Database shape, not its credentials. A cold serverless instance opening a
  // fresh Postgres connection against Neon's *direct* endpoint costs
  // several hundred ms before any query runs; the -pooler endpoint reuses
  // connections. And if the function region differs from the database
  // region, every one of a page's queries pays a cross-country round trip —
  // on /home that is ~21 queries. Both are env config, and both are
  // invisible from outside, which is why they are reported here.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbHost = dbUrl.match(/@([^/?:]+)/)?.[1] ?? "";
  const dbPooled = dbHost.includes("-pooler");
  const dbRegion = dbHost.match(/\.([a-z]{2}-[a-z]+-\d)\./)?.[1] ?? "unknown";
  // Netlify sets AWS_REGION inside the function.
  const functionRegion = process.env.AWS_REGION ?? "unknown";
  const regionsMatch =
    dbRegion !== "unknown" && functionRegion !== "unknown" && dbRegion === functionRegion;

  // The outbound queue. "Pending" climbing and never falling is the one
  // symptom that means the scheduled drain has stopped running, which is
  // otherwise completely silent: students simply never hear from their school.
  const queue = await getQueueHealth();
  // Five minutes between scheduled runs, so anything over fifteen means the
  // schedule is not firing rather than merely being mid-send.
  const queueStalled = queue.oldestPendingMinutes > 15;

  const { lastCronAt, cronQuiet } = await getLastDailyRun();
  const inProduction = process.env.NODE_ENV === "production";

  const emailConfigured = isEmailConfigured();
  const from = emailFromAddress();
  // The from-address domain must be one verified in Resend. The common
  // misconfiguration is verifying a subdomain and leaving EMAIL_FROM unset,
  // so every send is attempted from the unverified root domain.
  const fromDomain = from.match(/@([^>\s]+)/)?.[1] ?? "unknown";

  const checks: Check[] = [
    {
      name: "RESEND_API_KEY",
      set: emailConfigured,
      required: true,
      note: "Without it no email is attempted at all and nothing appears in Resend's logs.",
    },
    {
      name: "EMAIL_FROM",
      set: Boolean(process.env.EMAIL_FROM),
      required: false,
      note: "Defaults to no-reply@prephubtp.com. That default only works if the root domain is the one verified in Resend.",
    },
    {
      name: "CRON_SECRET",
      set: Boolean(process.env.CRON_SECRET),
      required: true,
      note: "Without it the daily reminder route returns 404 and the scheduled job never runs.",
    },
    {
      name: "DATABASE_URL",
      set: Boolean(process.env.DATABASE_URL),
      required: true,
      note: "Use the Neon -pooler endpoint so cold functions reuse connections.",
    },
    {
      name: "NEXTAUTH_URL",
      set: Boolean(process.env.NEXTAUTH_URL),
      required: true,
      note: "Password reset and verification links are built from this.",
    },
    {
      name: "AUTH_SECRET",
      set: Boolean(process.env.AUTH_SECRET),
      required: true,
      note: "Signs every session cookie and the one-click unsubscribe links. Without it nobody can stay signed in.",
    },
    {
      name: "STRIPE_SECRET_KEY",
      set: Boolean(process.env.STRIPE_SECRET_KEY),
      required: true,
      note: "Checkout and the webhook both need it.",
    },
    {
      name: "STRIPE_WEBHOOK_SECRET",
      set: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      required: true,
      note: "Without it every Stripe webhook is refused, so a renewal or cancellation only reaches PrepHub when the student next visits the billing success page.",
    },
    {
      // All four, because storage.ts uses R2 only when all four are present.
      name: "R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
      set: R2_CONFIGURED,
      required: inProduction,
      note: "All four must be set, or uploaded media goes to local disk, which a serverless host discards.",
    },
    {
      name: "UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN",
      set: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      required: false,
      note: "Optional, but both or neither. Unset means rate limits are counted per server instance, so they are looser than the numbers in rate-limit.ts.",
    },
    {
      name: "ANTHROPIC_API_KEY",
      set: Boolean(process.env.ANTHROPIC_API_KEY),
      required: false,
      note: "Unset means question-image transcription, bulk upload and the essay-prompt extractor are unavailable.",
    },
    {
      name: "DEEPSEEK_API_KEY",
      set: Boolean(process.env.DEEPSEEK_API_KEY),
      required: false,
      note: "Unset means bulk upload can't detect answers or write explanations, so it refuses to start.",
    },
    {
      name: "NEXT_PUBLIC_DESMOS_API_KEY",
      set: Boolean(process.env.NEXT_PUBLIC_DESMOS_API_KEY),
      required: false,
      note: "Unset means sessions fall back to the four-function calculator instead of Desmos. Inlined at build time, so it needs a redeploy to take effect.",
    },
    {
      name: "YOUTUBE_API_KEY",
      set: Boolean(process.env.YOUTUBE_API_KEY),
      required: false,
      note: "Optional. Unset means the landing page uses the typed-in view counts.",
    },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <PageHeader
        title="System status"
        description="Which environment variables the running build can actually see. Presence only — no value is ever displayed."
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Transactional email</h2>
        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Sending</span>
            <span className={emailConfigured ? "font-medium text-green-700 dark:text-green-400" : "font-medium text-destructive"}>
              {emailConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-muted-foreground">From address</span>
            <span className="font-medium">{from}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Must be verified in Resend</span>
            <span className="font-medium">{fromDomain}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {emailConfigured
              ? `Every send is attempted from ${fromDomain}. If that exact domain is not verified in Resend, every send is rejected.`
              : "No API key is visible to this build, so sendEmail never calls Resend — which is why Resend's own logs stay empty. Check the variable is saved on this site, that its scope includes Functions, and that a deploy has run since."}
          </p>
        </div>
        <TestEmailButton />

        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Outbound queue</span>
            <span
              className={
                queueStalled
                  ? "font-medium text-destructive"
                  : "font-medium text-green-700 dark:text-green-400"
              }
            >
              {queue.pending === 0 ? "Empty" : `${queue.pending.toLocaleString()} waiting`}
            </span>
          </div>
          {queue.oldestPendingAt && (
            <div className="mt-1 flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Oldest waiting</span>
              <span className="font-medium tabular-nums">{queue.oldestPendingMinutes} min</span>
            </div>
          )}
          {queue.deadLettered > 0 && (
            <div className="mt-1 flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Gave up after 5 tries</span>
              <span className="font-medium text-destructive tabular-nums">{queue.deadLettered}</span>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {queueStalled
              ? "Mail has been waiting longer than the five-minute schedule should allow. Check that the email-queue-cron scheduled function is enabled and that CRON_SECRET matches."
              : "Announcements and roster invitations are queued, drained for a few seconds by the request that sent them, and finished by a scheduled run every five minutes."}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Daily run</h2>
        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Last queued a reminder or nudge</span>
            <span className={cronQuiet ? "font-medium text-destructive" : "font-medium text-green-700 dark:text-green-400"}>
              {lastCronAt ? lastCronAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Never"}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {cronQuiet
              ? "Nothing in two days. The run is nightly (22:00 UTC, with reruns at 22:10 and 22:20); check that the daily-cron scheduled function is enabled and that CRON_SECRET matches. A quiet stretch with nobody due a reminder looks the same, so check the function's log before changing anything."
              : "The nightly run queues daily reminders and finish-your-Diagnostic nudges. This is the newest one it recorded."}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Database &amp; latency</h2>
        <div className="rounded-xl border border-border p-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Connection</span>
            <span className={dbPooled ? "font-medium text-green-700 dark:text-green-400" : "font-medium text-destructive"}>
              {dbPooled ? "Pooled (-pooler)" : "Direct endpoint"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Database region</span>
            <span className="font-medium">{dbRegion}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Function region</span>
            <span className={regionsMatch ? "font-medium text-green-700 dark:text-green-400" : "font-medium text-destructive"}>
              {functionRegion}
            </span>
          </div>
          {!dbPooled && (
            <p className="mt-3 text-xs text-muted-foreground">
              Every cold instance opens a fresh Postgres connection before any query runs. Switch
              DATABASE_URL to the Neon endpoint containing <span className="font-mono">-pooler</span>.
            </p>
          )}
          {!regionsMatch && (
            <p className="mt-2 text-xs text-muted-foreground">
              Functions and the database are in different regions, so every query crosses the
              country. The dashboard issues about 21 of them per render.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Environment</h2>
        <dl className="divide-y divide-border border-y border-border">
          {checks.map((c) => (
            <div key={c.name} className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between gap-4">
                <dt className="font-mono text-sm">{c.name}</dt>
                <dd
                  className={
                    c.set
                      ? "text-sm font-medium text-green-700 dark:text-green-400"
                      : c.required
                        ? "text-sm font-medium text-destructive"
                        : "text-sm font-medium text-muted-foreground"
                  }
                >
                  {c.set ? "Set" : c.required ? "Missing" : "Not set"}
                </dd>
              </div>
              {!c.set && <p className="text-xs text-muted-foreground">{c.note}</p>}
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
