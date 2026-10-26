import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logEvent } from "@/lib/logger";
import { runDailyLifecycle } from "@/lib/lifecycle/emails";
import { runGraduationSweep } from "@/lib/owner/graduation";
import { purgeExpiredMail } from "@/lib/retention";

/**
 * Below the host's request limit with room to answer. The lifecycle pass
 * checks it between pages of students and stops cleanly; the next scheduled
 * run that evening picks up where it stopped, because today's claims are
 * already recorded (see netlify/functions/daily-cron.mts).
 */
const LIFECYCLE_BUDGET_MS = 18_000;

async function job<T>(name: string, run: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false }> {
  try {
    return { ok: true, result: await run() };
  } catch (err) {
    logEvent("CRON_JOB_FAILURE", `Daily job failed: ${name}`, { errorType: err instanceof Error ? err.message : String(err) });
    return { ok: false };
  }
}

// The daily run, called by netlify/functions/daily-cron.mts on a schedule (or
// by hand with the secret). Bearer-protected: CRON_SECRET must be set and
// match, otherwise 404 — the route shouldn't even admit it exists to anyone
// without it. Idempotent by construction (EmailSend claims, guarded status
// updates), so running it several times an evening is how a large district
// finishes, not a hazard.
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return new NextResponse(null, { status: 404 });
  const deadline = Date.now() + LIFECYCLE_BUDGET_MS;

  // Independent jobs that share a schedule and nothing else: PRD-017 §10's
  // rollover, the lifecycle emails, and housekeeping. Each is caught on its
  // own, so a failed graduation sweep no longer means nobody is reminded.
  const graduation = await job("graduation sweep", () => runGraduationSweep());
  const lifecycle = await job("lifecycle email", () => runDailyLifecycle(new Date(), deadline));
  const retention = await job("mail retention", () => purgeExpiredMail());

  const ok = graduation.ok && lifecycle.ok && retention.ok;
  // A failure answers 500 so the scheduled function's log shows it.
  return NextResponse.json(
    { ok, graduation, lifecycle, retention, ranAt: new Date().toISOString() },
    { status: ok ? 200 : 500 },
  );
}
