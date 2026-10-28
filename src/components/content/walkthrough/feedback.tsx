"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { recordWalkthroughFeedbackAction } from "@/lib/content/walkthrough-feedback-actions";

// "Did this make sense?" on a walkthrough's last step. One tap, and on
// "Still confused" an optional "which step lost you?", so the Owner can see
// which explanations to rewrite (/owner/content/walkthroughs). Answered once
// per question in a browser; the server keeps one answer per student per
// revision, so answering again only replaces it.

const key = (revisionId: string) => `prephub:wt-feedback:${revisionId}`;
const noop = () => () => {};

function answeredBefore(revisionId: string): boolean {
  try {
    return window.localStorage.getItem(key(revisionId)) !== null;
  } catch {
    return false;
  }
}

function remember(revisionId: string, value: string) {
  try {
    window.localStorage.setItem(key(revisionId), value);
  } catch {
    // Storage blocked: the question is simply asked again next time.
  }
}

type Stage = "ask" | "which" | "thanks";

export function WalkthroughFeedbackAsk({ revisionId, stepCount }: { revisionId: string; stepCount: number }) {
  // The server snapshot says "answered", so the question never flashes in
  // and out on load.
  const seen = useSyncExternalStore(noop, () => answeredBefore(revisionId), () => true);
  const [stage, setStage] = useState<Stage | null>(null);
  const [, startTransition] = useTransition();
  const current = stage ?? (seen ? null : "ask");
  if (!current) return null;

  const send = (helpful: boolean, step: number | null) => {
    remember(revisionId, helpful ? "yes" : "no");
    // Best effort: a lost answer is not worth an error in front of a student.
    startTransition(() => recordWalkthroughFeedbackAction(revisionId, helpful, step).catch(() => undefined));
  };

  return (
    <div className="mt-2.5 rounded-lg border border-border px-3 py-2 text-sm" role="group" aria-label="Did this make sense?">
      {current === "ask" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="mr-auto font-medium">Did this explanation make sense?</p>
          <button
            type="button"
            onClick={() => {
              send(true, null);
              setStage("thanks");
            }}
            className="rounded-full border border-border px-3 py-1 font-medium hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-950/40"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => {
              send(false, null);
              setStage("which");
            }}
            className="rounded-full border border-border px-3 py-1 font-medium hover:border-foreground/40 hover:bg-muted"
          >
            Still confused
          </button>
        </div>
      )}
      {current === "which" && (
        <div>
          <p className="font-medium">Thanks. Which step lost you? (optional)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Array.from({ length: stepCount }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  send(false, i + 1);
                  setStage("thanks");
                }}
                className={cn("min-w-9 rounded-md border border-border px-2 py-1 font-medium tabular-nums hover:border-primary hover:bg-primary/5")}
              >
                {i + 1}
              </button>
            ))}
            <button type="button" onClick={() => setStage("thanks")} className="px-2 py-1 text-muted-foreground hover:underline">
              Skip
            </button>
          </div>
        </div>
      )}
      {current === "thanks" && (
        <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
          <Check className="size-4 text-primary" aria-hidden />
          Thanks, that helps us make these better.
        </p>
      )}
    </div>
  );
}
