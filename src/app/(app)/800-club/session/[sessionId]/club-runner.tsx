"use client";

import { SessionRunner, type LoadedQuestion, type SessionRunnerItem } from "@/components/session/session-runner";
import {
  completeClubSessionAction,
  loadClubQuestionAction,
  saveClubDraftAction,
  saveClubPositionAction,
  submitClubAnswerAction,
} from "../../actions";

export function ClubRunner({
  sessionId,
  sectionLabel,
  items,
  studentName,
  initialPosition,
  initialQuestion,
}: {
  sessionId: string;
  sectionLabel: string;
  items: SessionRunnerItem[];
  studentName?: string;
  initialPosition: number;
  initialQuestion: LoadedQuestion;
}) {
  return (
    <SessionRunner
      title={`800 Club · ${sectionLabel}`}
      studentName={studentName}
      initialItems={items}
      initialPosition={initialPosition}
      initialQuestion={initialQuestion}
      // Same rule as a Practice Set (PRD-005 §21): no "submit with blanks."
      allowBlankConfirmation={false}
      loadQuestion={loadClubQuestionAction}
      saveDraft={saveClubDraftAction}
      savePosition={(position) => saveClubPositionAction(sessionId, position)}
      submitAnswer={submitClubAnswerAction}
      complete={() => completeClubSessionAction(sessionId)}
    />
  );
}
