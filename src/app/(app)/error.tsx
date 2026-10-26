"use client";

import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { isStaleServerActionError, STALE_BUILD_MESSAGE } from "@/lib/stale-build";

/**
 * The fallback for any page inside the app that fails to render: a database
 * timeout, a query that throws, an action a stale tab can no longer call.
 * Before this existed there was no error boundary anywhere, so every one of
 * those was Next's bare "Application error" on a white page, with no sidebar
 * and no way back but the browser's own buttons. This renders inside the app
 * shell, so navigation stays where it was.
 *
 * Left-aligned on the tint like every other status screen (CLAUDE.md, "Status
 * screens are left-aligned"). Server errors arrive with a generic message and
 * a digest in production, so the copy never repeats `error.message`; the
 * digest is shown small, because it is the one thing that finds the matching
 * line in the server logs when a student reports it.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const stale = isStaleServerActionError(error);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <div role="alert" className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <h1 className="text-display-sm font-semibold tracking-tight text-balance">
          {stale ? "PrepHub was just updated." : "This page didn't load."}
        </h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          {stale
            ? STALE_BUILD_MESSAGE
            : "Something went wrong on our side, not yours. Your answers and progress are saved. Try again, and if it keeps happening, come back in a few minutes."}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {stale ? (
            <Button size="cta" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          ) : (
            <Button size="cta" onClick={() => retry()}>
              Try again
            </Button>
          )}
          <LinkButton href="/home" variant="outline" size="lg" hardNavigation>
            Go to your dashboard
          </LinkButton>
        </div>
        {error.digest && <p className="mt-6 text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
