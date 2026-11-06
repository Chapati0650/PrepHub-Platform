"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LatexText } from "@/components/content/latex-text";
import { GuidedQuestion, StepsList, choiceLetter } from "@/components/guided/question";
import { useGuidedLang } from "@/components/guided/use-lang";
import type { Strings } from "@/components/guided/strings";
import type { Feedback, StudentRecap } from "@/lib/guided/student";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import { catchUpAction, retryAction } from "../actions";

/**
 * After the bell: what a student did, two rules to remember, a second try at
 * the own questions they missed, and, for a student who was absent or came
 * in late, the questions the room did, at their own pace with the
 * explanations. Nothing here touches the predicted score.
 */
export function RecapView({ recap }: { recap: StudentRecap }) {
  const { t, toggle } = useGuidedLang();
  const own = recap.own.filter((o) => !o.bonus);
  const ownRight = own.filter((o) => o.feedback?.isCorrect).length;
  const retries = recap.own.filter((o) => !o.feedback?.isCorrect && !o.retry);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="font-mono text-xs tracking-wider text-primary uppercase">
            {t.guided} · {recap.className}
          </p>
          <Button variant="outline" size="sm" onClick={toggle}>
            {t.language}
          </Button>
        </div>
        <h1 className="mt-2 text-page-title sm:text-page-title-lg">{recap.categoryLabel}</h1>
        {recap.joined && own.length > 0 && (
          <p className="mt-3 text-lg">
            {t.own}: <span className="font-semibold tabular-nums">{t.rightOf(ownRight, own.length)}</span>
          </p>
        )}
      </header>

      {recap.catchUp.length > 0 && <CatchUp t={t} items={recap.catchUp} />}

      {recap.questions.length > 0 && (
        <section aria-labelledby="together-h" className="flex flex-col gap-3">
          <h2 id="together-h" className="text-xl">
            {t.together}
          </h2>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {recap.questions.map((q) => {
              const final = q.secondAnswer !== null ? q.secondCorrect : q.firstCorrect;
              return (
                <li key={q.itemId} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4 text-base">
                  <span className="w-44 font-medium">{q.label}</span>
                  {q.firstAnswer === null && q.secondAnswer === null ? (
                    <span className="text-muted-foreground">{t.notAnswered}</span>
                  ) : (
                    <span className={final ? "font-semibold text-green-800 dark:text-green-300" : "font-semibold text-destructive"}>
                      {final ? t.right : t.missed}
                      {q.secondAnswer !== null && q.firstAnswer !== null && q.secondAnswer !== q.firstAnswer
                        ? ` · ${q.firstAnswer} → ${q.secondAnswer}`
                        : ` · ${q.secondAnswer ?? q.firstAnswer}`}
                    </span>
                  )}
                  {!final && <span className="text-muted-foreground">{t.answerIs(q.correctLabel)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recap.takeaways.length > 0 && (
        <section className="rounded-2xl bg-surface-tint p-5">
          <h2 className="text-lg">{t.remember}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {recap.takeaways.map((k) => (
              <li key={k} className="text-base">
                <LatexText text={k} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {retries.length > 0 && (
        <section aria-labelledby="retry-h" className="flex flex-col gap-4">
          <h2 id="retry-h" className="text-xl">
            Try again
          </h2>
          <p className="text-base text-muted-foreground">
            {retries.length === 1 ? "One of your own questions" : `${retries.length} of your own questions`} you missed or
            didn&apos;t reach. A second try, with the explanation after.
          </p>
          {retries.map((o) => (
            <Retry key={o.id} t={t} slotId={o.id} content={o.content} first={o.feedback} />
          ))}
        </section>
      )}

      <Link href="/home" className="inline-flex h-12 w-fit items-center rounded-full border border-border px-6 text-base font-medium">
        Back to your dashboard
      </Link>
    </div>
  );
}

function FeedbackBlock({ t, content, feedback }: { t: Strings; content: StudentQuestionContent; feedback: Feedback }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={`text-lg font-semibold ${feedback.isCorrect ? "text-green-800 dark:text-green-300" : "text-destructive"}`}>
        {feedback.isCorrect ? t.correct : t.answerIs(choiceLetter(content, feedback.correctChoiceId) || feedback.acceptedAnswers[0] || "")}
      </p>
      {feedback.distractor && <LatexText text={feedback.distractor} className="block rounded-xl bg-surface-tint p-3 text-base" />}
      {feedback.steps.length > 0 && <StepsList steps={feedback.steps} upTo={feedback.steps.length - 1} />}
    </div>
  );
}

function Retry({ t, slotId, content, first }: { t: Strings; slotId: string; content: StudentQuestionContent; first: Feedback | null }) {
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const r = await retryAction(slotId, value);
      if (r.ok) setFeedback(r.feedback);
      else setError(r.error);
    } catch {
      setError("That didn't send. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-5">
      {first && !first.isCorrect && (
        <p className="text-sm text-muted-foreground">
          {t.youChose(choiceLetter(content, first.answer))} {t.missed}.
        </p>
      )}
      <GuidedQuestion
        content={content}
        value={feedback ? feedback.answer : value}
        onChange={feedback ? undefined : setValue}
        onSubmit={submit}
        disabled={!!feedback || pending}
        reveal={feedback ? { correctChoiceId: feedback.correctChoiceId, acceptedAnswers: feedback.acceptedAnswers } : null}
        t={t}
      />
      {feedback ? (
        <FeedbackBlock t={t} content={content} feedback={feedback} />
      ) : (
        <Button size="xl" className="w-fit" onClick={submit} disabled={!value.trim() || pending}>
          {t.submit}
        </Button>
      )}
      {error && <p role="alert" className="text-base text-destructive">{error}</p>}
    </div>
  );
}

function CatchUp({ t, items }: { t: Strings; items: StudentRecap["catchUp"] }) {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const item = items[index];
  const minutes = Math.max(1, Math.round(items.length * 1.5));

  if (!item) {
    return (
      <section className="rounded-2xl bg-surface-tint p-5">
        <h2 className="text-xl">You&apos;re caught up.</h2>
        <p className="mt-1 text-base text-muted-foreground">Your teacher sees that you did the session&apos;s questions.</p>
      </section>
    );
  }

  async function submit() {
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const r = await catchUpAction(item.itemId, value);
      if (r.ok) {
        setFeedback(r.feedback);
        setError(null);
      } else setError(r.error);
    } catch {
      setError("That didn't send. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="catchup-h" className="flex flex-col gap-4 rounded-2xl border-2 border-primary/40 p-5">
      <div>
        <h2 id="catchup-h" className="text-xl">
          Catch up on what you missed
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          {items.length === 1 ? "One question" : `${items.length} questions`} the class did, about {minutes} minute
          {minutes === 1 ? "" : "s"}, with the explanation after each.
        </p>
      </div>
      <p className="font-mono text-xs tracking-wider text-primary uppercase">
        {item.label} · {index + 1} of {items.length}
      </p>
      <GuidedQuestion
        key={item.itemId}
        content={item.content}
        value={feedback ? feedback.answer : value}
        onChange={feedback ? undefined : setValue}
        onSubmit={submit}
        disabled={!!feedback || pending}
        reveal={feedback ? { correctChoiceId: feedback.correctChoiceId, acceptedAnswers: feedback.acceptedAnswers } : null}
        t={t}
      />
      {feedback ? (
        <>
          <FeedbackBlock t={t} content={item.content} feedback={feedback} />
          <Button
            size="cta"
            className="w-fit"
            onClick={() => {
              setIndex((i) => i + 1);
              setValue("");
              setFeedback(null);
            }}
          >
            {t.next}
          </Button>
        </>
      ) : (
        <Button size="cta" className="w-fit" onClick={submit} disabled={!value.trim() || pending}>
          {t.submit}
        </Button>
      )}
      {error && <p role="alert" className="text-base text-destructive">{error}</p>}
    </section>
  );
}
