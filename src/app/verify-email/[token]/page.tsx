import type { Metadata } from "next";
import { auth } from "@/auth";
import { inspectEmailVerification } from "@/lib/district/email-verification";
import { Logo } from "@/components/logo";
import { Marker } from "@/components/ui/marker";
import { LinkButton } from "@/components/ui/link-button";
import { ConfirmForm, ResendExpiredForm } from "./forms";

// Every visit is a different token and a fresh read; a cached copy of this
// page would carry a stale Server Action id and someone else's state.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your school email", robots: { index: false, follow: false } };

/**
 * Where the district confirmation email lands (lib/district/email-verification).
 * Opening it changes nothing — mail scanners open every link — so the student
 * presses one button, which is the confirmation. Works signed out, because
 * the school inbox is often on a phone that has never signed in to PrepHub.
 */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inspection, session] = await Promise.all([inspectEmailVerification(token), auth()]);
  const home = session?.user?.id ? "/home" : "/login";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto w-full max-w-xl px-6 pt-8">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          {inspection.state === "READY" && (
            <>
              {inspection.match.kind === "MATCH" || inspection.match.kind === "NEEDS_CAMPUS" ? (
                <>
                  <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {inspection.match.kind === "MATCH" ? inspection.match.schoolName : inspection.match.organizationName}
                  </p>
                  <h1 className="mt-3 text-display-sm font-semibold tracking-tight text-balance">
                    {inspection.firstName}, your school covers <Marker>Premium</Marker>.
                  </h1>
                  <p className="mt-3 text-muted-foreground">
                    Confirm {inspection.email} is yours and PrepHub Premium switches on, free, for as long as
                    you&apos;re a student there.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="mt-1 text-display-sm font-semibold tracking-tight text-balance">
                    Confirm your email
                  </h1>
                  <p className="mt-3 text-muted-foreground">
                    Confirm {inspection.email} is yours. Your school&apos;s PrepHub access isn&apos;t active right
                    now, but once you&apos;re confirmed it switches on by itself whenever it is.
                  </p>
                </>
              )}
              <ConfirmForm
                token={token}
                campuses={inspection.match.kind === "NEEDS_CAMPUS" ? inspection.match.campuses : []}
              />
              <p className="mt-5 text-xs text-muted-foreground">
                Didn&apos;t sign up for PrepHub? Close this page — nothing happens unless the button is pressed.
              </p>
            </>
          )}

          {inspection.state === "EXPIRED" && (
            <>
              <h1 className="text-display-sm font-semibold tracking-tight">This link has expired.</h1>
              <p className="mt-3 text-muted-foreground">
                Links last a week. We&apos;ll send a fresh one to {inspection.email}.
              </p>
              <ResendExpiredForm token={token} />
            </>
          )}

          {inspection.state === "USED" && (
            <>
              <h1 className="text-display-sm font-semibold tracking-tight">You&apos;re already confirmed.</h1>
              <p className="mt-3 text-muted-foreground">
                This link has been used, and {inspection.email} is confirmed. Everything your school covers is
                waiting in PrepHub.
              </p>
              <LinkButton href={home} size="cta" className="mt-6">
                Go to PrepHub
              </LinkButton>
            </>
          )}

          {inspection.state === "INVALID" && (
            <>
              <h1 className="text-display-sm font-semibold tracking-tight">This link doesn&apos;t work.</h1>
              <p className="mt-3 text-muted-foreground">
                It may have been cut off when it was copied. Log in to PrepHub and use &ldquo;Resend the link&rdquo;
                at the top of the page for a new one.
              </p>
              <LinkButton href={home} size="cta" className="mt-6">
                Go to PrepHub
              </LinkButton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
