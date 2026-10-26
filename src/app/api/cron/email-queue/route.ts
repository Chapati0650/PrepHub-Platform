import { NextResponse } from "next/server";
import { drainEmailQueue } from "@/lib/email-queue";
import { isCronAuthorized } from "@/lib/cron-auth";

// Drains the outbound email queue, called by
// netlify/functions/email-queue-cron.mts every few minutes (or by hand with
// the secret).
//
// Separate from /api/cron/daily on purpose: the daily run is a once-a-day
// lifecycle pass, while this one exists to finish a district-sized send that
// could not fit in the request that started it, and has to come round again
// within minutes rather than hours.
//
// Bearer-protected: CRON_SECRET must be set and match, otherwise 404 — the
// route shouldn't even admit it exists to anyone without it. Safe to trigger
// twice: claiming is a single `FOR UPDATE SKIP LOCKED` update, so two
// overlapping runs take disjoint rows rather than sending the same mail.
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return new NextResponse(null, { status: 404 });

  // Budgeted below the host's request limit. Whatever is left over is simply
  // picked up by the next run; a large district drains over a few minutes
  // rather than needing one long-running request. The time budget, not the
  // row limit, is what stops a scheduled run: at a hundred messages a call,
  // twenty seconds is well over a thousand emails, and the evening's daily
  // reminders for a district go out within a few runs instead of trickling
  // out three hundred at a time into the night.
  const result = await drainEmailQueue({ budgetMs: 20_000, limit: 5_000 });
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
