"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { LatexText } from "@/components/content/latex-text";
import {
  markPassage,
  WORK_TEX_MACROS,
  workTexTrust,
  type ChoicesState,
  type Panel,
  type PassageState,
  type TableState,
  type VarsState,
  type WorkState,
} from "@/lib/content/walkthrough";

// The walkthrough's text panels. The passage and the choices are the
// question's own, re-drawn with this step's highlights; nothing a student
// reads here differs from what they answered.

const LETTERS = ["A", "B", "C", "D", "E"];

export function PanelFrame({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-background p-3", className)}>
      {label && <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>}
      {children}
    </div>
  );
}

export function PassagePanel({ source, state, stepKey }: { source: string; state: PassageState; stepKey: number }) {
  const scroller = useRef<HTMLDivElement>(null);

  // Bring this step's highlight into view inside the passage box only. The
  // element's own scrollIntoView would also scroll the page, which jumps the
  // student away from the controls they just pressed.
  useEffect(() => {
    const box = scroller.current;
    const mark = box?.querySelector<HTMLElement>(".wt-hl, .wt-alt, .wt-fill");
    if (!box || !mark) return;
    const top = mark.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const target = Math.max(0, top - box.clientHeight / 3);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: target, behavior: reduce ? "auto" : "smooth" });
  }, [stepKey]);

  return (
    <PanelFrame label="Passage">
      <div ref={scroller} className="max-h-72 overflow-y-auto pr-1 text-[0.95rem] leading-relaxed @3xl:max-h-[26rem]">
        <LatexText text={markPassage(source, state)} />
      </div>
    </PanelFrame>
  );
}

export function ChoicesPanel({ choices, correctIndex, state }: { choices: string[]; correctIndex: number | null; state: ChoicesState }) {
  return (
    <PanelFrame label="Answer choices">
      <ol className="flex flex-col gap-2">
        {choices.map((text, i) => {
          const out = state.eliminated.includes(i);
          const correct = state.revealed && i === correctIndex;
          const focused = state.focus === i;
          return (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2.5 rounded-md border p-2 text-sm transition-colors duration-300",
                correct
                  ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50"
                  : focused
                    ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                    : "border-border",
                out && !focused && "opacity-55",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  correct ? "border-green-700 bg-green-700 text-white dark:border-green-400 dark:bg-green-500 dark:text-green-950" : "border-foreground/40",
                  out && "line-through",
                )}
                aria-hidden
              >
                {LETTERS[i]}
              </span>
              <span className={cn("min-w-0 flex-1", out && "line-through decoration-foreground/50")}>
                <span className="sr-only">Choice {LETTERS[i]}: </span>
                <LatexText text={text} />
              </span>
              {/* Words, not only colour and a strike-through (WCAG 1.4.1). */}
              {correct ? (
                <span className="shrink-0 text-xs font-semibold text-green-800 dark:text-green-300">Correct answer</span>
              ) : out ? (
                <span className="shrink-0 text-xs text-muted-foreground">Ruled out</span>
              ) : focused ? (
                <span className="shrink-0 text-xs font-medium text-primary">Checking</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </PanelFrame>
  );
}

function renderWorkTex(tex: string): string {
  return katex.renderToString(tex, {
    displayMode: true,
    throwOnError: false,
    strict: "ignore",
    macros: { ...WORK_TEX_MACROS },
    trust: workTexTrust,
    output: "htmlAndMathml",
  });
}

export function WorkPanel({ title, state }: { title?: string; state: WorkState }) {
  const end = useRef<HTMLDivElement>(null);
  const count = state.lines.length;
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count]);

  return (
    <PanelFrame label={title ?? "Working"}>
      {count === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">The working builds up here, one step at a time.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <ol className="flex flex-col">
            {state.lines.map((line, i) => (
              <li
                key={i}
                className={cn(
                  "overflow-x-auto border-l-2 px-2 transition-colors duration-300 [&_.katex-display]:my-1.5",
                  line.isNew ? "border-primary text-foreground motion-safe:animate-in motion-safe:fade-in-0" : "wt-work-old border-transparent text-muted-foreground",
                )}
                dangerouslySetInnerHTML={{ __html: renderWorkTex(line.tex) }}
              />
            ))}
          </ol>
          <div ref={end} />
        </div>
      )}
    </PanelFrame>
  );
}

export function VarsChips({ state }: { state: VarsState }) {
  if (state.entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Known so far">
      {state.entries.map((entry) => (
        <li
          key={entry.name}
          className={cn(
            "min-w-14 rounded-md border px-2.5 py-1.5 transition-colors duration-300",
            entry.changed ? "border-primary bg-primary/8 ring-1 ring-primary/30" : "border-border bg-background",
          )}
        >
          <p className="text-[0.7rem] text-muted-foreground">
            <LatexText text={entry.name} />
          </p>
          <p className="text-base font-semibold tabular-nums">
            <LatexText text={entry.value} />
          </p>
        </li>
      ))}
    </ul>
  );
}

export function TablePanel({ panel, state }: { panel: Extract<Panel, { type: "table" }>; state: TableState }) {
  const lit = (r: number, c: number) =>
    state.rows.includes(r) || state.cols.includes(c) || state.cells.some(([cr, cc]) => cr === r && cc === c);
  const any = state.rows.length + state.cols.length + state.cells.length > 0;
  return (
    <PanelFrame label={panel.title ? undefined : "Table"}>
      {panel.title && <p className="mb-2 text-center text-sm font-medium">{panel.title}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {panel.header.map((h, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn("border border-border px-2 py-1.5 text-left font-semibold", state.cols.includes(c) && "bg-primary/12")}
                >
                  <LatexText text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "border border-border px-2 py-1.5 tabular-nums transition-colors duration-300",
                      lit(r, c) ? "bg-primary/12 font-semibold" : any && "text-muted-foreground",
                    )}
                  >
                    <LatexText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelFrame>
  );
}
