"use client";

import {
  SessionRunner,
  type LoadedQuestion,
  type SessionRunnerItem,
} from "@/components/session/session-runner";
import {
  completeFocusedSessionAction,
  loadFocusedQuestionAction,
  saveFocusedDraftAction,
  saveFocusedPositionAction,
  submitFocusedAnswerAction,
} from "../../actions";

export function FocusedRunner({
  sessionId,
  title,
  items,
  initialPosition,
  initialQuestion,
}: {
  sessionId: string;
  title: string;
  items: SessionRunnerItem[];
  initialPosition: number;
  initialQuestion: LoadedQuestion;
}) {
  return (
    <SessionRunner
      title={title}
      initialItems={items}
      initialPosition={initialPosition}
      initialQuestion={initialQuestion}
      // Same rule as a Practice Set (PRD-005 §21): no "submit with blanks."
      allowBlankConfirmation={false}
      loadQuestion={loadFocusedQuestionAction}
      saveDraft={saveFocusedDraftAction}
      savePosition={(position) => saveFocusedPositionAction(sessionId, position)}
      submitAnswer={submitFocusedAnswerAction}
      complete={() => completeFocusedSessionAction(sessionId)}
    />
  );
}
