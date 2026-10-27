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
  // A set of numbers, drawn as a thick stretch of the line: the solutions of
  // an inequality. Never a distance: a bar from -38 to 38 reads as |x| <= 38.
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
  // A distance, drawn as a dimension line above the numbers with an arrow at
  // each end and its length written over it.
  z.object({ kind: z.literal("span"), id: Id, from: z.number(), to: z.number(), label: z.string().optional(), hidden: z.boolean().optional() }),
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

// "Your turn": before a step is shown, the student is asked to do it. The
// stage holds the previous step's state until they answer (or ask to be
// shown), and the step's own narration then explains it. `options` is a list
// of short answers, or "choices" for the question's own answer choices
// ("Which choice can you rule out now?"); any index in `answer` counts.
export const PromptSchema = z.object({
  step: z.number().int().min(1),
  ask: z.string().min(1).max(200),
  options: z.union([z.array(z.string().min(1).max(120)).min(2).max(5), z.literal("choices")]),
  answer: z.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)]),
  hint: z.string().min(1).max(200).optional(),
});

export const WalkthroughSchema = z.object({
  version: z.literal(WALKTHROUGH_VERSION),
  panels: z.array(PanelSchema).min(1).max(5),
  steps: z.array(z.record(z.string(), z.unknown())).min(1),
  prompts: z.array(PromptSchema).optional(),
  // The one thing to carry to the next question: a rule, not a recap of this
  // one ("Two complete sentences can't be joined by a comma alone").
  takeaway: z.string().min(1).max(240).optional(),
});

export type Prompt = z.infer<typeof PromptSchema>;

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
 * by panel id. An index of -1 is the stage before the first step, which is
 * what a "your turn" question on step 1 is asked over. Malformed step
 * entries are ignored rather than thrown on: the validator is where a bad
 * walkthrough is refused, and a student should still get the rest of it.
 */
export function stateAt(spec: Walkthrough, index: number): Map<string, PanelState> {
  const last = Math.max(-1, Math.min(index, spec.steps.length - 1));
  const out = new Map<string, PanelState>();

  for (const panel of spec.panels) {
    const id = panelId(panel);
    const entries = spec.steps.slice(0, last + 1).map((step) => step[id]);
    const current = last >= 0 ? entries[last] : undefined;

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

/** True when a step entry would change its panel; an empty object or a missing key changes nothing. */
function changes(entry: unknown): boolean {
  return !!entry && typeof entry === "object" && Object.keys(entry).length > 0;
}

/** The panels a step changes, so the stage can point at them. */
export function changedPanelsAt(spec: Walkthrough, index: number): Set<string> {
  const step = spec.steps[index];
  if (!step) return new Set();
  return new Set(spec.panels.map(panelId).filter((id) => changes(step[id])));
}

/** The "your turn" question asked before step `index` (0-based), if there is one. */
export function promptAt(spec: Walkthrough, index: number): Prompt | null {
  return spec.prompts?.find((p) => p.step === index + 1) ?? null;
}

/** Every index a prompt accepts. */
export function promptAnswers(prompt: Prompt): number[] {
  return typeof prompt.answer === "number" ? [prompt.answer] : prompt.answer;
}

/**
 * What a step does to the answer choices, in words a caption can carry when
 * the choices themselves are scrolled out of sight.
 */
export function choiceChangesAt(spec: Walkthrough, index: number): { focus: number | null; eliminate: number[]; reveal: boolean } {
  const none = { focus: null, eliminate: [], reveal: false };
  const panel = spec.panels.find((p) => p.type === "choices");
  if (!panel) return none;
  const parsed = ChoicesStepSchema.safeParse(spec.steps[index]?.[panelId(panel)] ?? {});
  if (!parsed.success) return none;
  return { focus: parsed.data.focus ?? null, eliminate: parsed.data.eliminate ?? [], reveal: !!parsed.data.reveal };
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

const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordChar = (ch: string | undefined) => !!ch && WORD_CHAR.test(ch);

/**
 * True when [start, end) begins and ends on whole words. A highlight that
 * stops at "world" in "world's" looks like a mistake, so quotes must not.
 */
export function onWordBoundaries(source: string, start: number, end: number): boolean {
  if (isWordChar(source[start]) && isWordChar(source[start - 1])) return false;
  if (isWordChar(source[end - 1]) && isWordChar(source[end])) return false;
  // An apostrophe followed by a letter carries the word on: world's.
  if (isWordChar(source[end - 1]) && /['’]/.test(source[end] ?? "") && isWordChar(source[end + 1])) return false;
  return true;
}

// Matching a quote against a step's narration ignores case and the shape of
// apostrophes and quotation marks, which differ between a typeset passage and
// typed narration. Every replacement is one character for one, so indices in
// the folded text are indices in the original.
function fold(text: string): string {
  return [...text].map((ch) => (/[’‘]/.test(ch) ? "'" : /[“”]/.test(ch) ? '"' : ch.length === ch.toLowerCase().length ? ch.toLowerCase() : ch)).join("");
}

const STOPWORDS = new Set(
  "a an and are as at be but by for from had has have in is it its not of on or that the this to was were with".split(" "),
);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The step's narration with the words it shares with this step's passage
 * highlights marked in the same colours, so "few economists would have
 * predicted" in the caption is visibly the phrase lit in the passage. A
 * highlight is matched by its longest run of whole words (two or more, at
 * least one of them more than filler) that the narration also says; a
 * one-word highlight by that word. Narration that paraphrases is left alone.
 */
export function markNarration(text: string, highlight: string[], alt: string[]): string {
  const ranges = proseRanges(text);
  const folded = fold(text);
  const marks: { start: number; end: number; open: string; close: string }[] = [];

  const place = (quote: string, [open, close]: readonly [string, string]) => {
    // A word may carry inner punctuation: 1,200, one-fifth, world's.
    const words = fold(quote).match(/[\p{L}\p{N}](?:[\p{L}\p{N}',.-]*[\p{L}\p{N}])?/gu) ?? [];
    const minimum = words.length === 1 ? 1 : 2;
    for (let size = words.length; size >= minimum; size--) {
      for (let from = 0; from + size <= words.length; from++) {
        const window = words.slice(from, from + size);
        if (!window.some((w) => w.length > 3 && !STOPWORDS.has(w))) continue;
        // Between words, any run of spaces and punctuation: the passage's
        // "classroom, for instance" is the narration's "classroom, for instance".
        const pattern = new RegExp(
          `(?<![\\p{L}\\p{N}])${window.map(escapeRegex).join("[^\\p{L}\\p{N}$]+")}(?![\\p{L}\\p{N}])(?!'\\p{L})`,
          "gu",
        );
        for (const match of folded.matchAll(pattern)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          if (!ranges.some(([a, b]) => start >= a && end <= b)) continue;
          if (marks.some((m) => start < m.end && end > m.start)) continue;
          marks.push({ start, end, open, close });
          return;
        }
      }
    }
  };
  for (const quote of highlight) place(quote, MARK.hl);
  for (const quote of alt) place(quote, MARK.alt);

  let out = text;
  for (const m of [...marks].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, m.start) + m.open + out.slice(m.start, m.end) + m.close + out.slice(m.end);
  }
  return out;
}

const RELATIONS = new Set(["\\le", "\\leq", "\\ge", "\\geq", "\\ne", "\\neq", "\\approx", "\\lt", "\\gt", "\\equiv"]);

/**
 * A line of working split at its first top-level relation (=, <, >, \le …),
 * so a column of lines can be lined up on it. Null when the line has none,
 * or the relation is inside braces or \left…\right, or a side is empty.
 */
export function splitAtRelation(tex: string): [string, string, string] | null {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "\\") {
      const command = tex.slice(i).match(/^\\[a-zA-Z]+/)?.[0];
      if (!command) {
        i += 1; // an escaped character: \{, \$, \,
        continue;
      }
      if (command === "\\left") depth++;
      else if (command === "\\right") depth = Math.max(0, depth - 1);
      else if (depth === 0 && RELATIONS.has(command)) {
        const left = tex.slice(0, i).trim();
        const right = tex.slice(i + command.length).trim();
        return left && right ? [left, command, right] : null;
      }
      i += command.length - 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "=" || ch === "<" || ch === ">")) {
      const left = tex.slice(0, i).trim();
      const right = tex.slice(i + 1).trim();
      return left && right ? [left, ch, right] : null;
    }
  }
  return null;
}

// KaTeX settings for the working panel. \hl{…} and \hlalt{…} mark what a step
// changed; they become classes (themed in globals.css) rather than literal
// colours, so they follow light and dark mode. \cancel{…} is KaTeX's own.
// \tfrac is drawn full size: every line is set in display style, and one
// small fraction among full ones reads as a typo.
export const WORK_TEX_MACROS: Record<string, string> = {
  "\\hl": "\\htmlClass{wt-tex-hl}{#1}",
  "\\hlalt": "\\htmlClass{wt-tex-alt}{#1}",
  "\\tfrac": "\\dfrac",
};

export function workTexTrust(context: { command: string }): boolean {
  return context.command === "\\htmlClass";
}
