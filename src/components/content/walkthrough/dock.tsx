"use client";

import { useRef, type TouchEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Eye, ListOrdered, Maximize2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LatexText } from "@/components/content/latex-text";
import { goalAt, goalParts, markNarration, promptAnswers, type Formula, type Prompt } from "@/lib/content/walkthrough";
import { passageState, useOptionalWalkthrough, type WalkthroughHost } from "./context";
import { WalkthroughFeedbackAsk } from "./feedback";
import { renderWorkTex } from "./panels";
import { useStepKeys, WalkthroughStage } from "./stage";

// The dock: the step's explanation and the controls that move through it, in
// one bar. On a question page it sits at the end of the question and is
// pinned to the bottom of the screen while any of the question is in view, so
// the words and Back/Next are always together and always reachable — the
// student scrolls the question, not the explanation. Elsewhere (the
// full-screen view, the editor's preview) it's an ordinary block.

const LETTERS = ["A", "B", "C", "D", "E"];

function Takeaway({ text }: { text: string }) {
  return (
    <div className="mt-2.5 border-l-2 border-primary pl-3">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">Remember</p>
      <div className="text-[0.95rem] leading-relaxed">
        <LatexText text={text} />
      </div>
    </div>
  );
}

export { Takeaway as WalkthroughTakeaway };

/** The formulas a walkthrough stated, gathered at its end and in "All steps". */
export function FormulasUsed({ formulas, className }: { formulas: Formula[]; className?: string }) {
  if (formulas.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-border bg-muted/40 px-3 py-2", className)}>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Formula{formulas.length === 1 ? "" : "s"} used</p>
      <ul className="mt-1 flex flex-col gap-1">
        {formulas.map((f) => (
          <li key={f.tex} className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem]">
            <span className="font-medium">
              <LatexText text={f.name} />
            </span>
            <span dangerouslySetInnerHTML={{ __html: renderWorkTex(f.tex) }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PromptView({ prompt, wt }: { prompt: Prompt; wt: WalkthroughHost }) {
  const options = prompt.options === "choices" ? wt.view.choices : prompt.options;
  const asChoices = prompt.options === "choices";
  const long = asChoices || options.some((o) => o.length > 28);
  const several = promptAnswers(prompt).length > 1;
  return (
    <div>
      <div className="text-base leading-relaxed font-medium">
        <LatexText text={prompt.ask} />
      </div>
      {several && <p className="mt-0.5 text-sm text-muted-foreground">More than one is right; any of them counts.</p>}
      <div role="group" aria-label="Your answer" className={cn("mt-2.5 flex gap-2", long ? "flex-col" : "flex-wrap")}>
        {options.map((option, i) => {
          const tried = wt.wrongTries.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={tried}
              onClick={() => wt.answerPrompt(i)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border-2 px-3 py-2 text-left text-base transition-colors",
                long && "w-full",
                tried
                  ? "border-destructive/40 bg-destructive/5 text-muted-foreground line-through"
                  : "border-border hover:border-primary hover:bg-primary/5",
              )}
            >
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground/40 text-[0.7rem] font-semibold"
              >
                {asChoices ? LETTERS[i] : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {asChoices && <span className="sr-only">Choice {LETTERS[i]}: </span>}
                {/* Full-size fractions: a small 1/12 on a button is hard to read. */}
                <LatexText text={option} displayInline />
              </span>
              {tried && <span className="sr-only"> (not this one)</span>}
            </button>
          );
        })}
      </div>
      {wt.wrongTries.length > 0 && (
        <p role="status" className="mt-2 text-sm">
          <span className="font-semibold text-destructive">Not quite. </span>
          {prompt.hint ? <LatexText text={prompt.hint} /> : "Try another, or press Show me."}
        </p>
      )}
    </div>
  );
}

/** What the step did to the answer choices, said in the caption too, for when they're scrolled away. */
function ChoiceChips({ wt }: { wt: WalkthroughHost }) {
  const { focus, eliminate, reveal } = wt.choiceChanges;
  const chips: { text: string; tone: string }[] = [];
  const revealsFocus = reveal && focus === wt.view.correctIndex;
  if (focus !== null && !eliminate.includes(focus) && !revealsFocus) chips.push({ text: `Checking ${LETTERS[focus]}`, tone: "border-primary/40 text-primary" });
  if (eliminate.length > 0) chips.push({ text: `Ruled out: ${eliminate.map((i) => LETTERS[i]).join(", ")}`, tone: "border-border text-muted-foreground" });
  if (reveal && wt.view.correctIndex !== null) {
    const yours = wt.studentChoiceIndex === wt.view.correctIndex;
    chips.push({
      text: `Answer: ${LETTERS[wt.view.correctIndex]}${yours ? " · your answer" : ""}`,
      tone: "border-green-600/50 text-green-800 dark:text-green-300",
    });
  }
  if (chips.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <li key={chip.text} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", chip.tone)}>
          {chip.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * On the step that rules out the student's own wrong answer, say so in the
 * dock: the reason is on the choice too, but the choice may be scrolled
 * away, and this is the step the student most needs to read.
 */
function YourAnswerCallout({ wt }: { wt: WalkthroughHost }) {
  const yours = wt.studentChoiceIndex;
  if (yours === null || yours === wt.view.correctIndex || !wt.choiceChanges.eliminate.includes(yours)) return null;
  const note = wt.choiceNotes[yours];
  return (
    <p className="mt-2 rounded-md border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-[0.95rem] leading-relaxed">
      <span className="font-semibold text-destructive">This is where your answer, {LETTERS[yours]}, goes wrong. </span>
      {note && <LatexText text={note} />}
    </p>
  );
}

/**
 * Every step is a button, so any step is one press away. With named parts
 * the segments are grouped under their names, so a student sees the shape
 * of the solution before reading it.
 */
function StepBar({ wt }: { wt: WalkthroughHost }) {
  const parts = goalParts(wt.view.spec);
  const groups = parts.length > 0 ? parts : [{ label: "", from: 0, to: wt.total }];
  return (
    <div className="flex gap-2" role="group" aria-label="Jump to a step">
      {groups.map((group) => {
        const current = wt.index >= group.from && wt.index < group.to;
        return (
          <div key={group.from} className="flex min-w-0 flex-col" style={{ flex: `${group.to - group.from} 1 0%` }}>
            {group.label && (
              <p
                className={cn(
                  "hidden truncate text-[0.7rem] leading-tight font-medium sm:block",
                  current ? "text-primary" : wt.index >= group.to ? "text-foreground/70" : "text-muted-foreground",
                )}
                title={group.label}
              >
                {group.label}
              </p>
            )}
            <div className="flex gap-1">
              {Array.from({ length: group.to - group.from }, (_, k) => {
                const i = group.from + k;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => wt.go(i)}
                    aria-label={`Step ${i + 1}${group.label ? `, ${group.label}` : ""}`}
                    aria-current={i === wt.index ? "step" : undefined}
                    className="group flex h-4 flex-1 items-center"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-full rounded-full transition-colors duration-300 group-hover:bg-primary/60",
                        i < wt.index ? "bg-primary/50" : i === wt.index ? "bg-primary" : "bg-foreground/10",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A horizontal swipe on the dock steps through, as the arrow keys do. */
function useSwipe(wt: WalkthroughHost | null) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: TouchEvent) => {
      const t = event.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current;
      const t = event.changedTouches[0];
      start.current = null;
      if (!wt || !from || !t || wt.pendingPrompt) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Math.abs(dx) < 56 || Math.abs(dy) > 40) return;
      if (dx < 0 && wt.index < wt.total - 1) wt.go(wt.index + 1);
      else if (dx > 0 && wt.index > 0) wt.go(wt.index - 1);
    },
  };
}

export function WalkthroughDock({ pinned = true, inDialog = false, className }: { pinned?: boolean; inDialog?: boolean; className?: string }) {
  const wt = useOptionalWalkthrough();
  const onKeyDown = useStepKeys();
  const swipe = useSwipe(wt);
  if (!wt || wt.mode === "list") return null;

  const { index, total, pendingPrompt, finished } = wt;
  const last = index === total - 1;
  const step = wt.steps[index];
  const passage = passageState(wt);
  const narration = passage ? markNarration(step.text, passage.highlight, passage.alt) : step.text;
  const goal = goalAt(wt.view.spec, index);
  const label = pendingPrompt ? "Your turn" : last ? "The answer" : "Explanation";
  const stuck = pinned && !inDialog && !finished;
  // Folding is for a small screen, where the dock covers the figure it talks
  // about; a question waiting for an answer never folds.
  const folded = wt.folded && !inDialog && !pendingPrompt;

  const primary = pendingPrompt ? (
    <Button size="sm" variant="outline" onClick={wt.showPromptAnswer} className="min-w-28">
      Show me
      <ArrowRight data-icon="inline-end" />
    </Button>
  ) : !last ? (
    <Button size="sm" onClick={() => wt.go(index + 1)} className="min-w-28">
      Next step
      <ArrowRight data-icon="inline-end" />
    </Button>
  ) : wt.finish && !inDialog ? (
    <Button size="sm" onClick={wt.finish.onClick} className="min-w-28">
      {wt.finish.label}
      <ArrowRight data-icon="inline-end" />
    </Button>
  ) : (
    <Button
      size="sm"
      onClick={() => (inDialog ? wt.setExpanded(false) : wt.setFinished(true))}
      className="min-w-28"
    >
      <Check data-icon="inline-start" />
      Done
    </Button>
  );

  if (finished && !inDialog) {
    return (
      <div className={cn("mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm", className)}>
        <Check className="size-4 text-primary" aria-hidden />
        <p className="font-medium">That&apos;s the whole explanation.</p>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => wt.go(0)}>
            <RotateCcw data-icon="inline-start" />
            Replay
          </Button>
          <Button variant="ghost" size="sm" onClick={() => wt.setMode("list")}>
            <ListOrdered data-icon="inline-start" />
            All steps
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Step-by-step walkthrough"
      onKeyDown={onKeyDown}
      {...swipe}
      data-wt-dock={stuck ? "" : undefined}
      className={cn(
        "rounded-xl border border-border bg-card px-4 pt-2.5 pb-3",
        stuck && "sticky bottom-[var(--wt-dock-offset,0px)] z-20 mt-4 shadow-[0_-6px_24px_-12px_rgb(0_0_0/0.25)]",
        !stuck && !inDialog && "mt-4",
        className,
      )}
    >
      <StepBar wt={wt} />

      {/* The label and the controls share a row, so the dock spends its
          height on the explanation rather than on chrome. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className={cn("mr-auto min-w-0 text-xs font-semibold tracking-wide uppercase", pendingPrompt || last ? "text-primary" : "text-muted-foreground")}>
          {/* On a phone the part's name isn't over the bar, so it's said here. */}
          {goal && !pendingPrompt && !last ? (
            <>
              <span className="sm:hidden">{goal.label}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ) : (
            label
          )}{" "}
          <span className="font-normal tabular-nums">
            · Step {index + 1} of {total}
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => wt.go(index - 1)} disabled={index === 0} aria-label="Previous step">
            <ArrowLeft />
          </Button>
          {primary}
          <Button variant="ghost" size="sm" onClick={() => wt.go(0)} disabled={index === 0} aria-label="Start over">
            <RotateCcw />
          </Button>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={() => wt.setMode("list")}>
            <ListOrdered data-icon="inline-start" />
            <span className="max-sm:sr-only">All steps</span>
          </Button>
          {!inDialog && (
            <Button variant="ghost" size="sm" onClick={() => wt.setExpanded(true)} aria-label="Open full screen">
              <Maximize2 />
            </Button>
          )}
          {!inDialog && !pendingPrompt && (
            <Button
              variant="ghost"
              size="sm"
              className="sm:hidden"
              onClick={() => wt.setFolded(!wt.folded)}
              aria-expanded={!folded}
              aria-label={folded ? "Show the whole explanation" : "Fold the explanation down"}
            >
              {folded ? <ChevronUp /> : <ChevronDown />}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-1.5" aria-live="polite">
        {pendingPrompt ? (
          <PromptView prompt={pendingPrompt} wt={wt} />
        ) : folded ? (
          // Folded: one line of the explanation, and a tap opens the rest.
          <button type="button" onClick={() => wt.setFolded(false)} className="line-clamp-2 w-full text-left text-[0.95rem] leading-snug">
            <LatexText text={narration} />
          </button>
        ) : (
          <>
            {wt.promptResult === "right" && (
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400">
                <Check className="size-4" aria-hidden />
                Right.
              </p>
            )}
            <div className="text-base leading-relaxed">
              <LatexText text={narration} />
            </div>
            {step.imageId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${wt.mediaBasePath}/${step.imageId}`} alt="" className="mt-2 max-w-full rounded" />
            )}
            {wt.onQuestion && !inDialog && <YourAnswerCallout wt={wt} />}
            {wt.onQuestion && !inDialog && <ChoiceChips wt={wt} />}
            {last && wt.view.spec.takeaway && <Takeaway text={wt.view.spec.takeaway} />}
            {last && wt.collectFeedback && wt.view.revisionId && !inDialog && (
              <WalkthroughFeedbackAsk revisionId={wt.view.revisionId} stepCount={total} />
            )}
          </>
        )}
      </div>

      {!folded && ((wt.changeOffscreen && !inDialog) || index === 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {wt.changeOffscreen && !inDialog && (
            <Button variant="secondary" size="sm" onClick={wt.showChange}>
              <Eye data-icon="inline-start" />
              Show this step
            </Button>
          )}
          {/* Said once, on the first step, where it's useful. */}
          {index === 0 && <span className="hidden text-xs text-muted-foreground pointer-fine:inline">Tip: the ← and → keys move between steps.</span>}
          {index === 0 && <span className="text-xs text-muted-foreground pointer-fine:hidden">Tip: swipe the explanation left or right to move between steps.</span>}
        </div>
      )}

      {!inDialog && (
        <Dialog open={wt.expanded} onOpenChange={wt.setExpanded}>
          <DialogContent className="max-h-[92dvh] w-[min(96vw,76rem)] overflow-y-auto p-5 sm:max-w-none">
            <DialogTitle className="sr-only">Step-by-step walkthrough</DialogTitle>
            <div className="flex flex-col gap-3 pt-6">
              <WalkthroughStage includeQuestion />
              <WalkthroughDock inDialog />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
