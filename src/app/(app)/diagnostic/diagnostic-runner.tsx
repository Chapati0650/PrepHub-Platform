"use client";

import { SessionRunner, type LoadedQuestion, type SessionRunnerItem } from "@/components/session/session-runner";
import {
  completeDiagnosticAction,
  loadDiagnosticQuestionAction,
  saveDiagnosticDraftAction,
  saveDiagnosticPositionAction,
  submitDiagnosticAnswerAction,
} from "./actions";

export function DiagnosticRunner({
  items,
  initialPosition,
  initialQuestion,
}: {
  items: SessionRunnerItem[];
  initialPosition: number;
  initialQuestion: LoadedQuestion;
}) {
  return (
    <SessionRunner
      title="Diagnostic"
      initialItems={items}
      initialPosition={initialPosition}
      initialQuestion={initialQuestion}
      allowBlankConfirmation={false}
      loadQuestion={loadDiagnosticQuestionAction}
      saveDraft={saveDiagnosticDraftAction}
      savePosition={saveDiagnosticPositionAction}
      submitAnswer={submitDiagnosticAnswerAction}
      complete={completeDiagnosticAction}
    />
  );
}
