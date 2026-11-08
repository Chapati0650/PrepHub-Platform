"use client";

import { LatexText } from "@/components/content/latex-text";
import { GuidedQuestion, StepsList } from "@/components/guided/question";
import { STRINGS } from "@/components/guided/strings";
import { TALK_FROM } from "@/lib/guided/config";
import type { SharedState } from "@/lib/guided/state";

const t = STRINGS.en;

/**
 * What students' screens show right now, for the teacher's console. It is
 * drawn from the same shared state every student screen polls, using the same
 * question and step components, so it is what a student sees in the room's
 * current phase (English; a student can switch to Spanish on their own
 * device). Read-only: nothing here can be clicked or typed into.
 *
 * Two things are personal and so can't be shown here: a student's own choice
 * and, while students work on their own, their own questions.
 */
export function StudentScreenPreview({ shared }: { shared: SharedState | null }) {
  if (!shared) return <p className="text-base text-muted-foreground">Students&apos; screens aren&apos;t available right now.</p>;

  const item = shared.item;
  let body: React.ReactNode = null;

  if (shared.paused) {
    body = <EyesUp title={t.eyesUp} body={t.eyesUpPaused} />;
  } else {
    switch (shared.phase) {
      case "LOBBY":
        body = item ? (
          <Question label={`${t.warmup} · ${t.warmupHint}`}>
            <GuidedQuestion content={item.content} value="" disabled t={t} />
          </Question>
        ) : (
          <p className="text-lg">{t.waitingStart}</p>
        );
        break;
      case "PLAN":
        body = (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.plan}</p>
            <p className="text-xl font-semibold">{shared.categoryLabel}</p>
            <ol className="list-decimal pl-6 text-base">
              <li>{t.planLearn}</li>
              <li>{t.planTogether(shared.classQuestionCount)}</li>
              <li>{t.planOwn(shared.ownQuestionCount)}</li>
              <li>{t.planRecap}</li>
            </ol>
            <p className="text-sm text-muted-foreground">{t.planWhy}</p>
          </div>
        );
        break;
      case "EXAMPLE":
        // Students follow one step behind the board.
        body = item ? (
          <div className="flex flex-col gap-3">
            <EyesUp title={t.eyesUp} body={t.eyesUpExample} />
            <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{t.exampleTitle}</p>
            <LatexText text={item.content.questionText} className="text-base" />
            {item.steps && item.steps.length > 1 && <StepsList steps={item.steps} upTo={item.steps.length - 2} />}
          </div>
        ) : null;
        break;
      case "THINK":
      case "REVOTE":
        body = item ? (
          <Question label={shared.phase === "REVOTE" ? t.voteAgain : t.thinkAlone}>
            <GuidedQuestion content={item.content} value="" disabled t={t} />
            <p className="text-sm text-muted-foreground">
              {t.inCount(shared.phase === "REVOTE" ? item.secondAnswered : item.firstAnswered, shared.joined)}
            </p>
          </Question>
        ) : null;
        break;
      case "TALK":
        body = (
          <div className="flex flex-col gap-3">
            <p className="text-xl font-semibold">{t.talk}</p>
            <p className="text-base">{t.talkBody}</p>
            <ul className="flex flex-col gap-2 text-base">
              <li className="rounded-lg border border-dashed border-foreground/30 p-2">{t.starter1}</li>
              <li className="rounded-lg border border-dashed border-foreground/30 p-2">{t.starter2}</li>
            </ul>
          </div>
        );
        break;
      case "REVEAL":
      case "EXPLAIN": {
        const reveal = item?.reveal;
        if (!item || !reveal) break;
        const explaining = shared.phase === "EXPLAIN";
        const hard = reveal.firstRight !== null && reveal.firstRight < TALK_FROM && item.kind === "CLASS";
        body = (
          <div className="flex flex-col gap-3">
            <p className="text-lg font-semibold">{t.answerIs(reveal.correctLabel)}</p>
            <p className="text-sm text-muted-foreground">
              Each student also sees whether they were right and, if they chose the popular wrong answer, why it is wrong.
            </p>
            {hard && !explaining && <p className="rounded-xl bg-surface-tint p-3 text-base">{t.hardOne}</p>}
            {explaining && item.steps && (
              <div className="flex flex-col gap-2">
                <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                  {t.followBoard} · {t.step(item.steps.length, item.stepTotal)}
                </p>
                <StepsList steps={item.steps} upTo={item.steps.length - 1} />
              </div>
            )}
            {item.takeaway && (
              <p className="rounded-xl border border-border p-3 text-base">
                <span className="font-semibold">{t.remember}: </span>
                <LatexText text={item.takeaway} />
              </p>
            )}
            <GuidedQuestion content={item.content} value="" disabled reveal={reveal} t={t} />
          </div>
        );
        break;
      }
      case "OWN":
        body = (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.own}</p>
            <p className="text-base">{t.ownSub}</p>
            <p className="text-sm text-muted-foreground">
              Every student has different questions here, picked for them, so there is no single screen to show.{" "}
              {shared.ownFinished} of {shared.joined} have finished.
            </p>
          </div>
        );
        break;
      case "RECAP":
        body = (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.recap}</p>
            <p className="text-xl font-semibold">{shared.categoryLabel}</p>
            {shared.recap && shared.recap.takeaways.length > 0 && (
              <div className="rounded-xl bg-surface-tint p-3">
                <p className="font-semibold">{t.remember}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {shared.recap.takeaways.map((k) => (
                    <li key={k} className="text-base">
                      <LatexText text={k} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
        break;
    }
  }

  // `inert` keeps the preview read-only: no focus, no clicks, not announced as controls.
  return <div inert>{body}</div>;
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-xs tracking-wider text-primary uppercase">{label}</p>
      {children}
    </div>
  );
}

function EyesUp({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-surface-deep p-4 text-surface-deep-foreground">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-base opacity-90">{body}</p>
    </div>
  );
}
