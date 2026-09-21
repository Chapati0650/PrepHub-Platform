import { prisma } from "@/lib/prisma";

// The six funnel events, plus page views from the public-page beacon.
// Named for what happened, not for a UI element, so a redesign doesn't
// rename the funnel. Add sparingly — the Owner's Funnel page lists these.
export const FUNNEL_EVENTS = {
  PAGE_VIEW: "page_view",
  SIGNED_UP: "signed_up",
  DIAGNOSTIC_STARTED: "diagnostic_started",
  DIAGNOSTIC_COMPLETED: "diagnostic_completed",
  PAYWALL_VIEWED: "paywall_viewed",
  CHECKOUT_STARTED: "checkout_started",
  DAILY_CHALLENGE_ANSWERED: "daily_challenge_answered",
} as const;
// Signups, Diagnostic completions, free-set completions and subscriptions
// are counted from their own tables by funnel.ts; the events above exist
// for the moments no table records (a paywall view, a checkout start) and
// as a timeline.
export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

// Fire-and-forget. Analytics is an optional side effect (CLAUDE.md: never
// block or fail the core operation), so a write failure is swallowed —
// the signup, the answer, the checkout all proceed.
export async function track(
  name: FunnelEvent,
  attrs: { userId?: string | null; path?: string | null; referrer?: string | null; utmSource?: string | null } = {},
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        name,
        userId: attrs.userId ?? null,
        path: attrs.path?.slice(0, 200) ?? null,
        referrer: attrs.referrer?.slice(0, 200) ?? null,
        utmSource: attrs.utmSource?.slice(0, 80) ?? null,
      },
    });
  } catch {
    // Deliberately silent; see above.
  }
}
