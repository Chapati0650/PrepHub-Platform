import Link from "next/link";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/link-button";

/**
 * The address a school or district writes to. One constant because it appears
 * in the header, in three places on /schools, and in the footer — and because
 * when it changes it must change everywhere at once.
 *
 * There is deliberately no contact *form* behind this yet: outbound email is
 * not wired in production (no RESEND_API_KEY), so a form would accept a
 * district's inquiry and then silently drop it, which is worse than no form.
 * A mailto always works. Swap this for a form once Resend is live.
 */
export const SCHOOLS_CONTACT_EMAIL = "schools@prephubtp.com";

export const SCHOOLS_MAILTO =
  `mailto:${SCHOOLS_CONTACT_EMAIL}` +
  "?subject=PrepHub%20for%20our%20district" +
  "&body=District%3A%20%0ACampus(es)%3A%20%0AApproximate%20number%20of%20students%3A%20%0AWho%20else%20should%20be%20on%20the%20call%3A%20%0A";

/**
 * Shared chrome for the two public pages (/ and /schools), so the nav and
 * footer can't drift apart as either page is edited.
 *
 * Both of these must stay free of `auth()`, `cookies()` and `headers()`: the
 * landing page is prerendered (`revalidate = 86400`) and one such call
 * silently turns it back into a per-visitor server render. The signed-in
 * bounce lives in src/middleware.ts for exactly that reason.
 */
export function SiteHeader({ active }: { active?: "schools" }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:gap-3 sm:px-6">
        {/* Two marks, one shown per breakpoint. The lg mark is sized for
            desktop; on a 320px phone it plus the three nav items overflows
            the row, and it is oversized there regardless. `hidden` is
            display:none, so only the visible one is in the accessible tree. */}
        <span className="sm:hidden">
          <Logo />
        </span>
        <span className="hidden sm:block">
          <Logo size="lg" />
        </span>
        <div className="flex items-center gap-0.5 sm:gap-2">
          <Link
            href="/schools"
            aria-current={active === "schools" ? "page" : undefined}
            className={
              "rounded-full px-1 text-sm font-medium underline-offset-4 hover:underline sm:px-3 " +
              (active === "schools" ? "text-foreground" : "text-muted-foreground hover:text-foreground")
            }
          >
            {/* Two labels rather than one: at 360px the long form plus both
                auth buttons overflows the row. `hidden` is display:none, so
                only the visible one contributes to the accessible name. */}
            <span className="sm:hidden">Schools</span>
            <span className="hidden sm:inline">For Schools</span>
          </Link>
          <LinkButton variant="ghost" className="rounded-full px-2 sm:px-5" href="/login" hardNavigation>
            Log in
          </LinkButton>
          <LinkButton className="rounded-full px-2.5 sm:px-5" href="/signup" hardNavigation>
            Sign up
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Logo />
          <p>Adaptive SAT preparation that adjusts to you.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/schools" className="hover:text-foreground">
            For Schools
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Log in
          </Link>
        </div>
      </div>
    </footer>
  );
}
