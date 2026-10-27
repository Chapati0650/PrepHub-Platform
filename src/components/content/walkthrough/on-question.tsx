"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { LatexText } from "@/components/content/latex-text";
import { choicesState, passageState, useOnQuestion } from "./context";

// The walkthrough drawn on the question itself. The passage keeps its own
// text and DOM: highlights are painted with the CSS Custom Highlight API (as
// the annotator's are, and for the same reason — React and KaTeX own those
// nodes, and a student's saved highlights are character offsets into them),
// and a filled blank is an attribute on the blank LatexText already wraps.
// Answer choices are the page's own rows; useChoiceMarks says what to show
// on each, and ChoiceNote is the line of reasoning under it.

const noopSubscribe = () => () => {};

function supported(): boolean {
  return typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/**
 * Whether highlights can be painted on the page's own passage. The server
 * snapshot says yes, as every current browser does; an older one gets the
 * walkthrough's own copy of the passage after hydration instead.
 */
export function useHighlightsSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, supported, () => true);
}

type TextIndex = { nodes: { node: Text; start: number }[]; text: string };

// The passage's text as the reader sees it: maths is left out, as a quote
// never reaches into it, and KaTeX's hidden MathML copy would only add noise.
function indexText(root: HTMLElement): TextIndex {
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".katex") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push({ node: n, start: text.length });
    text += n.data;
  }
  return { nodes, text };
}

// A start offset on the boundary between two text nodes belongs to the next
// one, an end offset to the previous one, so a range never begins or ends
// on an empty edge.
function pointAt(nodes: TextIndex["nodes"], offset: number, edge: "start" | "end") {
  for (const { node, start } of nodes) {
    const end = start + node.data.length;
    if (edge === "start" ? offset >= start && offset < end : offset > start && offset <= end) return { node, offset: offset - start };
  }
  return null;
}

function rangeAt({ nodes }: TextIndex, start: number, end: number): Range | null {
  const from = pointAt(nodes, start, "start");
  const to = pointAt(nodes, end, "end");
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

const HIGHLIGHT_CSS = (id: string) => `
::highlight(wt-hl-${id}) { background-color: color-mix(in oklch, oklch(0.79 0.128 207) 38%, transparent); }
.dark ::highlight(wt-hl-${id}) { background-color: color-mix(in oklch, oklch(0.7 0.115 207) 38%, transparent); }
::highlight(wt-alt-${id}) { background-color: oklch(0.91 0.1 88 / 0.85); }
.dark ::highlight(wt-alt-${id}) { background-color: oklch(0.5 0.1 80 / 0.55); }
`;

const SWEEP_MS = 420;

/** Paints this step's highlights and filled blank on the passage inside `rootRef`. */
export function PassageMarks({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const wt = useOnQuestion();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const state = wt ? passageState(wt) : null;
  const register = wt?.registerTarget;
  const fillKey = state?.fill ? `${state.fill.text}\u0000${state.fill.verdict ?? ""}` : "";
  const highlightKey = state ? JSON.stringify([state.highlight, state.alt]) : "";

  // The filled blank, kept apart from the highlights so it doesn't flicker
  // on every step it stays the same.
  useEffect(() => {
    const blank = rootRef.current?.querySelector<HTMLElement>(".latex-blank");
    if (!blank || !fillKey) return;
    const [text, verdict] = fillKey.split("\u0000");
    blank.setAttribute("data-wt-fill", text);
    if (verdict) blank.setAttribute("data-wt-verdict", verdict);
    const unregister = register?.("passage-fill", () => blank);
    return () => {
      blank.removeAttribute("data-wt-fill");
      blank.removeAttribute("data-wt-verdict");
      unregister?.();
    };
  }, [rootRef, fillKey, register]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !highlightKey || !supported()) return;
    const [highlight, alt] = JSON.parse(highlightKey) as [string[], string[]];
    if (highlight.length + alt.length === 0) return;
    const index = indexText(root);
    const spans: { start: number; end: number; layer: Highlight }[] = [];
    const hl = new Highlight();
    const second = new Highlight();
    // Above a student's own highlights while stepping through.
    hl.priority = 2;
    second.priority = 2;
    for (const [quotes, layer] of [
      [highlight, hl],
      [alt, second],
    ] as const) {
      for (const quote of quotes) {
        const start = index.text.indexOf(quote.replace(/\\\$/g, "$"));
        if (start !== -1) spans.push({ start, end: start + quote.replace(/\\\$/g, "$").length, layer });
      }
    }
    if (spans.length === 0) return;
    CSS.highlights.set(`wt-hl-${id}`, hl);
    CSS.highlights.set(`wt-alt-${id}`, second);

    // The highlighter sweep: each range grows from its first character.
    let frame = 0;
    const paint = (progress: number) => {
      hl.clear();
      second.clear();
      for (const s of spans) {
        const range = rangeAt(index, s.start, s.start + Math.max(1, Math.round((s.end - s.start) * progress)));
        if (range) s.layer.add(range);
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) paint(1);
    else {
      const began = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - began) / SWEEP_MS);
        paint(1 - (1 - t) ** 3);
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      paint(0);
      frame = requestAnimationFrame(tick);
    }
    const first = [...spans].sort((a, b) => a.start - b.start)[0];
    const unregister = register?.("passage", () => rangeAt(index, first.start, first.end));
    return () => {
      cancelAnimationFrame(frame);
      CSS.highlights.delete(`wt-hl-${id}`);
      CSS.highlights.delete(`wt-alt-${id}`);
      unregister?.();
    };
  }, [rootRef, highlightKey, id, register]);

  return wt && state ? <style>{HIGHLIGHT_CSS(id)}</style> : null;
}

export type ChoiceMarks = {
  checking: boolean;
  ruledOut: boolean;
  /** Ruled out by the step on screen, as opposed to an earlier one. */
  ruledOutNow: boolean;
  changedNow: boolean;
  reason: string | null;
  ref: (el: HTMLElement | null) => (() => void) | undefined;
};

/** What the walkthrough says about answer choice `index` right now, or null when it isn't running on the question. */
export function useChoiceMarks(index: number): ChoiceMarks | null {
  const wt = useOnQuestion();
  const register = wt?.registerTarget;
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !register) return undefined;
      return register(`choice-${index}`, () => el);
    },
    [register, index],
  );
  if (!wt) return null;
  const state = choicesState(wt);
  if (!state) return null;
  const live = !wt.pendingPrompt;
  const changes = wt.choiceChanges;
  return {
    checking: state.focus === index,
    ruledOut: state.eliminated.includes(index),
    ruledOutNow: live && changes.eliminate.includes(index),
    changedNow:
      live && (changes.eliminate.includes(index) || changes.focus === index || (changes.reveal && wt.view.correctIndex === index)),
    reason: wt.choiceNotes[index] ?? null,
    ref,
  };
}

/** useChoiceMarks for one row of a list rendered in a loop, where a hook can't be called directly. */
export function WithChoiceMarks({ index, children }: { index: number; children: (marks: ChoiceMarks | null) => React.ReactNode }) {
  return <>{children(useChoiceMarks(index))}</>;
}

/** The tag a choice row adds while the walkthrough runs: "Checking" or "Ruled out". */
export function choiceMarkTag(marks: ChoiceMarks | null): string | null {
  if (!marks) return null;
  // A step can look at a choice and rule it out at once; the verdict wins.
  if (marks.ruledOut) return "Ruled out";
  if (marks.checking) return "Checking";
  return null;
}

/** Row classes for the walkthrough's state: a ring for the choice being checked, faded once it's ruled out, a pulse when this step changed it. */
export function choiceMarkClasses(marks: ChoiceMarks | null): string {
  if (!marks) return "";
  return cn(
    marks.checking && "ring-2 ring-primary/45 ring-offset-2 ring-offset-background",
    marks.ruledOut && !marks.checking && "opacity-60",
    marks.changedNow && "motion-safe:animate-wt-pulse",
  );
}

/**
 * The reasoning under an answer choice. A wrong answer the student picked
 * says why it's wrong straight away, with or without a walkthrough — beside
 * the choice, rather than in a box below the list. While a walkthrough runs,
 * a choice it rules out says why on the step that does it, then folds to a
 * "Why?" so the list doesn't grow a paragraph per choice.
 */
export function ChoiceNote({ marks, yourWrongNote, className }: { marks: ChoiceMarks | null; yourWrongNote: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const reason = marks?.ruledOut && !yourWrongNote ? marks.reason : null;
  if (!yourWrongNote && !reason) return null;
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      {yourWrongNote && (
        <p>
          <span className="font-semibold text-destructive">Why it&apos;s wrong: </span>
          <LatexText text={yourWrongNote} />
        </p>
      )}
      {reason &&
        (marks?.ruledOutNow || open ? (
          <p className="text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0">
            <span className="font-semibold text-foreground">Ruled out: </span>
            <LatexText text={reason} />
          </p>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="font-medium text-primary hover:underline">
            Why was this ruled out?
          </button>
        ))}
    </div>
  );
}
