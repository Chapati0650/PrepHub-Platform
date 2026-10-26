import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Any URL outside the app that matches nothing. "/" sends a signed-in visitor
 * on to their dashboard (src/middleware.ts), so one link serves both.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto w-full max-w-xl px-6 pt-8">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          <h1 className="text-display-sm font-semibold tracking-tight text-balance">We couldn&apos;t find that page.</h1>
          <p className="mt-3 text-muted-foreground">The link may be out of date, or the page has moved.</p>
          <LinkButton href="/" size="cta" className="mt-6">
            Go to PrepHub
          </LinkButton>
        </div>
      </main>
    </div>
  );
}
