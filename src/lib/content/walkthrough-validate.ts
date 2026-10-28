import katex from "katex";
import {
  BarsStepSchema,
  BLANK,
  ChoicesStepSchema,
  ElementsStepSchema,
  locateQuote,
  onWordBoundaries,
  panelId,
  PassageStepSchema,
  TableStepSchema,
  VarsStepSchema,
  WalkthroughSchema,
  WORK_TEX_MACROS,
  WorkStepSchema,
  workTexTrust,
  type Panel,
  type Walkthrough,
  type WalkthroughView,
} from "./walkthrough";

// Everything that would show a student a broken or misleading walkthrough:
// a quote that isn't in the passage, a choice crossed out that is actually
// the answer, a step count that doesn't match the explanation, math KaTeX
// can't draw. The import refuses a question with any of these, and the
// feedback loader drops a walkthrough that fails them rather than showing it.

export type WalkthroughContext = {
  passageText: string | null;
  choiceCount: number;
  /** null for a grid-in. */
  correctIndex: number | null;
  stepCount: number;
};

export type WalkthroughCheck = { ok: true; spec: Walkthrough } | { ok: false; problems: string[] };

function texProblem(tex: string, displayMode: boolean, work: boolean): string | null {
  try {
    katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: "ignore",
      ...(work ? { macros: { ...WORK_TEX_MACROS }, trust: workTexTrust } : {}),
    });
    return null;
  } catch (err) {
    return String((err as Error).message).split("\n")[0];
  }
}

/** Problems with text that LatexText renders: unbalanced delimiters or math KaTeX can't draw. */
function latexTextProblems(text: string): string[] {
  const problems: string[] = [];
  const source = text.replace(/\\\$/g, "\u0000");
  if (((source.match(/\$/g) ?? []).length) % 2 !== 0) problems.push(`unbalanced $ in "${text.slice(0, 50)}"`);
  for (const match of source.matchAll(/\$\$[^$]+\$\$|\$[^$]+\$/g)) {
    const display = match[0].startsWith("$$");
    const tex = (display ? match[0].slice(2, -2) : match[0].slice(1, -1)).replaceAll("\u0000", "\\$");
    const problem = texProblem(tex, display, false);
    if (problem) problems.push(`can't draw "${tex}": ${problem}`);
  }
  return problems;
}

function elementIds(panel: Panel): Set<string> {
  if (panel.type === "plane" || panel.type === "diagram" || panel.type === "numberline") {
    return new Set(panel.elements.map((e) => e.id));
  }
  return new Set();
}

function panelProblems(panel: Panel): string[] {
  const problems: string[] = [];
  const id = panelId(panel);
  if (panel.type === "plane") {
    const [x0, x1] = panel.x;
    const [y0, y1] = panel.y;
    const inside = ([x, y]: [number, number]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    for (const e of panel.elements) {
      const pts = e.kind === "point" || e.kind === "label" ? [e.at] : e.kind === "line" ? [] : e.kind === "segment" ? [e.from, e.to] : [];
      if (pts.some((p) => !inside(p))) problems.push(`${id}: ${e.id} is outside the plane's range`);
    }
  }
  if (panel.type === "diagram") {
    const inside = ([x, y]: [number, number]) => x >= 0 && x <= panel.width && y >= 0 && y <= panel.height;
    for (const e of panel.elements) {
      const pts =
        e.kind === "point" || e.kind === "label"
          ? [e.at]
          : e.kind === "segment"
            ? [e.from, e.to]
            : e.kind === "polygon"
              ? e.points
              : e.kind === "circle"
                ? [e.center]
                : [e.vertex, e.from, e.to];
      if (pts.some((p) => !inside(p))) problems.push(`${id}: ${e.id} is outside the diagram (0–${panel.width} × 0–${panel.height})`);
    }
  }
  if (panel.type === "numberline") {
    if (panel.max <= panel.min) problems.push(`${id}: max must be above min`);
    for (const e of panel.elements) {
      const xs =
        e.kind === "interval" ? [e.from, e.to].filter((v): v is number => v !== null) : e.kind === "span" ? [e.from, e.to] : [e.at];
      if (xs.some((x) => x < panel.min || x > panel.max)) problems.push(`${id}: ${e.id} is off the number line`);
      if (e.kind === "span" && e.from === e.to) problems.push(`${id}: ${e.id} is a distance of nothing (from and to are equal)`);
      if ((e.kind === "span" || e.kind === "point") && e.label) problems.push(...latexTextProblems(e.label));
    }
  }
  if (panel.type === "table") {
    panel.rows.forEach((row, i) => {
      if (row.length !== panel.header.length) problems.push(`${id}: row ${i} has ${row.length} cells, the header has ${panel.header.length}`);
    });
    for (const cell of [...panel.header, ...panel.rows.flat(), panel.title ?? ""]) problems.push(...latexTextProblems(cell));
  }
  if (panel.type === "bars") {
    panel.series.forEach((s) => {
      if (s.values.length !== panel.categories.length) problems.push(`${id}: series "${s.name}" has ${s.values.length} values for ${panel.categories.length} categories`);
    });
  }
  const ids = [...elementIds(panel)];
  if (new Set(ids).size !== ids.length) problems.push(`${id}: element ids repeat`);
  return problems;
}

/**
 * A revision's stored walkthrough, checked against the revision's own content
 * and paired with it for drawing. `problems` is set when there is a stored
 * walkthrough that can't be shown, so the caller can log it.
 */
export function walkthroughViewFor(revision: {
  /** Passed where a student is answering, so the walkthrough can ask "Did this make sense?". */
  id?: string;
  walkthrough: unknown;
  passageText: string | null;
  answerChoices: { order: number; text: string; isCorrect: boolean }[];
  explanationStepCount: number;
}): { view: WalkthroughView | null; problems: string[] } {
  if (revision.walkthrough === null || revision.walkthrough === undefined) return { view: null, problems: [] };
  const choices = [...revision.answerChoices].sort((a, b) => a.order - b.order);
  const correct = choices.findIndex((c) => c.isCorrect);
  const correctIndex = correct === -1 ? null : correct;
  const check = validateWalkthrough(revision.walkthrough, {
    passageText: revision.passageText,
    choiceCount: choices.length,
    correctIndex,
    stepCount: revision.explanationStepCount,
  });
  if (!check.ok) return { view: null, problems: check.problems };
  return {
    view: {
      spec: check.spec,
      passageText: revision.passageText,
      choices: choices.map((c) => c.text),
      correctIndex,
      ...(revision.id ? { revisionId: revision.id } : {}),
    },
    problems: [],
  };
}

export function validateWalkthrough(raw: unknown, context: WalkthroughContext): WalkthroughCheck {
  const parsed = WalkthroughSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "walkthrough"}: ${i.message}`) };
  }
  const spec = parsed.data;
  const problems: string[] = [];
  const panels = new Map<string, Panel>();

  for (const panel of spec.panels) {
    const id = panelId(panel);
    if (panels.has(id)) problems.push(`two panels are both "${id}"; give one an id`);
    panels.set(id, panel);
    if (panel.type === "passage" && !context.passageText?.trim()) problems.push("a passage panel, but the question has no passage");
    if (panel.type === "choices" && context.choiceCount === 0) problems.push("a choices panel, but the question has no answer choices");
    problems.push(...panelProblems(panel));
  }

  if (spec.steps.length !== context.stepCount) {
    problems.push(`${spec.steps.length} walkthrough steps for ${context.stepCount} explanation steps; they must match one to one`);
  }

  let revealed = false;
  spec.steps.forEach((step, n) => {
    const at = `step ${n + 1}`;
    for (const [key, entry] of Object.entries(step)) {
      const panel = panels.get(key);
      if (!panel) {
        problems.push(`${at}: "${key}" isn't a panel`);
        continue;
      }
      switch (panel.type) {
        case "passage": {
          const p = PassageStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: passage: ${p.error.issues[0]?.message}`);
            break;
          }
          const source = context.passageText ?? "";
          for (const quote of [...(p.data.highlight ?? []), ...(p.data.alt ?? [])]) {
            const found = locateQuote(source, quote);
            if (!found) {
              problems.push(`${at}: "${quote.slice(0, 50)}" isn't in the passage as plain text (copy it exactly; don't cross math or an underline's edge)`);
            } else if (!onWordBoundaries(source, found[0], found[1])) {
              problems.push(`${at}: "${quote.slice(0, 50)}" starts or ends partway through a word; highlight whole words`);
            }
          }
          if (p.data.fill) {
            if (/\$|\[\[|\]\]/.test(p.data.fill.text)) problems.push(`${at}: a filled blank can't contain $ or [[ ]]`);
            if (!BLANK.test(source)) problems.push(`${at}: fills a blank, but the passage has none`);
          }
          break;
        }
        case "choices": {
          const p = ChoicesStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: choices: ${p.error.issues[0]?.message}`);
            break;
          }
          const indices = [...(p.data.eliminate ?? []), ...(p.data.focus !== undefined ? [p.data.focus] : [])];
          if (indices.some((i) => i >= context.choiceCount)) problems.push(`${at}: a choice index past the last choice`);
          if (context.correctIndex !== null && p.data.eliminate?.includes(context.correctIndex)) {
            problems.push(`${at}: crosses out the correct answer`);
          }
          if (p.data.reveal) revealed = true;
          break;
        }
        case "work": {
          const p = WorkStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: work: ${p.error.issues[0]?.message}`);
            break;
          }
          for (const tex of [...(p.data.formula ? [p.data.formula.tex] : []), ...(p.data.add ?? [])]) {
            const problem = texProblem(tex, true, true);
            if (problem) problems.push(`${at}: can't draw "${tex}": ${problem}`);
          }
          if (p.data.formula) problems.push(...latexTextProblems(p.data.formula.name).map((q) => `${at}: formula name: ${q}`));
          break;
        }
        case "vars": {
          const p = VarsStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: vars: ${p.error.issues[0]?.message}`);
            break;
          }
          for (const [name, value] of Object.entries(p.data)) {
            problems.push(...latexTextProblems(name), ...(value ? latexTextProblems(value) : []));
          }
          break;
        }
        case "plane":
        case "diagram":
        case "numberline": {
          const p = ElementsStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: ${key}: ${p.error.issues[0]?.message}`);
            break;
          }
          const known = elementIds(panel);
          for (const e of [...(p.data.show ?? []), ...(p.data.hide ?? []), ...(p.data.focus ?? [])]) {
            if (!known.has(e)) problems.push(`${at}: ${key} has no element "${e}"`);
          }
          break;
        }
        case "table": {
          const p = TableStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: table: ${p.error.issues[0]?.message}`);
            break;
          }
          const rows = panel.rows.length;
          const cols = panel.header.length;
          if ((p.data.rows ?? []).some((r) => r >= rows) || (p.data.cols ?? []).some((c) => c >= cols)) {
            problems.push(`${at}: a table row or column past the end`);
          }
          if ((p.data.cells ?? []).some(([r, c]) => r >= rows || c >= cols)) problems.push(`${at}: a table cell past the end`);
          break;
        }
        case "bars": {
          const p = BarsStepSchema.safeParse(entry);
          if (!p.success) {
            problems.push(`${at}: bars: ${p.error.issues[0]?.message}`);
            break;
          }
          for (const f of p.data.focus ?? []) {
            const [s, c] = typeof f === "number" ? [0, f] : f;
            if (s >= panel.series.length || c >= panel.categories.length) problems.push(`${at}: a bar past the end`);
          }
          break;
        }
      }
    }
  });

  if (panels.size > 0 && [...panels.values()].some((p) => p.type === "choices") && !revealed) {
    problems.push("the choices panel never reveals the answer (add reveal: true to the last step)");
  }

  const prompted = new Set<number>();
  for (const prompt of spec.prompts ?? []) {
    const at = `the prompt on step ${prompt.step}`;
    if (prompt.step > spec.steps.length) problems.push(`${at}: there is no step ${prompt.step}`);
    if (prompted.has(prompt.step)) problems.push(`${at}: a step can have one prompt`);
    prompted.add(prompt.step);
    const count = prompt.options === "choices" ? context.choiceCount : prompt.options.length;
    if (prompt.options === "choices" && context.choiceCount === 0) problems.push(`${at}: asks about the choices, but the question has none`);
    const answers = typeof prompt.answer === "number" ? [prompt.answer] : prompt.answer;
    if (answers.some((a) => a >= count)) problems.push(`${at}: an answer past the last option`);
    // "Which can you rule out?" accepts several choices, and the right answer
    // is never one of them; asking for the right answer alone is fine.
    if (prompt.options === "choices" && answers.length > 1 && context.correctIndex !== null && answers.includes(context.correctIndex)) {
      problems.push(`${at}: mixes the correct choice in with choices to rule out`);
    }
    for (const text of [prompt.ask, prompt.hint ?? "", ...(prompt.options === "choices" ? [] : prompt.options)]) {
      problems.push(...latexTextProblems(text).map((p) => `${at}: ${p}`));
    }
  }
  if (spec.takeaway) problems.push(...latexTextProblems(spec.takeaway).map((p) => `takeaway: ${p}`));

  if (spec.goals) {
    const starts = spec.goals.map((g) => g.step);
    if (starts[0] !== 1) problems.push("goals: the first part must start at step 1");
    if (starts.some((s, i) => i > 0 && s <= starts[i - 1])) problems.push("goals: parts must be in step order, each starting after the last");
    if (starts.some((s) => s > spec.steps.length)) problems.push(`goals: a part starts after the last step (${spec.steps.length})`);
    for (const g of spec.goals) problems.push(...latexTextProblems(g.label).map((p) => `goals: ${p}`));
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, spec };
}

const FIGURES = new Set(["plane", "diagram", "numberline", "bars", "table"]);

function polygonMinAngle(points: [number, number][]): number {
  let min = 180;
  points.forEach((p, i) => {
    const a = points[(i + points.length - 1) % points.length];
    const b = points[(i + 1) % points.length];
    const u = [a[0] - p[0], a[1] - p[1]];
    const v = [b[0] - p[0], b[1] - p[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) || 1) * (Math.hypot(v[0], v[1]) || 1));
    min = Math.min(min, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  });
  return min;
}

/**
 * Advice for whoever writes a walkthrough, never a reason to refuse one: the
 * things that make a walkthrough weaker without making it wrong. The import
 * and bank checks print these; serving ignores them.
 */
export function lintWalkthrough(spec: Walkthrough): string[] {
  const advice: string[] = [];
  const steps = spec.steps.length;
  if (!spec.goals && steps >= 4) advice.push("no goals: name the parts of the solution (2-5 short labels, e.g. \"Find the radius\")");

  const work = spec.panels.find((p) => p.type === "work");
  if (work) {
    const lines = spec.steps.flatMap((s) => {
      const p = WorkStepSchema.safeParse(s[panelId(work)] ?? {});
      return p.success ? [p.data] : [];
    });
    if (!lines.some((l) => l.formula)) advice.push("no formula card: if any step states a formula, definition or rule, give it a `formula` card");
    lines.forEach((l, i) => {
      for (const tex of l.add ?? []) {
        // A long chain breaks into rows by itself; a single side this long doesn't.
        const sides = tex.split(/=|\\approx|\\le|\\ge|<|>/);
        if (sides.some((s) => s.replace(/\\[a-zA-Z]+|[{}\s]/g, "").length > 46)) {
          advice.push(`step ${i + 1}: a side of "${tex.slice(0, 40)}…" is very long; split it over two lines of working`);
        }
      }
    });
  }

  for (const panel of spec.panels) {
    const id = panelId(panel);
    if (!FIGURES.has(panel.type)) continue;
    const changing = spec.steps.slice(1).filter((s) => {
      const entry = s[id];
      return !!entry && typeof entry === "object" && Object.keys(entry).length > 0;
    }).length;
    if (steps >= 4 && changing < Math.ceil((steps - 1) / 3)) {
      advice.push(`${id}: changes on ${changing} of steps 2-${steps}; make it follow the steps (focus what each step is about, show what it finds)`);
    }
    if (panel.type === "diagram") {
      for (const e of panel.elements) {
        if (e.kind === "polygon" && polygonMinAngle(e.points) < 12) {
          advice.push(`${id}: ${e.id} has an angle under 12°; draw it not to scale so it's readable (and say so)`);
        }
      }
    }
    if (panel.type === "plane" || panel.type === "diagram") {
      for (const e of panel.elements) {
        const text = "label" in e && typeof e.label === "string" ? e.label : e.kind === "label" ? e.text : "";
        const plain = text.replace(/\$[^$]*\$/g, "");
        if (/\d\s*\/\s*\d/.test(plain) || /\d\s*\/\s*\d/.test(text.match(/\$[^$]*\$/g)?.join(" ") ?? "")) {
          advice.push(`${id}: ${e.id}'s label writes a fraction with "/"; use $\\frac{a}{b}$ so it can't be misread`);
        }
      }
    }
  }
  return advice;
}
