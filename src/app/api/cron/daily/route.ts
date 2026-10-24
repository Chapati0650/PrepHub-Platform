import { NextResponse } from "next/server";
import { runDailyLifecycle } from "@/lib/lifecycle/emails";
import { runGraduationSweep } from "@/lib/owner/graduation";

// The daily lifecycle run, called by netlify/functions/daily-cron.mts on a
// schedule (or by hand with the secret). Bearer-protected: CRON_SECRET must
// be set and match, otherwise 404 — the route shouldn't even admit it
// exists to anyone without it. Idempotent by construction (EmailSend), so
// a double trigger is harmless.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return new NextResponse(null, { status: 404 });
  // Two independent daily jobs. The graduation sweep runs first and is
  // awaited separately so a failure in one is never reported as the other:
  // PRD-017 §10 district rollover and the lifecycle emails have nothing to do
  // with each other beyond sharing a schedule.
  const graduation = await runGraduationSweep();
  const result = await runDailyLifecycle();
  return NextResponse.json({ ok: true, ...result, graduation, ranAt: new Date().toISOString() });
}
