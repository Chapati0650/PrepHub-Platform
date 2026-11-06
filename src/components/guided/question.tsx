"use client";

import { useEffect, useRef } from "react";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { Calculator } from "@/components/session/calculator";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import type { Strings } from "./strings";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function choiceLetter(content: StudentQuestionContent, answer: string | null): string {
  if (!answer) return "";
  if (content.questionType !== "MULTIPLE_CHOICE") return answer;
  const index = content.answerChoices.findIndex((c) => c.id === answer);
  return index >= 0 ? LETTERS[index] : "";
}

export function isRight(
  content: StudentQuestionContent,
  answer: string | null,
  key: { correctChoiceId: string | null; acceptedAnswers: string[] },
): boolean {
  if (!answer) return false;
  if (content.questionType === "MULTIPLE_CHOICE") return answer === key.correctChoiceId;
  return key.acceptedAnswers.some((a) => a.trim().toLowerCase() === answer.trim().toLowerCase());
}

/**
 * A question on a student's screen in a Guided Session: the passage beside
 * the question on a wide screen, the same choice rows as Practice, A–D (or
 * 1–4) to pick and Enter to submit. Choosing only picks; the parent decides
 * when an answer is sent. Every state is also said in words (the tags), never
 * by colour alone.
 */
export function GuidedQuestion({
  content,
  value,
  onChange,
  onSubmit,
  disabled,
  reveal,
  firstAnswer,
  t,
}: {
  content: StudentQuestionContent;
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  disabled: boolean;
  /** Set once the answer may be shown. */
  reveal?: { correctChoiceId: string | null; acceptedAnswers: string[] } | null;
  /** Marks the student's first-vote choice during the revote. */
  firstAnswer?: string | null;
  t: Strings;
}) {
  const isChoice = content.questionType === "MULTIPLE_CHOICE";
  const hasPassage = (content.passageText ?? "").trim().length > 0;
  const live = useRef({ value, disabled, onChange, onSubmit, content });
  useEffect(() => {
    live.current = { value, disabled, onChange, onSubmit, content };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { value: v, disabled: off, onChange: choose, onSubmit: submit, content: c } = live.current;
      if (off || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Enter" && v && submit) {
        e.preventDefault();
        submit();
        return;
      }
      if (c.questionType !== "MULTIPLE_CHOICE" || !choose) return;
      const letter = "abcd".indexOf(e.key.toLowerCase());
      const digit = "1234".indexOf(e.key);
      const index = letter !== -1 ? letter : digit;
      if (index !== -1 && c.answerChoices[index]) {
        e.preventDefault();
        choose(c.answerChoices[index].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const question = (
    <div className="min-w-0">
      <QuestionStatement
        text={content.questionText}
        imageId={content.questionImageId}
        mediaBasePath="/api/media"
        className="bg-transparent p-0"
        textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
      />
      {content.calculatorSetting === "ALLOWED" && !reveal && (
        <div className="mt-4">
          <Calculator />
        </div>
      )}
      <div
        role={isChoice ? "group" : undefined}
        aria-label={isChoice ? "Answer choices" : undefined}
        className="mt-6 flex flex-col gap-2.5"
      >
        {isChoice ? (
          content.answerChoices.map((choice, i) => {
            const letter = LETTERS[i];
            const selected = value === choice.id;
            const correct = !!reveal && reveal.correctChoiceId === choice.id;
            const wrongPick = !!reveal && selected && !correct;
            const tag = reveal
              ? correct
                ? selected
                  ? `${t.yourAnswer} · ${t.correct.replace(".", "")}`
                  : t.rightAnswer
                : wrongPick
                  ? t.yourAnswer
                  : null
              : firstAnswer === choice.id
                ? t.yourFirst
                : null;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange?.(choice.id)}
                aria-pressed={selected}
                data-answer-choice={letter}
                className={[
                  "flex items-start gap-4 rounded-xl border-2 p-4 text-left text-base transition-colors lg:text-lg",
                  selected && !reveal && "border-primary bg-primary/10",
                  !selected && !correct && "border-border",
                  !disabled && !selected && "hover:border-foreground/30",
                  correct && "border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                  wrongPick && "border-destructive bg-destructive/5",
                  disabled && !reveal && !selected && "opacity-70",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "mt-px flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold lg:size-8",
                    selected && !reveal ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30",
                  ].join(" ")}
                >
                  {letter}
                </span>
                <span className="min-w-0 flex-1">
                  <LatexText text={choice.text} />
                  {choice.imageId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${choice.imageId}`} alt="" className="mt-2 max-w-full rounded" />
                  )}
                </span>
                {tag && (
                  <span
                    className={`shrink-0 self-center text-sm font-semibold ${
                      wrongPick ? "text-destructive" : correct ? "text-green-800 dark:text-green-300" : "text-muted-foreground"
                    }`}
                  >
                    {tag}
                  </span>
                )}
              </button>
            );
          })
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim() && onSubmit) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              disabled={disabled}
              placeholder="Your answer"
              aria-label={t.yourAnswer}
              className="max-w-xs rounded-xl border-2 border-border bg-background p-3 text-lg disabled:bg-muted"
            />
            {reveal && (
              <p className="text-base">
                <span className="text-muted-foreground">{t.rightAnswer}: </span>
                <span className="font-semibold">{reveal.acceptedAnswers.join(" or ")}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return hasPassage ? (
    <div className="grid gap-6 md:grid-cols-2 md:gap-10">
      <QuestionStatement
        text={content.passageText ?? ""}
        imageId={null}
        mediaBasePath="/api/media"
        className="bg-transparent p-0 md:border-r md:border-foreground/15 md:pr-10"
        textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
      />
      {question}
    </div>
  ) : (
    question
  );
}

/** An explanation's steps up to `upTo` (inclusive), the newest one marked. */
export function StepsList({
  steps,
  upTo,
  className,
}: {
  steps: { text: string; imageId: string | null }[];
  upTo: number;
  className?: string;
}) {
  const shown = steps.slice(0, upTo + 1);
  return (
    <ol className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}>
      {shown.map((step, i) => (
        <li
          key={i}
          className={[
            "flex gap-3 rounded-lg p-3",
            i === shown.length - 1 ? "bg-primary/10 ring-1 ring-primary/40" : "",
          ].join(" ")}
          aria-current={i === shown.length - 1 ? "step" : undefined}
        >
          <span className="w-5 shrink-0 font-mono text-sm text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <LatexText text={step.text} className="text-base leading-relaxed lg:text-lg" />
            {step.imageId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/media/${step.imageId}`} alt="" className="mt-2 max-w-full rounded" />
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
