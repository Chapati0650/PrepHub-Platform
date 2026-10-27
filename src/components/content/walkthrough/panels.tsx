"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import { cn } from "@/lib/utils";
import { LatexText } from "@/components/content/latex-text";
import {
  markPassage,
  splitAtRelation,
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
// question's own, re-drawn with this step's marks — used only where the
// question isn't on the page beside the walkthrough (the full-screen view,
// the editor's preview). Panels have no box of their own: the stage is one
// box, and the panels in it are separated by rules.

const LETTERS = ["A", "B", "C", "D", "E"];

export function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>;
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
    <div>
      <PanelLabel>Passage</PanelLabel>
      <div ref={scroller} className="max-h-72 overflow-y-auto pr-1 text-[0.95rem] leading-relaxed @3xl:max-h-[26rem]">
        <LatexText text={markPassage(source, state)} />
      </div>
    </div>
  );
}

export function ChoicesPanel({
  choices,
  correctIndex,
  state,
  studentIndex,
  notes,
  changedNow,
}: {
  choices: string[];
  correctIndex: number | null;
  state: ChoicesState;
  studentIndex: number | null;
  notes: (string | null)[];
  /** Choices this step changed, so the eye is drawn to them. */
  changedNow: number[];
}) {
  return (
    <div>
      <PanelLabel>Answer choices</PanelLabel>
      <ol className="flex flex-col gap-2">
        {choices.map((text, i) => {
          const out = state.eliminated.includes(i);
          const correct = state.revealed && i === correctIndex;
          const focused = state.focus === i;
          const yours = studentIndex === i;
          const changed = changedNow.includes(i);
          // Words, not only colour and a strike-through (WCAG 1.4.1).
          const tag = correct ? (yours ? "Your answer · Correct" : "Correct answer") : out ? (yours ? "Your answer · Ruled out" : "Ruled out") : focused ? "Checking" : yours ? "Your answer" : null;
          return (
            <li
              key={i}
              className={cn(
                "rounded-md border p-2 text-sm transition-colors duration-300",
                correct
                  ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50"
                  : focused
                    ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                    : yours
                      ? "border-destructive/60"
                      : "border-border",
                out && !focused && "opacity-60",
                changed && "motion-safe:animate-wt-pulse",
              )}
            >
              <div className="flex items-start gap-2.5">
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
                {tag && (
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      correct ? "font-semibold text-green-800 dark:text-green-300" : focused ? "font-medium text-primary" : yours ? "font-medium text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {tag}
                  </span>
                )}
              </div>
              {out && changed && notes[i] && (
                <p className="mt-1.5 pl-8 text-muted-foreground">
                  <span className="font-semibold text-foreground">Ruled out: </span>
                  <LatexText text={notes[i]!} />
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function renderTex(tex: string): string {
  // Every line is set in display style, inline, so a line split into three
  // cells keeps full-size fractions in each.
  return katex.renderToString(`\\displaystyle ${tex}`, {
    displayMode: false,
    throwOnError: false,
    strict: "ignore",
    macros: { ...WORK_TEX_MACROS },
    trust: workTexTrust,
    output: "htmlAndMathml",
  });
}

/**
 * The working, built up a line per step. When every line has a relation
 * (=, <, ≈ …) the lines are set in three columns and line up on it, the way
 * working is written on paper; otherwise they're left-aligned. The line this
 * step added sits on a soft band; earlier lines are history, in muted ink.
 * The whole chain stays in view — no inner scroll — so the last step shows
 * every line that led to the answer.
 */
const WORK_FONT_REM = 1.05;
/** The smallest the working shrinks to before it scrolls sideways instead. */
const WORK_MIN_SCALE = 0.7;

export function WorkPanel({ title, state }: { title?: string; state: WorkState }) {
  const lines = state.lines.map((line) => ({ ...line, parts: splitAtRelation(line.tex) }));
  const aligned = lines.length > 0 && lines.every((l) => l.parts);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const linesKey = state.lines.map((l) => l.tex).join("\n");

  // Working wider than its panel is shrunk to fit (KaTeX sizes in em, so the
  // font size scales everything), down to WORK_MIN_SCALE; only past that does
  // it scroll sideways. Every step starts at the left edge, where each line
  // says what it is about (R =, V =), never scrolled past it.
  useEffect(() => {
    const outer = box.current;
    const inner = list.current;
    if (!outer || !inner) return;
    const fit = () => {
      inner.style.fontSize = "";
      const natural = inner.scrollWidth;
      const room = outer.clientWidth;
      const scale = natural > room ? Math.max(WORK_MIN_SCALE, room / natural) : 1;
      inner.style.fontSize = scale < 1 ? `${WORK_FONT_REM * scale}rem` : "";
      outer.scrollLeft = 0;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    // Refit when the panel's width changes; its height follows the fit, and
    // reacting to that would only refit to the same size.
    let width = outer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (outer.clientWidth === width) return;
      width = outer.clientWidth;
      fit();
    });
    observer.observe(outer);
    return () => observer.disconnect();
  }, [linesKey]);

  return (
    <div>
      <PanelLabel>{title ?? "Working"}</PanelLabel>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">The working builds up here, one step at a time.</p>
      ) : (
        <div ref={box} className="overflow-x-auto">
          <ol ref={list} className={cn("mx-auto grid w-fit gap-y-1 text-[1.05rem]", aligned ? "grid-cols-[auto_auto_auto]" : "grid-cols-1")}>
            {lines.map((line, i) => {
              // A line of working never wraps (an expression broken after
              // "132 ×" reads as two lines); a long one scrolls sideways.
              const rowClass = cn(
                "rounded-md px-3 py-1.5 whitespace-nowrap transition-colors duration-500",
                line.isNew ? "bg-primary/8 text-foreground motion-safe:animate-in motion-safe:fade-in-0" : "wt-work-old text-muted-foreground",
              );
              return aligned && line.parts ? (
                <li key={i} className={cn("col-span-3 grid grid-cols-subgrid items-baseline", rowClass)}>
                  <span className="text-right" dangerouslySetInnerHTML={{ __html: renderTex(line.parts[0]) }} />
                  <span className="px-2 text-center" dangerouslySetInnerHTML={{ __html: renderTex(line.parts[1]) }} />
                  <span className="text-left" dangerouslySetInnerHTML={{ __html: renderTex(line.parts[2]) }} />
                </li>
              ) : (
                <li key={i} className={rowClass} dangerouslySetInnerHTML={{ __html: renderTex(line.tex) }} />
              );
            })}
          </ol>
        </div>
      )}
    </div>
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
    <div>
      {panel.title ? <p className="mb-2 text-center text-sm font-medium">{panel.title}</p> : <PanelLabel>Table</PanelLabel>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {panel.header.map((h, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn("border-b-2 border-border px-2 py-1.5 text-left font-semibold", state.cols.includes(c) && "bg-primary/12")}
                >
                  <LatexText text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {panel.rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-b-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-2 py-1.5 tabular-nums transition-colors duration-300",
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
    </div>
  );
}
