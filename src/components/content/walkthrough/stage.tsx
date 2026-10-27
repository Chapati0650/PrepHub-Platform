"use client";

import { useCallback, type CSSProperties, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { panelId, type Panel } from "@/lib/content/walkthrough";
import { BarsFigure, DiagramFigure, NumberLineFigure, PlaneFigure } from "./figures";
import { ChoicesPanel, PassagePanel, TablePanel, VarsChips, WorkPanel } from "./panels";
import { useHighlightsSupported } from "./on-question";
import { useOptionalWalkthrough, type WalkthroughHost } from "./context";

// The stage: one box holding what the question itself doesn't show — a
// graph, a diagram, the working, a table — with the panels separated by
// rules rather than each in a box of its own. A panel the shown step changed
// gets one fading ring, so the eye finds the change. Where the walkthrough
// can't draw on the question (the full-screen view, a page without the
// question on it), the passage and the choices are drawn here too.

/** Left and right arrows step through the walkthrough from anywhere inside it. */
export function useStepKeys(): (event: KeyboardEvent<HTMLElement>) => void {
  const wt = useOptionalWalkthrough();
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!wt) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (wt.pendingPrompt) wt.showPromptAnswer();
        else if (wt.index < wt.total - 1) wt.go(wt.index + 1);
      } else if (event.key === "ArrowLeft" && wt.index > 0) {
        event.preventDefault();
        wt.go(wt.index - 1);
      } else if (wt.pendingPrompt && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        wt.answerPrompt(Number(event.key) - 1);
      }
    },
    [wt],
  );
}

function PanelView({ panel, wt }: { panel: Panel; wt: WalkthroughHost }) {
  const state = wt.states.get(panelId(panel));
  if (!state) return null;
  switch (panel.type) {
    case "passage":
      return state.type === "passage" && wt.view.passageText ? (
        <PassagePanel source={wt.view.passageText} state={state.state} stepKey={wt.shownIndex} />
      ) : null;
    case "choices": {
      if (state.type !== "choices") return null;
      const c = wt.pendingPrompt ? { focus: null, eliminate: [], reveal: false } : wt.choiceChanges;
      const changedNow = [...c.eliminate, ...(c.focus !== null ? [c.focus] : []), ...(c.reveal && wt.view.correctIndex !== null ? [wt.view.correctIndex] : [])];
      return (
        <ChoicesPanel
          choices={wt.view.choices}
          correctIndex={wt.view.correctIndex}
          state={state.state}
          studentIndex={wt.studentChoiceIndex}
          notes={wt.choiceNotes}
          changedNow={changedNow}
        />
      );
    }
    case "work":
      return state.type === "work" ? <WorkPanel title={panel.title} state={state.state} /> : null;
    case "table":
      return state.type === "table" ? <TablePanel panel={panel} state={state.state} /> : null;
    case "plane":
      return state.type === "plane" ? <PlaneFigure panel={panel} state={state.state} /> : null;
    case "diagram":
      return state.type === "diagram" ? <DiagramFigure panel={panel} state={state.state} /> : null;
    case "numberline":
      return state.type === "numberline" ? <NumberLineFigure panel={panel} state={state.state} /> : null;
    case "bars":
      return state.type === "bars" ? <BarsFigure panel={panel} state={state.state} /> : null;
    default:
      return null;
  }
}

function StagePanel({ panel, wt, wide }: { panel: Panel; wt: WalkthroughHost; wide: boolean }) {
  const id = panelId(panel);
  const register = wt.registerTarget;
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return undefined;
      return register(`panel-${id}`, () => el);
    },
    [register, id],
  );
  const changed = !wt.pendingPrompt && wt.changed.has(id);
  return (
    <div ref={ref} className={cn("relative min-w-0 bg-card p-4", wide && "col-span-full")}>
      {changed && <span key={wt.shownIndex} aria-hidden className="pointer-events-none absolute inset-0 motion-safe:animate-wt-pulse" />}
      <PanelView panel={panel} wt={wt} />
    </div>
  );
}

export function WalkthroughStage({ includeQuestion = false }: { includeQuestion?: boolean }) {
  const wt = useOptionalWalkthrough();
  const highlightsOk = useHighlightsSupported();
  const onKeyDown = useStepKeys();
  if (!wt) return null;

  const drawQuestion = includeQuestion || !wt.onQuestion;
  const stage = wt.view.spec.panels.filter((p) => {
    if (p.type === "vars") return false;
    // An older browser can't paint on the page's own passage, so it gets
    // the walkthrough's copy of it instead.
    if (p.type === "passage") return drawQuestion || !highlightsOk;
    if (p.type === "choices") return drawQuestion;
    return true;
  });
  const varsPanel = wt.view.spec.panels.find((p) => p.type === "vars");
  const varsState = varsPanel ? wt.states.get(panelId(varsPanel)) : undefined;
  const vars = varsState?.type === "vars" && varsState.state.entries.length > 0 ? varsState.state : null;
  if (stage.length === 0 && !vars) return null;

  const hasPassage = stage.some((p) => p.type === "passage");
  // Panels pair up when there's room. A number line is a long strip and
  // always takes the full width; of the rest, an odd one out does too rather
  // than leaving a hole.
  const halves = stage.filter((p) => p.type !== "numberline");
  const wideOf = (panel: Panel) =>
    stage.length > 1 && (panel.type === "numberline" || (halves.length % 2 === 1 && panel === halves[halves.length - 1]));

  return (
    <section
      aria-label="Walkthrough figures"
      onKeyDown={onKeyDown}
      className="@container"
      style={{ "--wt-surface": "var(--card)" } as CSSProperties}
    >
      <div className="overflow-hidden rounded-xl border border-border bg-border">
        <div className={cn("grid gap-px", stage.length > 1 && (hasPassage ? "@3xl:grid-cols-2" : "@xl:grid-cols-2"))}>
          {vars && (
            <div className="col-span-full bg-card px-4 py-3">
              <VarsChips state={vars} />
            </div>
          )}
          {stage.map((panel) => (
            <StagePanel key={panelId(panel)} panel={panel} wt={wt} wide={wideOf(panel)} />
          ))}
        </div>
      </div>
    </section>
  );
}
