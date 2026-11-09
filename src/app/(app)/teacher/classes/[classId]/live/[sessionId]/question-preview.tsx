"use client";

import { useState, useTransition } from "react";
import { AnswerKey } from "@/components/teacher/answer-key";
import { ActionFailureNote, actionFailure, type ActionFailure } from "@/components/staff/action-failure";
import { previewGuidedItemAction } from "@/app/(app)/teacher/live/actions";

type Preview = Awaited<ReturnType<typeof previewGuidedItemAction>>;

/** "Show the question" under a class question on the session report, with its answer key, as Homework results do. */
export function GuidedQuestionPreview({ sessionId, itemId }: { sessionId: string; itemId: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [, start] = useTransition();

  function load() {
    setFailure(null);
    start(async () => {
      try {
        setPreview(await previewGuidedItemAction(sessionId, itemId));
      } catch (err) {
        setFailure(actionFailure(err, "Couldn't open this question just now. Try again."));
      }
    });
  }

  return (
    <span className="mt-2 block">
      <button
        type="button"
        className="text-base font-medium text-primary underline-offset-4 hover:underline"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !preview) load();
        }}
      >
        {open ? "Hide the question" : "Show the question"}
      </button>
      {open && (
        <span className="mt-3 block rounded-xl border border-border p-4">
          {preview ? (
            <AnswerKey content={preview.content} feedback={preview.feedback} />
          ) : failure ? (
            <ActionFailureNote failure={failure} onRetry={load} />
          ) : (
            <span className="text-base text-muted-foreground">Loading…</span>
          )}
        </span>
      )}
    </span>
  );
}
