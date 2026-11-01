"use client";

import { Button } from "@/components/ui/button";
import { STALE_BUILD_MESSAGE, isStaleServerActionError } from "@/lib/stale-build";

/**
 * A server action that threw, as something a staff page can say inline.
 *
 * A teacher's page calls actions from event handlers (searching the bank,
 * previewing a question, assigning), and an uncaught throw there goes to the
 * error boundary — which, in the assignment builder, threw away every
 * question the teacher had picked. Every call is caught instead, and the
 * failure shown where it happened. The one kind with a sure fix is a deploy
 * while the page was open (stale-build.ts), so that one offers the reload.
 */
export type ActionFailure = { message: string; stale: boolean };

export function actionFailure(err: unknown, fallback: string): ActionFailure {
  return isStaleServerActionError(err) ? { message: STALE_BUILD_MESSAGE, stale: true } : { message: fallback, stale: false };
}

export function ActionFailureNote({ failure, onRetry }: { failure: ActionFailure; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-base text-destructive">
      <p>{failure.message}</p>
      {failure.stale ? (
        <Button variant="outline" size="lg" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      ) : (
        onRetry && (
          <Button variant="outline" size="lg" onClick={onRetry}>
            Try again
          </Button>
        )
      )}
    </div>
  );
}
