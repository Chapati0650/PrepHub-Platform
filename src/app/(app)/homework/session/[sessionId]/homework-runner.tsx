"use client";

import { SessionRunner, type LoadedQuestion, type SessionRunnerItem } from "@/components/session/session-runner";
import {
  completeHomeworkSessionAction,
  loadHomeworkQuestionAction,
  saveHomeworkDraftAction,
  saveHomeworkPositionAction,
  submitHomeworkAnswerAction,
} from "../../actions";

export function HomeworkRunner({
  sessionId,
  title,
  items,
  studentName,
  initialPosition,
  initialQuestion,
  revealAnswers,
}: {
  sessionId: string;
  title: string;
  items: SessionRunnerItem[];
  studentName?: string;
  initialPosition: number;
  initialQuestion: LoadedQuestion;
  /** False for quiz homework: answers and explanations wait for the turn-in. */
  revealAnswers: boolean;
}) {
  return (
    <SessionRunner
      title={`${revealAnswers ? "Homework" : "Quiz"} · ${title}`}
      finishLabel="Turn in homework"
      studentName={studentName}
      initialItems={items}
      initialPosition={initialPosition}
      initialQuestion={initialQuestion}
      revealAnswers={revealAnswers}
      // Same rule as a Practice Set (PRD-005 §21): no "submit with blanks."
      allowBlankConfirmation={false}
      loadQuestion={loadHomeworkQuestionAction}
      saveDraft={saveHomeworkDraftAction}
      savePosition={(position) => saveHomeworkPositionAction(sessionId, position)}
      submitAnswer={submitHomeworkAnswerAction}
      complete={() => completeHomeworkSessionAction(sessionId)}
    />
  );
}
