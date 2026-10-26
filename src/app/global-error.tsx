"use client";

import Link from "next/link";
import "./globals.css";

/**
 * The last resort: an error in the root layout itself, where neither the app
 * shell nor `(app)/error.tsx` can render. It replaces the whole document, so
 * it brings its own <html>/<body> and the global stylesheet, and stays plain.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <title>PrepHub</title>
        <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
          <div role="alert" className="rounded-3xl bg-surface-tint p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">PrepHub didn&apos;t load.</h1>
            <p className="mt-3 text-muted-foreground">
              Something went wrong on our side. Your progress is saved. Try again in a moment.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="h-12 rounded-full bg-primary px-6 text-base font-medium text-primary-foreground"
              >
                Try again
              </button>
              <Link href="/" className="inline-flex h-12 items-center rounded-full border border-border px-6 text-base font-medium">
                Go to PrepHub
              </Link>
            </div>
            {error.digest && <p className="mt-6 text-xs text-muted-foreground">Reference: {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
