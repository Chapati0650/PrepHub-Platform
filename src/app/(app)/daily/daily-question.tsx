"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RushQuestion } from "../rush/rush-question";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import type { DailyAnswerResult } from "@/lib/daily/challenge";

// The unanswered state: one question, one answer. A choice is a draft until
// Submit (or Enter), as in Rush. On submit the server grades and the page
// re-renders with the answer, explanation and today's numbers (see
// page.tsx), so this component never holds the correct answer.
export function DailyQuestion({
  challengeId,
  content,
  submit,
}: {
  challengeId: string;
  content: StudentQuestionContent;
  submit: (challengeId: string, answer: string) => Promise<DailyAnswerResult>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The question this student was answering when the day turned over. While
  // it's still the one on screen, today's is loading; once the refreshed page
  // hands down a different one, the note says why the question changed.
  const [closedChallengeId, setClosedChallengeId] = useState<string | null>(null);
  const loadingNewDay = closedChallengeId === challengeId;

  async function answer(value: string) {
    if (busy || loadingNewDay) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submit(challengeId, value);
      if (!result.ok) {
        setClosedChallengeId(challengeId);
        setDraft("");
        setBusy(false);
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      // In production a thrown server-action error arrives as Next's generic
      // message, which tells a student nothing. Their choice is kept, so
      // trying again is one press.
      setError("Your answer didn't go through. Check your connection and press Submit again. If it keeps happening, reload the page.");
      setBusy(false);
    }
  }

  return (
    <div>
      {closedChallengeId && (
        <p role="status" className="mb-6 rounded-lg border border-border bg-muted/50 p-3 text-sm">
          {loadingNewDay
            ? "The Daily Challenge just changed over to a new question. Loading it now…"
            : "The Daily Challenge changed over just before your answer arrived, so here's the new question."}
        </p>
      )}
      <RushQuestion
        // A new day's question is a new question: scratch work and the
        // keyboard handler's state start over.
        key={challengeId}
        content={content}
        draft={draft}
        answered={busy || loadingNewDay}
        correctChoiceId={null}
        onDraftChange={setDraft}
        onAnswer={(a) => void answer(a)}
        scratchKey={`daily:${challengeId}`}
      />
      {busy && <p className="mt-4 text-sm text-muted-foreground">Checking…</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
