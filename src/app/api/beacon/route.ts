import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";

// Page-view beacon for the public pages (landing, signup, login) and the
// pricing page, sent by PageViewBeacon via navigator.sendBeacon. Only two
// event names are accepted from the browser; everything else in the
// funnel is written server-side where it happens. Always 204 — a beacon
// must never surface an error to the visitor.
const ALLOWED = new Set<string>([FUNNEL_EVENTS.PAGE_VIEW, FUNNEL_EVENTS.PAYWALL_VIEWED]);

export async function POST(request: Request) {
  let body: { name?: unknown; path?: unknown; referrer?: unknown; utmSource?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const name = typeof body.name === "string" && ALLOWED.has(body.name) ? (body.name as typeof FUNNEL_EVENTS.PAGE_VIEW | typeof FUNNEL_EVENTS.PAYWALL_VIEWED) : null;
  if (!name) return new NextResponse(null, { status: 204 });
  const session = await auth().catch(() => null);
  void track(name, {
    userId: session?.user?.id ?? null,
    path: typeof body.path === "string" ? body.path : null,
    referrer: typeof body.referrer === "string" ? referrerHost(body.referrer) : null,
    utmSource: typeof body.utmSource === "string" ? body.utmSource : null,
  });
  return new NextResponse(null, { status: 204 });
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
