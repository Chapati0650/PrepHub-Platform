import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/link-button";
import { verifyUnsubscribeToken } from "@/lib/lifecycle/unsubscribe";
import { UnsubscribeForm } from "./form";

// A fresh render per visit: a cached copy would carry a stale Server Action id.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Daily reminders", robots: { index: false, follow: false } };

/**
 * Where a daily reminder's opt-out link lands (src/lib/lifecycle/unsubscribe.ts).
 * Opening it changes nothing — school mail systems open every link in an
 * inbox to scan it — so the reader presses one button, which is the opt-out.
 * Works signed out.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Checking the signature changes nothing either, so a broken link (cut
  // short when copied, usually) is told so before the button, not after it.
  const genuine = verifyUnsubscribeToken(token) !== null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto w-full max-w-xl px-6 pt-8">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
        {genuine ? (
          <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
            <h1 className="text-display-sm font-semibold tracking-tight">Stop the daily reminders?</h1>
            <p className="mt-3 text-muted-foreground">
              You&apos;ll stop getting the evening email about practice and the Daily Challenge. Your account, your
              progress and your school&apos;s announcements aren&apos;t affected.
            </p>
            <UnsubscribeForm token={token} />
          </div>
        ) : (
          <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
            <h1 className="text-display-sm font-semibold tracking-tight">This link doesn&apos;t work.</h1>
            <p className="mt-3 text-muted-foreground">
              It may have been cut short when it was copied. You can turn the daily reminders off yourself in
              Settings, under Notifications.
            </p>
            <LinkButton href="/settings#notifications" size="cta" className="mt-6">
              Open Settings
            </LinkButton>
          </div>
        )}
      </main>
    </div>
  );
}
