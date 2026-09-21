"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RushQuestion } from "../rush/rush-question";
import type { StudentQuestionContent } from "@/lib/session/question-content";

// The unanswered state: one question, one tap. On submit the server
// grades and the page re-renders with the answer, explanation and
// today's numbers (see page.tsx), so this component never holds the
// correct answer.
export function DailyQuestion({
  challengeId,
  content,
  submit,
}: {
  challengeId: string;
  content: StudentQuestionContent;
  submit: (challengeId: string, answer: string) => Promise<{ isCorrect: boolean }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submit(challengeId, value);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <RushQuestion content={content} draft={draft} answered={busy} correctChoiceId={null} onDraftChange={setDraft} onAnswer={(a) => void answer(a)} />
      {busy && <p className="mt-4 text-sm text-muted-foreground">Checking…</p>}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
  );
}
