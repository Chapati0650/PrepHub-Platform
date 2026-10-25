"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { readWork, sweepOldWork, writeWork } from "./local-store";

/**
 * Highlighting and notes on a reading passage or a question (2026-10-24) —
 * Bluebook's Annotate, the tool the real test gives every student.
 *
 * Select text and a small bar appears: three highlighter colours and Note.
 * Click a highlight to change its colour, write a note on it, or remove it.
 * Notes are listed under the question with the words they're attached to.
 *
 * Painted with the CSS Custom Highlight API, which colours a text range
 * without touching the DOM. That matters here: the question is rendered by
 * React and KaTeX, and wrapping its text in <mark> elements would fight both —
 * React would wipe them on the next render, and splitting KaTeX's spans
 * breaks the maths. A highlight is just a pair of character offsets into its
 * container's text, which also makes it trivially storable. Where the API is
 * missing (an old browser) the tool simply doesn't appear.
 */

export type AnnotationRoot = "passage" | "question";
type Color = "yellow" | "blue" | "pink";
type Annotation = { id: string; root: AnnotationRoot; start: number; end: number; color: Color; text: string; note?: string };
type Saved = { annotations: Annotation[] };

const COLORS: { name: Color; label: string; swatch: string }[] = [
  { name: "yellow", label: "Yellow", swatch: "bg-yellow-200 dark:bg-yellow-600" },
  { name: "blue", label: "Blue", swatch: "bg-sky-200 dark:bg-sky-700" },
  { name: "pink", label: "Pink", swatch: "bg-pink-200 dark:bg-pink-700" },
];

const NOTE_MAX = 500;

/**
 * The highlight colours, as a style element rather than in globals.css:
 * Next's CSS pipeline (Lightning CSS) doesn't yet recognise `::highlight()`
 * and warns on every compile. Browsers do. The -200 tints are stronger than
 * the -50/-100 status washes on purpose — a highlight has to read at a glance
 * on white (CLAUDE.md, light tints read faint) — and text colour is left
 * alone so contrast holds in both themes.
 */
const HIGHLIGHT_CSS = `
::highlight(prephub-yellow) { background-color: #fef08a; }
::highlight(prephub-blue) { background-color: #bae6fd; }
::highlight(prephub-pink) { background-color: #fbcfe8; }
::highlight(prephub-note) { text-decoration: underline dotted 2px; text-underline-offset: 3px; }
.dark ::highlight(prephub-yellow) { background-color: rgb(234 179 8 / 0.45); }
.dark ::highlight(prephub-blue) { background-color: rgb(14 165 233 / 0.45); }
.dark ::highlight(prephub-pink) { background-color: rgb(236 72 153 / 0.45); }
`;

export function highlightsSupported(): boolean {
  return typeof window !== "undefined" && typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/** Characters of text between the start of `root` and (node, offset). */
function offsetIn(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A live Range for stored offsets, or null if the text has changed under them. */
function rangeFor(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;
    if (!startNode && start <= seen + len) {
      startNode = node;
      startOffset = start - seen;
    }
    if (startNode && end <= seen + len) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(node, end - seen);
      return range;
    }
    seen += len;
  }
  return null;
}

/** The point under a click, as a caret position — named differently per engine. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = doc.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

type Popover =
  | { kind: "selection"; root: AnnotationRoot; start: number; end: number; text: string; x: number; y: number; below: boolean }
  | { kind: "existing"; id: string; x: number; y: number; below: boolean }
  | { kind: "note"; id: string; x: number; y: number; below: boolean };

export function Annotator({
  storageKey,
  roots,
  contentKey,
}: {
  storageKey: string;
  roots: Record<AnnotationRoot, RefObject<HTMLElement | null>>;
  /** Changes whenever the rendered question does, so highlights are re-laid on new DOM. */
  contentKey: string;
}) {
  // Keyed by question in the parent, so this reads its saved state once.
  const [annotations, setAnnotations] = useState<Annotation[]>(
    () => readWork<Saved>(`annotations:${storageKey}`)?.annotations ?? [],
  );
  const [popover, setPopover] = useState<Popover | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const persist = useCallback(
    (next: Annotation[]) => {
      setAnnotations(next);
      writeWork<Saved>(`annotations:${storageKey}`, { annotations: next });
    },
    [storageKey],
  );

  // Paint. Runs on every change and whenever the question's DOM is new;
  // ranges are rebuilt from offsets each time rather than kept, because a
  // Range pointing into DOM React has replaced quietly highlights nothing.
  useEffect(() => {
    if (!highlightsSupported()) return;
    sweepOldWork();
    const byColor: Record<Color, Range[]> = { yellow: [], blue: [], pink: [] };
    const noted: Range[] = [];
    for (const a of annotations) {
      const root = roots[a.root].current;
      const range = root ? rangeFor(root, a.start, a.end) : null;
      if (!range) continue;
      byColor[a.color].push(range);
      if (a.note) noted.push(range);
    }
    for (const c of COLORS) CSS.highlights.set(`prephub-${c.name}`, new Highlight(...byColor[c.name]));
    CSS.highlights.set("prephub-note", new Highlight(...noted));
    return () => {
      for (const c of COLORS) CSS.highlights.delete(`prephub-${c.name}`);
      CSS.highlights.delete("prephub-note");
    };
  }, [annotations, roots, contentKey]);

  // Selection and clicks, anywhere in the two roots.
  useEffect(() => {
    if (!highlightsSupported()) return;

    function rootOf(node: Node | null): AnnotationRoot | null {
      for (const name of ["passage", "question"] as const) {
        const el = roots[name].current;
        if (el && node && el.contains(node)) return name;
      }
      return null;
    }

    function onPointerUp(e: PointerEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      // Let the browser finish updating the selection first.
      window.setTimeout(() => {
        const sel = window.getSelection();
        const below = e.pointerType === "touch"; // keep clear of the phone's own selection menu
        if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const root = rootOf(range.startContainer);
          if (!root || rootOf(range.endContainer) !== root) return setPopover(null);
          const el = roots[root].current!;
          const start = offsetIn(el, range.startContainer, range.startOffset);
          const end = offsetIn(el, range.endContainer, range.endOffset);
          const text = range.toString().trim();
          if (end <= start || !text) return setPopover(null);
          const rect = range.getBoundingClientRect();
          setPopover({
            kind: "selection",
            root,
            start,
            end,
            text,
            x: rect.left + rect.width / 2,
            y: below ? rect.bottom + 8 : rect.top - 8,
            below,
          });
          return;
        }
        // A click: on a highlight, offer what can be done with it.
        const caret = caretAt(e.clientX, e.clientY);
        const root = caret ? rootOf(caret.node) : null;
        if (!caret || !root) return setPopover(null);
        const at = offsetIn(roots[root].current!, caret.node, caret.offset);
        const hit = annotations.find((a) => a.root === root && a.start <= at && at <= a.end);
        if (!hit) return setPopover(null);
        setPopover({ kind: "existing", id: hit.id, x: e.clientX, y: below ? e.clientY + 16 : e.clientY - 12, below });
      }, 0);
    }

    function dismiss() {
      setPopover(null);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null);
    }

    document.addEventListener("pointerup", onPointerUp);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [annotations, roots]);

  function addHighlight(color: Color, then?: "note") {
    if (popover?.kind !== "selection") return;
    // A new highlight replaces any it overlaps, so ranges never stack.
    const kept = annotations.filter((a) => a.root !== popover.root || a.end <= popover.start || a.start >= popover.end);
    const created: Annotation = {
      // Overlaps are removed above, so position alone is a unique id.
      id: `${popover.root}:${popover.start}:${popover.end}`,
      root: popover.root,
      start: popover.start,
      end: popover.end,
      color,
      text: popover.text.slice(0, 300),
    };
    persist([...kept, created]);
    window.getSelection()?.removeAllRanges();
    if (then === "note") {
      setNoteDraft("");
      setPopover({ kind: "note", id: created.id, x: popover.x, y: popover.y, below: popover.below });
    } else {
      setPopover(null);
    }
  }

  function recolor(id: string, color: Color) {
    persist(annotations.map((a) => (a.id === id ? { ...a, color } : a)));
    setPopover(null);
  }

  function remove(id: string) {
    persist(annotations.filter((a) => a.id !== id));
    setPopover(null);
  }

  function saveNote(id: string) {
    const note = noteDraft.trim().slice(0, NOTE_MAX);
    persist(annotations.map((a) => (a.id === id ? { ...a, note: note || undefined } : a)));
    setPopover(null);
  }

  function editNote(a: Annotation, x: number, y: number) {
    setNoteDraft(a.note ?? "");
    setPopover({ kind: "note", id: a.id, x, y, below: true });
  }

  if (!highlightsSupported()) return null;

  const notes = annotations
    .filter((a) => a.note)
    .sort((a, b) => (a.root === b.root ? a.start - b.start : a.root === "passage" ? -1 : 1));
  const existing = popover && popover.kind !== "selection" ? annotations.find((a) => a.id === popover.id) : null;

  return (
    <>
      <style>{HIGHLIGHT_CSS}</style>
      {popover && (
        <div
          ref={popoverRef}
          role="toolbar"
          aria-label="Highlight"
          style={{
            left: Math.min(Math.max(popover.x, 120), window.innerWidth - 120),
            top: popover.y,
            transform: `translate(-50%, ${popover.below ? "0" : "-100%"})`,
          }}
          className="fixed z-50 flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 shadow-lg"
          // Keeps a click on a button from collapsing the selection first —
          // but not in the note form, where it would stop the textarea taking
          // focus.
          onMouseDown={(e) => {
            if (popover.kind !== "note") e.preventDefault();
          }}
        >
          {popover.kind === "note" ? (
            <form
              className="flex w-72 flex-col gap-2 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                saveNote(popover.id);
              }}
            >
              <label htmlFor="annotation-note" className="text-xs font-medium">
                Note
              </label>
              <textarea
                id="annotation-note"
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={NOTE_MAX}
                rows={3}
                className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm"
                placeholder="e.g. author's main claim"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPopover(null)} className="rounded-full px-3 py-1 text-xs hover:bg-muted">
                  Cancel
                </button>
                <button type="submit" className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Save note
                </button>
              </div>
            </form>
          ) : (
            <>
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  aria-label={`Highlight ${c.label.toLowerCase()}`}
                  aria-pressed={existing?.color === c.name}
                  onClick={() => (popover.kind === "selection" ? addHighlight(c.name) : recolor(popover.id, c.name))}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full hover:bg-muted",
                    existing?.color === c.name && "ring-2 ring-primary",
                  )}
                >
                  <span className={cn("size-4 rounded-full border border-foreground/20", c.swatch)} />
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              <button
                type="button"
                onClick={() =>
                  popover.kind === "selection"
                    ? addHighlight("yellow", "note")
                    : existing && editNote(existing, popover.x, popover.y)
                }
                className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium hover:bg-muted"
              >
                <StickyNote className="size-3.5" aria-hidden />
                {existing?.note ? "Edit note" : "Note"}
              </button>
              {popover.kind === "existing" && (
                <button
                  type="button"
                  aria-label="Remove highlight"
                  onClick={() => remove(popover.id)}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <section aria-label="Your notes" className="mt-8 flex flex-col gap-2">
          <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your notes</h2>
          <ul className="divide-y divide-border border-y border-border">
            {notes.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", COLORS.find((c) => c.name === a.color)?.swatch)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-muted-foreground">&ldquo;{a.text}&rdquo;</span>
                  <span className="block whitespace-pre-line">{a.note}</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    editNote(a, r.left, r.bottom + 6);
                  }}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => persist(annotations.map((x) => (x.id === a.id ? { ...x, note: undefined } : x)))}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
