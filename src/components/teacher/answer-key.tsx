"use client";

import { useRef } from "react";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { QuestionWalkthrough } from "@/components/content/walkthrough/context";
import { AcceptedAnswers } from "@/components/session/answer-result";
import { WalkthroughDock } from "@/components/content/walkthrough/dock";
import { ChoiceNote, PassageMarks, WithChoiceMarks, choiceMarkClasses, choiceMarkTag } from "@/components/content/walkthrough/on-question";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";

/**
 * A question as a teacher sees it: the passage, the question, every choice
 * with the correct one marked, and the explanation students will read after
 * answering. The same renderers as the student side, so what a teacher
 * previews is what their class gets — the walkthrough included, running on
 * the question exactly as it does in a student's session.
 *
 * The correct choice carries the word "Correct" as well as the green, so
 * colour is never the only signal (CLAUDE.md, WCAG).
 */
export function AnswerKey({ content, feedback }: { content: StudentQuestionContent; feedback: StudentQuestionFeedback }) {
  const passageRef = useRef<HTMLDivElement | null>(null);
  return (
    <QuestionWalkthrough
      walkthrough={feedback.walkthrough}
      steps={feedback.explanationSteps}
      mediaBasePath="/api/media"
      choiceNotes={content.answerChoices.map((c) => feedback.distractorExplanationsByChoiceId[c.id] ?? null)}
    >
      <div className="flex flex-col gap-4 text-sm">
        {content.passageText && (
          <>
            <div ref={passageRef} className="max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 leading-relaxed">
              <LatexText text={content.passageText} />
            </div>
            <PassageMarks rootRef={passageRef} />
          </>
        )}
        <QuestionStatement text={content.questionText} imageId={content.questionImageId} mediaBasePath="/api/media" />
        {content.questionType === "MULTIPLE_CHOICE" ? (
          <ol className="flex flex-col gap-1.5">
            {content.answerChoices.map((choice, i) => {
              const correct = feedback.correctChoiceId === choice.id;
              return (
                <WithChoiceMarks key={choice.id} index={i}>
                  {(marks) => {
                    const tag = correct ? "Correct" : choiceMarkTag(marks);
                    return (
                      <li ref={marks?.ref} className="flex flex-col gap-1">
                        <div
                          className={`flex items-start gap-3 rounded-md border p-2.5 ${
                            correct ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50" : "border-border"
                          } ${choiceMarkClasses(marks)}`}
                        >
                          <span className="font-semibold">{String.fromCharCode(65 + i)}</span>
                          <span className={`min-w-0 flex-1 ${marks?.ruledOut ? "line-through decoration-foreground/50" : ""}`}>
                            <LatexText text={choice.text} />
                          </span>
                          {tag && (
                            <span
                              className={`shrink-0 text-xs font-semibold ${
                                correct ? "text-green-800 dark:text-green-300" : marks?.checking && !marks.ruledOut ? "text-primary" : "font-medium text-muted-foreground"
                              }`}
                            >
                              {tag}
                            </span>
                          )}
                        </div>
                        <ChoiceNote marks={marks} yourWrongNote={null} className="ml-2 border-l-2 border-border pl-3" />
                      </li>
                    );
                  }}
                </WithChoiceMarks>
              );
            })}
          </ol>
        ) : (
          <AcceptedAnswers answers={feedback.acceptedAnswers} />
        )}
        {feedback.explanationSteps.length > 0 ? (
          <ExplanationSteps steps={feedback.explanationSteps} mediaBasePath="/api/media" walkthrough={feedback.walkthrough} />
        ) : (
          feedback.writtenExplanation && (
            <div className="rounded-md bg-muted p-3">
              <LatexText text={feedback.writtenExplanation} />
            </div>
          )
        )}
        <WalkthroughDock />
      </div>
    </QuestionWalkthrough>
  );
}
