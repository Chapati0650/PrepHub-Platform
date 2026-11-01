import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { beaconPath } from "@/lib/analytics/beacon";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

// Page-view beacon for the public pages (landing, signup, login) and the
// pricing page, sent by PageViewBeacon via navigator.sendBeacon. Only two
// event names are accepted from the browser; everything else in the
// funnel is written server-side where it happens. Always 204 — a beacon
// must never surface an error to the visitor.
//
// It's the one write anyone can make without an account, so it's held to the
// pages that send it (beaconPath) and to BEACON_PER_IP. A request over the
// limit, for another path, or with another name is answered exactly like an
// accepted one, so there's nothing to probe.
const ALLOWED = new Set<string>([FUNNEL_EVENTS.PAGE_VIEW, FUNNEL_EVENTS.PAYWALL_VIEWED]);

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  let body: { name?: unknown; path?: unknown; referrer?: unknown; utmSource?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT();
  }
  const name = typeof body.name === "string" && ALLOWED.has(body.name) ? (body.name as typeof FUNNEL_EVENTS.PAGE_VIEW | typeof FUNNEL_EVENTS.PAYWALL_VIEWED) : null;
  if (!name) return NO_CONTENT();
  const path = beaconPath(body.path);
  if (!path) return NO_CONTENT();
  // After the cheap checks, so a malformed request costs no rate-limit lookup.
  const limit = await checkRateLimitEnforced(`beacon:ip:${await getClientIp()}`, RATE_LIMITS.BEACON_PER_IP);
  if (!limit.allowed) return NO_CONTENT();
  const session = await auth().catch(() => null);
  // Awaited, not fire-and-forget: a serverless function can be frozen the
  // moment its response is sent, taking an unfinished insert with it. Nobody
  // waits on a beacon's response, so the extra few milliseconds cost nothing,
  // and track() never throws.
  await track(name, {
    userId: session?.user?.id ?? null,
    path,
    referrer: typeof body.referrer === "string" ? referrerHost(body.referrer) : null,
    utmSource: typeof body.utmSource === "string" ? body.utmSource : null,
  });
  return NO_CONTENT();
}

// Store the referring site, not the full URL — enough to see "youtube.com"
// vs "discord.com" without keeping anyone's exact page.
function referrerHost(value: string): string | null {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    if (!host || host === "prephubtp.com" || host === "localhost") return null;
    return host;
  } catch {
    return null;
  }
}
