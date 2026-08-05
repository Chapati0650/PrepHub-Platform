"use client";

import { SessionRunner, type LoadedQuestion, type SessionRunnerItem } from "@/components/session/session-runner";
import {
  completePracticeSetAction,
  loadPracticeQuestionAction,
  savePracticeDraftAction,
  savePracticePositionAction,
  submitPracticeAnswerAction,
} from "../actions";

export function PracticeRunner({
  practiceSetId,
  setNumber,
  items,
  initialPosition,
  initialQuestion,
}: {
  practiceSetId: string;
  setNumber: number;
  items: SessionRunnerItem[];
  initialPosition: number;
  initialQuestion: LoadedQuestion;
}) {
  return (
    <SessionRunner
      title={`Practice Set ${setNumber}`}
      initialItems={items}
      initialPosition={initialPosition}
      initialQuestion={initialQuestion}
      // PRD-005 §21: unlike PRD-014's engine-level blank-confirmation capability,
      // the actual Practice Session never offers a "submit anyway" bypass — every
      // question must be genuinely answered before the set can complete.
      allowBlankConfirmation={false}
      loadQuestion={loadPracticeQuestionAction}
      saveDraft={savePracticeDraftAction}
      savePosition={(position) => savePracticePositionAction(practiceSetId, position)}
      submitAnswer={submitPracticeAnswerAction}
      complete={() => completePracticeSetAction(practiceSetId)}
    />
  );
}
