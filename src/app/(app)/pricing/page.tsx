import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, X } from "lucide-react";
import { auth } from "@/auth";
import { getAccessContext, getAccessSummary } from "@/lib/entitlements";
import { formatLongLocalDate } from "@/lib/community/local-day";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { cn } from "@/lib/utils";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
import { COLLEGE_APPS_ENABLED } from "@/lib/features";
import { PlanPicker } from "./plan-picker";

export const metadata = { title: "Premium" };

// Everything here sits behind hasPaidAccess, and the Free column says what a
// free account gets of each: the Diagnostic and Practice Set 1 are free, and
// Set 1 is built around the student's weakest categories and moves the
// prediction exactly as every later set does — so those rows say "Set 1",
// not a cross. The Diagnostic, its results, the dashboard and Progress are
// free outright and deliberately not dressed up as Premium features.
//
// `free` is what a free account gets (null: not included); `premium`
// replaces the Premium column's check where a word says more.
const FEATURES: { feature: string; free: string | null; premium?: string }[] = [
  { feature: "Personalized Practice Sets", free: "Set 1", premium: "Unlimited" },
  { feature: "Every set built around your weakest categories", free: "Set 1" },
  { feature: "Predicted SAT Score updated after every set", free: "Set 1" },
  { feature: "Focused Practice — drill one category at the difficulty you pick", free: null },
  { feature: "The 800 Club — the hardest questions in the bank", free: null },
  { feature: "1v1 Rush — live head-to-head, start your own", free: null },
  // Only while students can reach it (lib/features.ts).
  ...(COLLEGE_APPS_ENABLED ? [{ feature: "College Apps — your list, deadlines and score fit", free: null }] : []),
  { feature: "The Curriculum — every video lesson, as they're published", free: null },
];

// /pricing used to be the same sales page for everyone. A student whose school
// covers them, or who already subscribes, was shown the whole pitch and then
// told at checkout that they already had Premium; a teacher or the Owner could
// buy a subscription that unlocked nothing. Who is looking is decided here,
// from the entitlement service, and only a student without Premium is sold to
// — or counted as having seen the paywall.
export default async function PricingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [{ user }, access] = await Promise.all([getAccessContext(userId), getAccessSummary(userId)]);
  const role = user?.role ?? null;

  if (role === "SCHOOL_ADMINISTRATOR") {
    return (
      <StatusBlock
        title="Premium is included with your account."
        body="School administrator accounts come with the full student experience, so there's nothing to buy."
        href="/home?view=student"
        cta="Open the student dashboard"
      />
    );
  }
  if (role !== "STUDENT") {
    return (
      <StatusBlock
        title="Premium is for student accounts."
        body="This account doesn't need a subscription, and can't buy one."
        href="/home"
        cta="Go to your dashboard"
      />
    );
  }
  if (access.type === "SCHOOL") {
    return (
      <StatusBlock
        title="Your school covers Premium."
        body={
          `${access.organizationName} provides PrepHub Premium for you, so there's nothing to pay. Every Practice ` +
          "Set, Focused Practice, the 800 Club, 1v1 Rush and the Curriculum are already open."
        }
        href="/home"
        cta="Go to your dashboard"
      />
    );
  }
  if (access.type === "INDIVIDUAL") {
    const sub = access.subscription;
    const body =
      sub.status === "PAST_DUE"
        ? "Your last payment didn't go through. Update your card from Billing to keep it."
        : sub.status === "CANCELED" && sub.currentPeriodEnd
          ? `It's set to end on ${formatLongLocalDate(sub.currentPeriodEnd)}. You can keep it from Billing.`
          : "You can change your plan, apply a promo code or see your receipts from Billing.";
    return <StatusBlock title="You already have Premium." body={body} href="/billing" cta="Go to Billing" />;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 p-6 pb-16 sm:p-10">
      <PageViewBeacon name="paywall_viewed" />
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">PrepHub Premium</p>
        <h1 className="mt-3 text-display-sm text-balance">
          Unlock every <Marker>Practice Set</Marker>.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          The Diagnostic and your first Practice Set are free. Every set after that is Premium.
        </p>
      </div>

      {/* A student who signed up with a personal email can still be covered
          by their school; this is the one place they'd look before paying. */}
      <div className="border-l-2 border-marker pl-3 text-sm">
        <p className="font-medium">Does your school or district provide PrepHub?</p>
        <p className="mt-0.5 text-muted-foreground">
          Connect your school email and Premium is free.{" "}
          <Link href="/access/verify-school" className="font-medium text-foreground underline underline-offset-4">
            Connect school email
          </Link>
        </p>
      </div>

      {/* A real table, because it is one: two columns of the same facts. The
          Premium column is a single dark block spanning header and rows —
          border-separate is what makes its rounded corners render, since
          border-collapse discards cell radii. */}
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Feature
            </th>
            <th scope="col" className="w-16 pb-3 text-center text-sm font-medium text-muted-foreground">
              Free
            </th>
            <th
              scope="col"
              className="w-24 rounded-t-2xl bg-surface-deep px-2 pt-4 pb-3 text-center text-sm font-semibold text-marker"
            >
              Premium
            </th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map(({ feature, free, premium }, i) => {
            const last = i === FEATURES.length - 1;
            return (
              <tr key={feature}>
                <th scope="row" className="border-t border-border py-3.5 pr-4 text-left text-sm font-normal">
                  {feature}
                </th>
                <td className="border-t border-border py-3.5 text-center">
                  {free ? <span className="text-xs font-semibold text-foreground">{free}</span> : <Mark included={false} />}
                </td>
                <td className={cn("bg-surface-deep py-3.5 text-center", last && "rounded-b-2xl pb-5")}>
                  {premium ? <span className="text-xs font-semibold text-marker">{premium}</span> : <Mark included />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <PlanPicker />

      <p className="text-center text-sm text-muted-foreground">
        Renews automatically. Cancel anytime from Billing. Have a promo code? Enter it at checkout.
      </p>
    </div>
  );
}

// Left-aligned on the tint, like every other status screen in the app.
function StatusBlock({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-6 pb-16 sm:p-10">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">PrepHub Premium</p>
        <h1 className="mt-3 text-display-sm text-balance">{title}</h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">{body}</p>
        <div className="mt-8">
          <LinkButton size="cta" href={href}>
            {cta}
          </LinkButton>
        </div>
      </section>
    </div>
  );
}

// Shape *and* color differ between the two states, and each carries visible-
// to-screen-reader text — color is never the only signal (CLAUDE.md, WCAG).
function Mark({ included }: { included: boolean }) {
  return included ? (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-marker text-surface-deep">
      <Check className="size-3.5" strokeWidth={3} aria-hidden />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
      <X className="size-3" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">Not included</span>
    </span>
  );
}
