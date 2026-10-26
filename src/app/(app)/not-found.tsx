import { LinkButton } from "@/components/ui/link-button";

/**
 * A class, assignment, lesson or question that doesn't exist (or isn't this
 * account's to see — the pages call notFound() for both, deliberately). Shown
 * inside the app shell instead of Next's unstyled default, so the sidebar is
 * still there to go somewhere else.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <h1 className="text-display-sm font-semibold tracking-tight text-balance">We couldn&apos;t find that page.</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          The link may be out of date, or what it pointed to has been removed. Everything else is where you left it.
        </p>
        <LinkButton href="/home" size="cta" className="mt-6">
          Go to your dashboard
        </LinkButton>
      </div>
    </div>
  );
}
