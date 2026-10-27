import { z } from "zod";
import { MARK } from "./passage-marks";

// A walkthrough is the animated form of a question's explanation: one stage
// of panels (the passage, the answer choices, the working, a graph, a
// diagram, a table…) and, for each explanation step, what changes on it.
// The step's own text is the narration, so a walkthrough always has exactly
// as many steps as the explanation; if the two ever disagree (an Owner edits
// the steps), the explanation falls back to the plain list.
//
// It is data, not code. It is written once when a question is added, stored
// on the revision, and drawn by the site's own components, so nothing is
// generated per student and nothing written by a model runs in a student's
// browser. This module is pure (no KaTeX, no Prisma) because the client
// imports it; walkthrough-validate.ts holds the checks that need more.

export const WALKTHROUGH_VERSION = 1;

const Id = z.string().regex(/^[a-zA-Z][\w-]*$/, "ids are letters, digits, - and _");
const Point = z.tuple([z.number(), z.number()]);

const PlaneElement = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point"), id: Id, at: Point, label: z.string().optional(), hidden: z.boolean().optional() }),
  z.object({
    kind: z.literal("line"),
    id: Id,
    through: z.tuple([Point, Point]),
    label: z.string().optional(),
    dashed: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("segment"),
    id: Id,
    from: Point,
    to: Point,
    label: z.string().optional(),
    dashed: z.boolean().optional(),
    arrow: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("curve"),
    id: Id,
    points: z.array(Point).min(2),
    label: z.string().optional(),
    dashed: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("region"), id: Id, points: z.array(Point).min(3), hidden: z.boolean().optional() }),
  z.object({ kind: z.literal("label"), id: Id, at: Point, text: z.string().min(1), hidden: z.boolean().optional() }),
]);

const Compass = z.enum(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

const DiagramElement = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    id: Id,
    at: Point,
    label: z.string().optional(),
    labelAt: Compass.optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("segment"),
    id: Id,
    from: Point,
    to: Point,
    label: z.string().optional(),
    dashed: z.boolean().optional(),
    arrow: z.enum(["end", "both"]).optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("polygon"), id: Id, points: z.array(Point).min(3), filled: z.boolean().optional(), hidden: z.boolean().optional() }),
  z.object({
    kind: z.literal("circle"),
    id: Id,
    center: Point,
    r: z.number().positive(),
    filled: z.boolean().optional(),
    // Painted with the page background, so a circle drawn over a filled one
    // reads as a hole: the inside of a pipe, a washer, a ring.
    cutout: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("angle"),
    id: Id,
    vertex: Point,
    from: Point,
    to: Point,
    label: z.string().optional(),
    radius: z.number().positive().optional(),
    right: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("label"), id: Id, at: Point, text: z.string().min(1), hidden: z.boolean().optional() }),
]);

const NumberLineElement = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point"), id: Id, at: z.number(), open: z.boolean().optional(), label: z.string().optional(), hidden: z.boolean().optional() }),
  z.object({
    kind: z.literal("interval"),
    id: Id,
    // null runs off that end of the line: x > 3 is { from: 3, to: null }.
    from: z.number().nullable(),
    to: z.number().nullable(),
    openFrom: z.boolean().optional(),
    openTo: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("label"), id: Id, at: z.number(), text: z.string().min(1), hidden: z.boolean().optional() }),
]);

const Range = z.tuple([z.number(), z.number()]).refine(([a, b]) => b > a, "a range is [low, high]");

export const PanelSchema = z.discriminatedUnion("type", [
  // The question's own passage and choices: never copied into the walkthrough.
  z.object({ type: z.literal("passage"), id: Id.optional() }),
  z.object({ type: z.literal("choices"), id: Id.optional() }),
  z.object({ type: z.literal("work"), id: Id.optional(), title: z.string().optional() }),
  z.object({ type: z.literal("vars"), id: Id.optional() }),
  z.object({
    type: z.literal("plane"),
    id: Id.optional(),
    x: Range,
    y: Range,
    tick: z.number().positive().optional(),
    labelEvery: z.number().positive().optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
    elements: z.array(PlaneElement),
  }),
  z.object({
    type: z.literal("diagram"),
    id: Id.optional(),
    width: z.number().positive(),
    height: z.number().positive(),
    elements: z.array(DiagramElement),
  }),
  z.object({
    type: z.literal("numberline"),
    id: Id.optional(),
    min: z.number(),
    max: z.number(),
    tick: z.number().positive().optional(),
    elements: z.array(NumberLineElement),
  }),
  z.object({
    type: z.literal("table"),
    id: Id.optional(),
    title: z.string().optional(),
    header: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({
    type: z.literal("bars"),
    id: Id.optional(),
    title: z.string().optional(),
    categories: z.array(z.string()).min(1),
    // `shade` matches a series to the source figure's own colours when an
    // explanation refers to them ("Ecuador is the gray bar").
    series: z
      .array(z.object({ name: z.string(), values: z.array(z.number()), shade: z.enum(["light", "mid", "dark", "brand"]).optional() }))
      .min(1),
    yMax: z.number().positive().optional(),
    yLabel: z.string().optional(),
  }),
]);

// What one step changes on each panel, keyed by panel id. Highlights and
// focus last for that step only; eliminations, added working, shown
// elements and set values carry forward to later steps.
export const PassageStepSchema = z.object({
  highlight: z.array(z.string().min(1)).optional(),
  alt: z.array(z.string().min(1)).optional(),
  fill: z.object({ text: z.string().min(1), verdict: z.enum(["right", "wrong"]).optional() }).nullable().optional(),
});
export const ChoicesStepSchema = z.object({
  focus: z.number().int().min(0).optional(),
  eliminate: z.array(z.number().int().min(0)).optional(),
  reveal: z.literal(true).optional(),
});
export const WorkStepSchema = z.object({ add: z.array(z.string().min(1)).optional(), clear: z.literal(true).optional() });
export const VarsStepSchema = z.record(z.string().min(1), z.string().nullable());
export const ElementsStepSchema = z.object({
  show: z.array(Id).optional(),
  hide: z.array(Id).optional(),
  focus: z.array(Id).optional(),
});
export const TableStepSchema = z.object({
  rows: z.array(z.number().int().min(0)).optional(),
  cols: z.array(z.number().int().min(0)).optional(),
  cells: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).optional(),
});
export const BarsStepSchema = z.object({
  // A number is a whole category; [series, category] is one bar.
  focus: z.array(z.union([z.number().int().min(0), z.tuple([z.number().int().min(0), z.number().int().min(0)])])).optional(),
});

export const WalkthroughSchema = z.object({
  version: z.literal(WALKTHROUGH_VERSION),
  panels: z.array(PanelSchema).min(1).max(5),
  steps: z.array(z.record(z.string(), z.unknown())).min(1),
});

export type Walkthrough = z.infer<typeof WalkthroughSchema>;
export type Panel = z.infer<typeof PanelSchema>;
export type PanelType = Panel["type"];
export type PlaneElementData = z.infer<typeof PlaneElement>;
export type DiagramElementData = z.infer<typeof DiagramElement>;
export type NumberLineElementData = z.infer<typeof NumberLineElement>;

/** A panel's id defaults to its type, so a walkthrough with one of each can just say "passage", "work"… */
export function panelId(panel: Panel): string {
  return panel.id ?? panel.type;
}

/** Everything a walkthrough is drawn with: the spec and the question's own text. */
export type WalkthroughView = {
  spec: Walkthrough;
  passageText: string | null;
  choices: string[];
  correctIndex: number | null;
};

// ---------------------------------------------------------------------------
// State at a step

export type PassageState = { highlight: string[]; alt: string[]; fill: { text: string; verdict?: "right" | "wrong" } | null };
export type ChoicesState = { focus: number | null; eliminated: number[]; revealed: boolean };
export type WorkState = { lines: { tex: string; isNew: boolean }[] };
export type VarsState = { entries: { name: string; value: string; changed: boolean }[] };
export type ElementsState = { visible: Set<string>; focus: Set<string>; appeared: Set<string> };
export type TableState = { rows: number[]; cols: number[]; cells: [number, number][] };
export type BarsState = { focus: (number | [number, number])[] };

export type PanelState =
  | { type: "passage"; state: PassageState }
  | { type: "choices"; state: ChoicesState }
  | { type: "work"; state: WorkState }
  | { type: "vars"; state: VarsState }
  | { type: "plane" | "diagram" | "numberline"; state: ElementsState }
  | { type: "table"; state: TableState }
  | { type: "bars"; state: BarsState };

function elementsOf(panel: Panel): { id: string; hidden?: boolean }[] {
  if (panel.type === "plane" || panel.type === "diagram" || panel.type === "numberline") return panel.elements;
  return [];
}

/**
 * Replays steps 0…index and returns each panel's state at that step, keyed
 * by panel id. Malformed step entries are ignored rather than thrown on: the
 * validator is where a bad walkthrough is refused, and a student should
 * still get the rest of it.
 */
export function stateAt(spec: Walkthrough, index: number): Map<string, PanelState> {
  const last = Math.max(0, Math.min(index, spec.steps.length - 1));
  const out = new Map<string, PanelState>();

  for (const panel of spec.panels) {
    const id = panelId(panel);
    const entries = spec.steps.slice(0, last + 1).map((step) => step[id]);
    const current = entries[last];

    switch (panel.type) {
      case "passage": {
        let fill: PassageState["fill"] = null;
        for (const entry of entries) {
          const parsed = PassageStepSchema.safeParse(entry ?? {});
          if (parsed.success && parsed.data.fill !== undefined) fill = parsed.data.fill;
        }
        const now = PassageStepSchema.safeParse(current ?? {});
        out.set(id, {
          type: "passage",
          state: { highlight: now.success ? (now.data.highlight ?? []) : [], alt: now.success ? (now.data.alt ?? []) : [], fill },
        });
        break;
      }
      case "choices": {
        const eliminated = new Set<number>();
        let revealed = false;
        for (const entry of entries) {
          const parsed = ChoicesStepSchema.safeParse(entry ?? {});
          if (!parsed.success) continue;
          for (const i of parsed.data.eliminate ?? []) eliminated.add(i);
          if (parsed.data.reveal) revealed = true;
        }
        const now = ChoicesStepSchema.safeParse(current ?? {});
        out.set(id, {
          type: "choices",
          state: { focus: now.success ? (now.data.focus ?? null) : null, eliminated: [...eliminated].sort(), revealed },
        });
        break;
      }
      case "work": {
        let lines: { tex: string; isNew: boolean }[] = [];
        entries.forEach((entry, i) => {
          const parsed = WorkStepSchema.safeParse(entry ?? {});
          if (!parsed.success) return;
          if (parsed.data.clear) lines = [];
          lines = lines.map((l) => ({ ...l, isNew: false }));
          for (const tex of parsed.data.add ?? []) lines.push({ tex, isNew: i === last });
        });
        out.set(id, { type: "work", state: { lines } });
        break;
      }
      case "vars": {
        const values = new Map<string, string>();
        let changed = new Set<string>();
        entries.forEach((entry, i) => {
          const parsed = VarsStepSchema.safeParse(entry ?? {});
          if (!parsed.success) return;
          if (i === last) changed = new Set(Object.keys(parsed.data));
          for (const [name, value] of Object.entries(parsed.data)) {
            if (value === null) values.delete(name);
            else values.set(name, value);
          }
        });
        out.set(id, {
          type: "vars",
          state: { entries: [...values].map(([name, value]) => ({ name, value, changed: changed.has(name) })) },
        });
        break;
      }
      case "plane":
      case "diagram":
      case "numberline": {
        const visible = new Set(elementsOf(panel).filter((e) => !e.hidden).map((e) => e.id));
        let appeared = new Set<string>();
        entries.forEach((entry, i) => {
          const parsed = ElementsStepSchema.safeParse(entry ?? {});
          if (!parsed.success) return;
          for (const e of parsed.data.show ?? []) {
            if (i === last && !visible.has(e)) appeared.add(e);
            visible.add(e);
          }
          for (const e of parsed.data.hide ?? []) visible.delete(e);
        });
        appeared = new Set([...appeared].filter((e) => visible.has(e)));
        const now = ElementsStepSchema.safeParse(current ?? {});
        out.set(id, {
          type: panel.type,
          state: { visible, appeared, focus: new Set(now.success ? (now.data.focus ?? []) : []) },
        });
        break;
      }
      case "table": {
        const now = TableStepSchema.safeParse(current ?? {});
        out.set(id, {
          type: "table",
          state: now.success ? { rows: now.data.rows ?? [], cols: now.data.cols ?? [], cells: now.data.cells ?? [] } : { rows: [], cols: [], cells: [] },
        });
        break;
      }
      case "bars": {
        const now = BarsStepSchema.safeParse(current ?? {});
        out.set(id, { type: "bars", state: { focus: now.success ? (now.data.focus ?? []) : [] } });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Marking up the passage

export { MARK };

export const BLANK = /_{3,}/;

/**
 * Ranges of the passage's source text that are plain prose — outside math,
 * and either outside an underline or wholly inside one. A highlight must sit
 * inside one of these, or its markers would straddle a math or underline
 * delimiter and break the rendering.
 */
export function proseRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  const pattern = /\$\$[^$]+\$\$|\$[^$]+\$|\[\[[^\]]+\]\]/g;
  // Money (\$) is not a math delimiter, as in latex-text.tsx. Two placeholder
  // characters for its two keep every index lined up with the source.
  const scannable = source.replace(/\\\$/g, "\u0000\u0000");
  let cursor = 0;
  for (const match of scannable.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) ranges.push([cursor, start]);
    if (match[0].startsWith("[[")) ranges.push([start + 2, start + match[0].length - 2]);
    cursor = start + match[0].length;
  }
  if (cursor < source.length) ranges.push([cursor, source.length]);
  return ranges;
}

/** Where a quote can be highlighted in the source text, or null if it can't be. */
export function locateQuote(source: string, quote: string): [number, number] | null {
  const ranges = proseRanges(source);
  let from = source.indexOf(quote);
  while (from !== -1) {
    const end = from + quote.length;
    if (ranges.some(([a, b]) => from >= a && end <= b)) return [from, end];
    from = source.indexOf(quote, from + 1);
  }
  return null;
}

/**
 * The passage's source with this step's highlights and filled blank marked.
 * Quotes that can't be placed are skipped (the validator reports them);
 * overlapping quotes keep the first.
 */
export function markPassage(source: string, state: PassageState): string {
  const marks: { start: number; end: number; open: string; close: string }[] = [];
  const add = (quote: string, [open, close]: readonly [string, string]) => {
    const at = locateQuote(source, quote);
    if (!at) return;
    if (marks.some((m) => at[0] < m.end && at[1] > m.start)) return;
    marks.push({ start: at[0], end: at[1], open, close });
  };
  for (const q of state.highlight) add(q, MARK.hl);
  for (const q of state.alt) add(q, MARK.alt);

  let text = source;
  for (const m of [...marks].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, m.start) + m.open + text.slice(m.start, m.end) + m.close + text.slice(m.end);
  }
  if (state.fill) {
    const [open, close] = state.fill.verdict === "right" ? MARK.fillRight : state.fill.verdict === "wrong" ? MARK.fillWrong : MARK.fill;
    const filled = `${open}${state.fill.text}${close}`;
    // A function replacement, so a "$" in the text is never read as a pattern.
    text = text.replace(BLANK, () => filled);
  }
  return text;
}

// KaTeX settings for the working panel. \hl{…} and \hlalt{…} mark what a step
// changed; they become classes (themed in globals.css) rather than literal
// colours, so they follow light and dark mode. \cancel{…} is KaTeX's own.
export const WORK_TEX_MACROS: Record<string, string> = {
  "\\hl": "\\htmlClass{wt-tex-hl}{#1}",
  "\\hlalt": "\\htmlClass{wt-tex-alt}{#1}",
};

export function workTexTrust(context: { command: string }): boolean {
  return context.command === "\\htmlClass";
}
