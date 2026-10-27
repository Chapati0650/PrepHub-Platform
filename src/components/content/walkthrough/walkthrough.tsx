"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ListOrdered, Maximize2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LatexText } from "@/components/content/latex-text";
import { panelId, stateAt, type Panel, type PanelState, type WalkthroughView } from "@/lib/content/walkthrough";
import { BarsFigure, DiagramFigure, NumberLineFigure, PlaneFigure } from "./figures";
import { ChoicesPanel, PassagePanel, TablePanel, VarsChips, WorkPanel } from "./panels";

// A question's explanation as a step-through: Back / Next, a progress bar
// that jumps to any step, the stage, and the step's own text as narration.
// The narration is the explanation step itself, so a student who can't see
// the stage (or turns it off with "All steps") loses nothing.

export type StepText = { text: string; imageId: string | null };

function PanelView({
  panel,
  state,
  view,
  index,
}: {
  panel: Panel;
  state: PanelState | undefined;
  view: WalkthroughView;
  index: number;
}) {
  if (!state) return null;
  switch (panel.type) {
    case "passage":
      return state.type === "passage" && view.passageText ? <PassagePanel source={view.passageText} state={state.state} stepKey={index} /> : null;
    case "choices":
      return state.type === "choices" ? <ChoicesPanel choices={view.choices} correctIndex={view.correctIndex} state={state.state} /> : null;
    case "work":
      return state.type === "work" ? <WorkPanel title={panel.title} state={state.state} /> : null;
    case "table":
      return state.type === "table" ? <TablePanel panel={panel} state={state.state} /> : null;
    case "plane":
      return state.type === "plane" ? (
        <div className="min-w-0 rounded-lg border border-border bg-background p-2">
          <PlaneFigure panel={panel} state={state.state} />
        </div>
      ) : null;
    case "diagram":
      return state.type === "diagram" ? (
        <div className="min-w-0 rounded-lg border border-border bg-background p-2">
          <DiagramFigure panel={panel} state={state.state} />
        </div>
      ) : null;
    case "numberline":
      return state.type === "numberline" ? (
        <div className="min-w-0 rounded-lg border border-border bg-background p-2">
          <NumberLineFigure panel={panel} state={state.state} />
        </div>
      ) : null;
    case "bars":
      return state.type === "bars" ? (
        <div className="min-w-0 rounded-lg border border-border bg-background p-3">
          <BarsFigure panel={panel} state={state.state} />
        </div>
      ) : null;
    default:
      return null;
  }
}

function WalkthroughBody({
  view,
  steps,
  mediaBasePath,
  index,
  setIndex,
  toolbarEnd,
}: {
  view: WalkthroughView;
  steps: StepText[];
  mediaBasePath: string;
  index: number;
  setIndex: (i: number) => void;
  toolbarEnd?: ReactNode;
}) {
  const total = steps.length;
  const states = useMemo(() => stateAt(view.spec, index), [view.spec, index]);
  const stage = view.spec.panels.filter((p) => p.type !== "vars");
  const vars = view.spec.panels.find((p) => p.type === "vars");
  const varsState = vars ? states.get(panelId(vars)) : undefined;
  const hasPassage = stage.some((p) => p.type === "passage");
  const step = steps[index];
  const last = index === total - 1;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === "ArrowRight" && !last) {
      event.preventDefault();
      setIndex(index + 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      setIndex(index - 1);
    }
  }

  return (
    <section aria-label="Step-by-step walkthrough" onKeyDown={onKeyDown} className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Previous step">
          <ArrowLeft />
        </Button>
        <Button size="sm" onClick={() => setIndex(index + 1)} disabled={last} className="min-w-28">
          {last ? "Last step" : "Next step"}
          {!last && <ArrowRight data-icon="inline-end" />}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setIndex(0)} disabled={index === 0} aria-label="Start over">
          <RotateCcw />
        </Button>
        <p className="ml-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">
          Step {index + 1} of {total}
        </p>
        {toolbarEnd}
      </div>

      {/* Every segment is a button, so any step is one press away. */}
      <div className="flex gap-1" role="group" aria-label="Jump to a step">
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Step ${i + 1}`}
            aria-current={i === index ? "step" : undefined}
            className="group flex h-4 flex-1 items-center"
          >
            <span
              className={cn(
                "h-1.5 w-full rounded-full transition-colors duration-300 group-hover:bg-primary/60",
                i < index ? "bg-primary/50" : i === index ? "bg-primary" : "bg-foreground/10",
              )}
            />
          </button>
        ))}
      </div>

      <div className={cn("grid gap-3", stage.length > 1 && (hasPassage ? "@3xl:grid-cols-2" : "@xl:grid-cols-2"))}>
        {stage.map((panel) => {
          // A number line is a long strip and always takes the full width; of
          // the rest, an odd one out does too rather than leaving a hole.
          const halves = stage.filter((p) => p.type !== "numberline");
          const spans =
            stage.length > 1 &&
            (panel.type === "numberline" || (halves.length % 2 === 1 && panel === halves[halves.length - 1]));
          return (
            <div key={panelId(panel)} className={cn("min-w-0", spans && (hasPassage ? "@3xl:col-span-2" : "@xl:col-span-2"))}>
              <PanelView panel={panel} state={states.get(panelId(panel))} view={view} index={index} />
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 @lg:flex-row @lg:items-start">
        {varsState?.type === "vars" && varsState.state.entries.length > 0 && <VarsChips state={varsState.state} />}
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className={cn("mb-1 text-xs font-medium tracking-wide uppercase", last ? "text-primary" : "text-muted-foreground")}>
            {last ? "The answer" : "What's happening"}
          </p>
          <div className="text-base leading-relaxed">
            <LatexText text={step.text} />
          </div>
          {step.imageId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${mediaBasePath}/${step.imageId}`} alt="" className="mt-2 max-w-full rounded" />
          )}
        </div>
      </div>
    </section>
  );
}

export function Walkthrough({
  view,
  steps,
  mediaBasePath,
  list,
}: {
  view: WalkthroughView;
  steps: StepText[];
  mediaBasePath: string;
  /** The plain step list, for "All steps". */
  list: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"walkthrough" | "list">("walkthrough");
  const [expanded, setExpanded] = useState(false);
  const go = (i: number) => setIndex(Math.max(0, Math.min(steps.length - 1, i)));

  if (mode === "list") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setMode("walkthrough")}>
            <ArrowRight data-icon="inline-start" />
            Step through it instead
          </Button>
        </div>
        {list}
      </div>
    );
  }

  const tools = (
    <>
      <Button variant="ghost" size="sm" onClick={() => setMode("list")}>
        <ListOrdered data-icon="inline-start" />
        All steps
      </Button>
      {!expanded && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} aria-label="Open full screen">
          <Maximize2 />
        </Button>
      )}
    </>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <WalkthroughBody view={view} steps={steps} mediaBasePath={mediaBasePath} index={index} setIndex={go} toolbarEnd={tools} />
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-h-[92dvh] w-[min(96vw,76rem)] overflow-y-auto p-5 sm:max-w-none">
          <DialogTitle className="sr-only">Step-by-step walkthrough</DialogTitle>
          <div className="pt-6">
            <WalkthroughBody view={view} steps={steps} mediaBasePath={mediaBasePath} index={index} setIndex={go} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
