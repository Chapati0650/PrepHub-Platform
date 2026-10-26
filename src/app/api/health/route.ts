import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logDatabaseConnectivityFailure } from "@/lib/logger";

// For an uptime monitor (Better Stack, UptimeRobot): 200 when the site can
// serve a page that needs the database, 503 when it can't. Checking the
// database and not just "the function answered" is the point — a site whose
// pages load but whose every login fails is down as far as a student is
// concerned, and that's the outage a monitor most needs to catch.
//
// Public on purpose and says nothing that could help anyone: no versions, no
// hostnames, no error text. Never cached, or a monitor would read yesterday's
// answer.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5_000;

export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logDatabaseConnectivityFailure("Health check could not reach the database", {
      errorType: err instanceof Error ? err.message : "Unknown",
    });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, dbMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}
