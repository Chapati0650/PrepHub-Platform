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
  title,
  itemLabel,
  finishLabel,
  items,
  studentName,
  initialPosition,
  initialQuestion,
}: {
  title: string;
  itemLabel: string;
  finishLabel: string;
  items: SessionRunnerItem[];
  studentName?: string;
  initialPosition: number;
  initialQuestion: LoadedQuestion;
}) {
  return (
    <SessionRunner
      title={title}
      itemLabel={itemLabel}
      finishLabel={finishLabel}
      studentName={studentName}
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
