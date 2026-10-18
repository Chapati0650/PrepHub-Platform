import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { emailFromAddress, isEmailConfigured } from "@/lib/email";
import { TestEmailButton } from "./test-email-button";

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
      name: "STRIPE_SECRET_KEY",
      set: Boolean(process.env.STRIPE_SECRET_KEY),
      required: true,
      note: "Checkout and the webhook both need it.",
    },
    {
      name: "R2_ACCOUNT_ID",
      set: Boolean(process.env.R2_ACCOUNT_ID),
      required: false,
      note: "Unset means uploaded media goes to local disk, which a serverless host discards.",
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
