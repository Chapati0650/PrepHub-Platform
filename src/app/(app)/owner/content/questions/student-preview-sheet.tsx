"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { DistractorNote } from "@/components/content/distractor-note";
import { getPublishIssues } from "@/lib/content/validation";
import { CALCULATOR_LABELS } from "@/lib/content/labels";
import type { QuestionListRow } from "@/lib/content/list-questions";
import { markPreviewCompletedAction } from "../actions";

// Shared by the Questions table (row click) and the question editor (§6.2's
// "live preview" panel) — one interactive renderer of "what a student sees,"
// rather than two separate implementations that could drift apart.
export function StudentPreviewSheet({
  row,
  open,
  onOpenChange,
  onPrevious,
  onNext,
}: {
  row: QuestionListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [numericAnswer, setNumericAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Full Screen is a per-preview-session choice, not per-question — it stays
  // on while browsing Previous/Next within the same open preview, and only
  // resets the next time the sheet is opened fresh (adjusted during render,
  // same pattern as interactionResetKey below, rather than an effect).
  const [fullScreen, setFullScreen] = useState(false);
  const [openResetKey, setOpenResetKey] = useState(open);
  if (openResetKey !== open) {
    setOpenResetKey(open);
    if (!open) setFullScreen(false);
  }

  // PRD-015 §5.3: reset interaction state whenever a different question opens —
  // adjusted during render per React's guidance, rather than in an effect.
  const [interactionResetKey, setInteractionResetKey] = useState(row?.id);
  if (interactionResetKey !== row?.id) {
    setInteractionResetKey(row?.id);
    setSelectedChoiceId(null);
    setNumericAnswer("");
    setSubmitted(false);
  }

  // PRD-015 §5.5: opening the latest revision in Student Preview satisfies the
  // mandatory-preview requirement — fire-and-forget, doesn't block rendering.
  useEffect(() => {
    if (row && open) void markPreviewCompletedAction(row.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, open]);

  if (!row) return null;
  const revision = row.currentDraftRevision ?? row.currentPublishedRevision;
  if (!revision) return null;

  const issues = getPublishIssues(row, revision, row.family);
  const selectedChoice =
    row.questionType === "MULTIPLE_CHOICE" ? revision.answerChoices.find((c) => c.id === selectedChoiceId) : undefined;
  const isCorrect =
    row.questionType === "MULTIPLE_CHOICE"
      ? (selectedChoice?.isCorrect ?? false)
      : revision.acceptedAnswers.some((a) => a.trim().toLowerCase() === numericAnswer.trim().toLowerCase());

  const explanationVideo = row.family?.sharedVideo ?? revision.standaloneVideo;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={
          fullScreen
            ? "w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-none"
            : "w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        }
      >
        <SheetHeader>
          <SheetTitle>Student Preview</SheetTitle>
          <SheetDescription>
            Exactly what a student sees. Interacting here never creates real attempts or affects
            Ability Scores.
          </SheetDescription>
        </SheetHeader>

        <div className={fullScreen ? "mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" : "flex flex-col gap-4 p-4"}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!onPrevious} onClick={onPrevious}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={!onNext} onClick={onNext}>
                Next
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setFullScreen((f) => !f)}>
              {fullScreen ? (
                <>
                  <Minimize2 className="size-4" aria-hidden />
                  Exit Full Screen
                </>
              ) : (
                <>
                  <Maximize2 className="size-4" aria-hidden />
                  Full Screen
                </>
              )}
            </Button>
          </div>

          {issues.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="mb-1 font-medium">Owner-only: this can&apos;t be published yet.</p>
                <ul className="list-inside list-disc">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 text-xs text-muted-foreground">{CALCULATOR_LABELS[revision.calculatorSetting]}</p>
            <QuestionStatement
              text={revision.questionText}
              imageId={revision.questionImage?.id ?? null}
              mediaBasePath="/api/owner/media"
            />

            <div className="mt-4 flex flex-col gap-2">
              {row.questionType === "MULTIPLE_CHOICE" ? (
                revision.answerChoices.map((choice) => {
                  const isSelected = selectedChoiceId === choice.id;
                  const showCorrect = submitted && choice.isCorrect;
                  const showWrongSelection = submitted && isSelected && !choice.isCorrect;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={submitted}
                      onClick={() => setSelectedChoiceId(choice.id)}
                      className={`rounded-md border p-2 text-left text-sm transition-colors ${
                        isSelected ? "border-primary bg-primary/5" : "border-border"
                      } ${showCorrect ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50" : ""} ${
                        showWrongSelection ? "border-destructive bg-destructive/5" : ""
                      }`}
                    >
                      <LatexText text={choice.text} />
                      {choice.imageId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/owner/media/${choice.imageId}`}
                          alt=""
                          className="mt-2 max-w-full rounded"
                        />
                      )}
                    </button>
                  );
                })
              ) : (
                <input
                  type="text"
                  value={numericAnswer}
                  onChange={(e) => setNumericAnswer(e.target.value)}
                  disabled={submitted}
                  placeholder="Enter your answer"
                  className="rounded-md border border-border p-2 text-sm"
                />
              )}
            </div>

            {!submitted ? (
              <Button
                className="mt-4"
                size="sm"
                disabled={row.questionType === "MULTIPLE_CHOICE" ? !selectedChoiceId : !numericAnswer}
                onClick={() => setSubmitted(true)}
              >
                Submit
              </Button>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <p className={`text-sm font-medium ${isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                  {isCorrect ? "Correct!" : "Incorrect."}
                </p>
                {!isCorrect && selectedChoice?.distractorExplanation && (
                  <DistractorNote text={selectedChoice.distractorExplanation} />
                )}
                {revision.explanationSteps.length > 0 ? (
                  <ExplanationSteps steps={revision.explanationSteps} mediaBasePath="/api/owner/media" />
                ) : (
                  revision.writtenExplanation && (
                    <div className="rounded-md bg-muted p-3 text-sm">
                      <LatexText text={revision.writtenExplanation} />
                    </div>
                  )
                )}
                {explanationVideo?.status === "READY" && (
                  <video controls className="w-full rounded" src={`/api/owner/media/${explanationVideo.id}`} />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSubmitted(false);
                    setSelectedChoiceId(null);
                    setNumericAnswer("");
                  }}
                >
                  Reset
                </Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
