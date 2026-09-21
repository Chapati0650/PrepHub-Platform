import { NextResponse } from "next/server";
import { runDailyLifecycle } from "@/lib/lifecycle/emails";

// The daily lifecycle run, called by netlify/functions/daily-cron.mts on a
// schedule (or by hand with the secret). Bearer-protected: CRON_SECRET must
// be set and match, otherwise 404 — the route shouldn't even admit it
// exists to anyone without it. Idempotent by construction (EmailSend), so
// a double trigger is harmless.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return new NextResponse(null, { status: 404 });
  const result = await runDailyLifecycle();
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
