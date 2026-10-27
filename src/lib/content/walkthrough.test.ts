import { describe, expect, it } from "vitest";
import { renderLatexHtml } from "@/components/content/latex-text";
import { locateQuote, markPassage, proseRanges, stateAt, type Walkthrough } from "./walkthrough";
import { validateWalkthrough, walkthroughViewFor } from "./walkthrough-validate";

const passage = "Covering windows has a trade-off. [[In a classroom, for instance, film keeps rooms cool.]] Prices like \\$4 and $x^2$ stay. The design was ______: plain.";

const spec: Walkthrough = {
  version: 1,
  panels: [
    { type: "passage" },
    { type: "choices" },
    { type: "work" },
    { type: "vars" },
    { type: "plane", x: [-2, 6], y: [-2, 6], elements: [{ kind: "point", id: "a", at: [1, 2] }, { kind: "line", id: "l", through: [[0, 0], [1, 1]], hidden: true }] },
  ],
  steps: [
    { passage: { highlight: ["trade-off"] }, choices: { focus: 1 }, work: { add: ["3x = 15"] }, vars: { "$x$": "$5$" } },
    { choices: { eliminate: [0] }, work: { add: ["x = \\hl{5}"] }, plane: { show: ["l"], focus: ["l"] } },
    { choices: { eliminate: [3], reveal: true }, vars: { "$x$": null, slope: "$1$" }, plane: { hide: ["a"] } },
  ],
};

describe("stateAt", () => {
  it("keeps highlights and focus to their own step and carries eliminations forward", () => {
    const first = stateAt(spec, 0);
    expect(first.get("passage")).toEqual({ type: "passage", state: { highlight: ["trade-off"], alt: [], fill: null } });
    expect(first.get("choices")).toEqual({ type: "choices", state: { focus: 1, eliminated: [], revealed: false } });

    const last = stateAt(spec, 2);
    expect(last.get("passage")).toEqual({ type: "passage", state: { highlight: [], alt: [], fill: null } });
    expect(last.get("choices")).toEqual({ type: "choices", state: { focus: null, eliminated: [0, 3], revealed: true } });
  });

  it("builds the working up and marks only this step's lines as new", () => {
    const second = stateAt(spec, 1).get("work");
    expect(second).toEqual({
      type: "work",
      state: {
        lines: [
          { tex: "3x = 15", isNew: false },
          { tex: "x = \\hl{5}", isNew: true },
        ],
      },
    });
  });

  it("sets and removes values, flagging the ones this step changed", () => {
    expect(stateAt(spec, 0).get("vars")).toEqual({ type: "vars", state: { entries: [{ name: "$x$", value: "$5$", changed: true }] } });
    expect(stateAt(spec, 2).get("vars")).toEqual({ type: "vars", state: { entries: [{ name: "slope", value: "$1$", changed: true }] } });
  });

  it("shows hidden elements when a step reveals them, and hides them again", () => {
    const start = stateAt(spec, 0).get("plane");
    expect(start?.type === "plane" && [...start.state.visible]).toEqual(["a"]);
    const reveal = stateAt(spec, 1).get("plane");
    expect(reveal?.type === "plane" && [...reveal.state.appeared]).toEqual(["l"]);
    expect(reveal?.type === "plane" && [...reveal.state.focus]).toEqual(["l"]);
    const later = stateAt(spec, 2).get("plane");
    expect(later?.type === "plane" && [...later.state.visible]).toEqual(["l"]);
    expect(later?.type === "plane" && later.state.appeared.size).toBe(0);
  });

  it("clamps the index and ignores malformed step entries", () => {
    const broken: Walkthrough = { ...spec, steps: [{ choices: { eliminate: "no" } }, ...spec.steps.slice(1)] };
    expect(stateAt(broken, 0).get("choices")).toEqual({ type: "choices", state: { focus: null, eliminated: [], revealed: false } });
    expect(stateAt(spec, 99).get("choices")).toEqual(stateAt(spec, 2).get("choices"));
  });
});

describe("passage marking", () => {
  it("finds prose ranges around math and inside underlines", () => {
    const ranges = proseRanges("a [[b c]] $x$ d");
    expect(ranges.map(([s, e]) => "a [[b c]] $x$ d".slice(s, e))).toEqual(["a ", "b c", " ", " d"]);
  });

  it("places a quote inside an underline but not across its edge or inside math", () => {
    expect(locateQuote(passage, "for instance")).not.toBeNull();
    expect(locateQuote(passage, "trade-off. In a classroom")).toBeNull();
    expect(locateQuote(passage, "x^2")).toBeNull();
  });

  it("renders a highlight inside an underline, and a filled blank, without breaking math or money", () => {
    const marked = markPassage(passage, { highlight: ["for instance"], alt: [], fill: { text: "$5 plain", verdict: "right" } });
    const html = renderLatexHtml(marked);
    expect(html).toContain('<u>In a classroom, <span class="wt-hl">for instance</span>, film keeps rooms cool.</u>');
    expect(html).toContain('<span class="wt-fill wt-fill-right">$5 plain</span>');
    expect(html).toContain("Prices like $4");
    expect(html).toContain("katex");
  });
});

describe("validateWalkthrough", () => {
  const context = { passageText: passage, choiceCount: 4, correctIndex: 2, stepCount: 3 };

  it("accepts a well-formed walkthrough", () => {
    expect(validateWalkthrough(spec, context)).toEqual({ ok: true, spec });
  });

  it("refuses a step count that doesn't match the explanation", () => {
    const check = validateWalkthrough(spec, { ...context, stepCount: 4 });
    expect(check.ok).toBe(false);
    expect(!check.ok && check.problems.join()).toMatch(/3 walkthrough steps for 4 explanation steps/);
  });

  it("refuses crossing out the correct answer, and a walkthrough that never reveals it", () => {
    const crossed = { ...spec, steps: [spec.steps[0], { choices: { eliminate: [2] } }, { choices: {} }] };
    const check = validateWalkthrough(crossed, context);
    expect(!check.ok && check.problems).toEqual(
      expect.arrayContaining([expect.stringMatching(/crosses out the correct answer/), expect.stringMatching(/never reveals the answer/)]),
    );
  });

  it("refuses quotes that aren't placeable, unknown panels and elements, out-of-range points and bad TeX", () => {
    const bad: Walkthrough = {
      ...spec,
      panels: [...spec.panels.slice(0, 4), { type: "plane", x: [0, 5], y: [0, 5], elements: [{ kind: "point", id: "far", at: [9, 9] }] }],
      steps: [
        { passage: { highlight: ["not in the passage"] }, work: { add: ["\\frac{1}{"] } },
        { plane: { show: ["ghost"] }, chart: {} },
        { choices: { reveal: true } },
      ],
    };
    const check = validateWalkthrough(bad, context);
    const all = !check.ok ? check.problems.join("\n") : "";
    expect(all).toMatch(/isn't in the passage/);
    expect(all).toMatch(/can't draw/);
    expect(all).toMatch(/has no element "ghost"/);
    expect(all).toMatch(/"chart" isn't a panel/);
    expect(all).toMatch(/far is outside the plane's range/);
  });

  it("refuses a passage panel on a question without a passage", () => {
    const check = validateWalkthrough(spec, { ...context, passageText: null });
    expect(!check.ok && check.problems.join()).toMatch(/no passage/);
  });
});

describe("walkthroughViewFor", () => {
  const revision = {
    walkthrough: spec,
    passageText: passage,
    answerChoices: [
      { order: 2, text: "C", isCorrect: true },
      { order: 0, text: "A", isCorrect: false },
      { order: 3, text: "D", isCorrect: false },
      { order: 1, text: "B", isCorrect: false },
    ],
    explanationStepCount: 3,
  };

  it("pairs a valid walkthrough with the choices in order", () => {
    const { view, problems } = walkthroughViewFor(revision);
    expect(problems).toEqual([]);
    expect(view).toMatchObject({ choices: ["A", "B", "C", "D"], correctIndex: 2, passageText: passage });
  });

  it("returns nothing, quietly, when there is no walkthrough", () => {
    expect(walkthroughViewFor({ ...revision, walkthrough: null })).toEqual({ view: null, problems: [] });
  });

  it("returns the problems when the stored walkthrough no longer matches", () => {
    const { view, problems } = walkthroughViewFor({ ...revision, explanationStepCount: 5 });
    expect(view).toBeNull();
    expect(problems.length).toBeGreaterThan(0);
  });
});
