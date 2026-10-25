"use client";

import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";

/**
 * A question as a teacher sees it: the passage, the question, every choice
 * with the correct one marked, and the explanation students will read after
 * answering. The same renderers as the student side, so what a teacher
 * previews is what their class gets.
 *
 * The correct choice carries the word "Correct" as well as the green, so
 * colour is never the only signal (CLAUDE.md, WCAG).
 */
export function AnswerKey({ content, feedback }: { content: StudentQuestionContent; feedback: StudentQuestionFeedback }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      {content.passageText && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 leading-relaxed">
          <LatexText text={content.passageText} />
        </div>
      )}
      <QuestionStatement text={content.questionText} imageId={content.questionImageId} mediaBasePath="/api/media" />
      {content.questionType === "MULTIPLE_CHOICE" ? (
        <ol className="flex flex-col gap-1.5">
          {content.answerChoices.map((choice, i) => {
            const correct = feedback.correctChoiceId === choice.id;
            return (
              <li
                key={choice.id}
                className={`flex items-start gap-3 rounded-md border p-2.5 ${
                  correct ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50" : "border-border"
                }`}
              >
                <span className="font-semibold">{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0 flex-1">
                  <LatexText text={choice.text} />
                </span>
                {correct && <span className="shrink-0 text-xs font-semibold text-green-800 dark:text-green-300">Correct</span>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p>
          <span className="font-medium">Accepted answer{feedback.acceptedAnswers.length === 1 ? "" : "s"}:</span>{" "}
          {feedback.acceptedAnswers.join(", ")}
        </p>
      )}
      {feedback.explanationSteps.length > 0 ? (
        <ExplanationSteps steps={feedback.explanationSteps} mediaBasePath="/api/media" />
      ) : (
        feedback.writtenExplanation && (
          <div className="rounded-md bg-muted p-3">
            <LatexText text={feedback.writtenExplanation} />
          </div>
        )
      )}
    </div>
  );
}
