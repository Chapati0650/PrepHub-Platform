import { describe, expect, it } from "vitest";
import { renderLatexHtml } from "@/components/content/latex-text";
import {
  chainRows,
  changedPanelsAt,
  choiceChangesAt,
  formulasOf,
  goalAt,
  goalParts,
  locateQuote,
  markNarration,
  markPassage,
  MARK,
  onWordBoundaries,
  promptAt,
  proseRanges,
  splitAtRelation,
  stateAt,
  type Walkthrough,
} from "./walkthrough";
import { lintWalkthrough, validateWalkthrough, walkthroughViewFor } from "./walkthrough-validate";

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

  it("gives the stage before step 1 at index -1, for a question asked before the first step", () => {
    const before = stateAt(spec, -1);
    expect(before.get("passage")).toEqual({ type: "passage", state: { highlight: [], alt: [], fill: null } });
    expect(before.get("work")).toEqual({ type: "work", state: { lines: [] } });
    expect(before.get("vars")).toEqual({ type: "vars", state: { entries: [] } });
    const plane = before.get("plane");
    expect(plane?.type === "plane" && [...plane.state.visible]).toEqual(["a"]);
  });
});

describe("what a step changes", () => {
  it("names the panels a step touches, ignoring empty entries", () => {
    expect([...changedPanelsAt(spec, 0)]).toEqual(["passage", "choices", "work", "vars"]);
    expect([...changedPanelsAt({ ...spec, steps: [{ work: {} }, ...spec.steps.slice(1)] }, 0)]).toEqual([]);
    expect([...changedPanelsAt(spec, 9)]).toEqual([]);
  });

  it("says what a step does to the choices", () => {
    expect(choiceChangesAt(spec, 0)).toEqual({ focus: 1, eliminate: [], reveal: false });
    expect(choiceChangesAt(spec, 2)).toEqual({ focus: null, eliminate: [3], reveal: true });
  });

  it("finds the prompt asked before a step, by the 1-based step it names", () => {
    const prompted: Walkthrough = { ...spec, prompts: [{ step: 2, ask: "Which goes?", options: "choices", answer: 0 }] };
    expect(promptAt(prompted, 1)?.ask).toBe("Which goes?");
    expect(promptAt(prompted, 0)).toBeNull();
    expect(promptAt(spec, 1)).toBeNull();
  });
});

describe("marking the narration", () => {
  const [hlOpen, hlClose] = MARK.hl;
  const [altOpen, altClose] = MARK.alt;

  it("colours the words a highlight shares with the narration, ignoring case and punctuation between words", () => {
    expect(markNarration("It says few economists would have predicted that.", ["Few economists would have predicted"], [])).toBe(
      `It says ${hlOpen}few economists would have predicted${hlClose} that.`,
    );
    expect(markNarration('It begins "In a classroom, for instance", which signals it.', ["In a classroom, for instance"], [])).toContain(
      `${hlOpen}In a classroom, for instance${hlClose}`,
    );
  });

  it("matches the longest shared run, keeps numbers like 1,200 whole, and uses the second colour for alt", () => {
    expect(markNarration('"Comprising some 1,200 languages" describes it.', ["some 1,200 languages"], [])).toContain(
      `${hlOpen}some 1,200 languages${hlClose}`,
    );
    expect(markNarration("prices would soar, it says", [], ["would soar in the late 2010s"])).toBe(`prices ${altOpen}would soar${altClose}, it says`);
  });

  it("never stops partway through a word, matches curly and straight apostrophes, and leaves filler and maths alone", () => {
    // "of the world" inside "of the world's" is not a match on "world".
    expect(markNarration("one-fifth of the world's languages", ["of the world"], [])).not.toContain(`world${hlClose}`);
    expect(markNarration("one-fifth of the world's languages", ["of the world’s languages"], [])).toContain(`${hlOpen}of the world's languages${hlClose}`);
    expect(markNarration("on the other hand", ["of the"], [])).toBe("on the other hand");
    expect(markNarration("so $x$ equals two", ["x equals"], [])).toBe("so $x$ equals two");
    expect(markNarration("A paraphrase entirely.", ["nothing alike here"], [])).toBe("A paraphrase entirely.");
  });
});

describe("splitAtRelation", () => {
  it("splits at the first top-level relation", () => {
    expect(splitAtRelation("|x| - 38 = 0")).toEqual(["|x| - 38", "=", "0"]);
    expect(splitAtRelation("y < 15x + 12")).toEqual(["y", "<", "15x + 12"]);
    expect(splitAtRelation("V = 2{,}951.4375\\pi \\approx 9{,}272")).toEqual(["V", "=", "2{,}951.4375\\pi \\approx 9{,}272"]);
    expect(splitAtRelation("a \\le b")).toEqual(["a", "\\le", "b"]);
  });

  it("skips relations inside braces or \\left…\\right, and lines without one", () => {
    expect(splitAtRelation("\\hl{x = 3}")).toBeNull();
    expect(splitAtRelation("\\left(a = b\\right) + c")).toBeNull();
    expect(splitAtRelation("\\frac{1}{2}")).toBeNull();
    expect(splitAtRelation("= 5")).toBeNull();
    expect(splitAtRelation("\\left|x\\right| = 2")).toEqual(["\\left|x\\right|", "=", "2"]);
  });
});

describe("onWordBoundaries", () => {
  const text = "the world's languages and some 1,200 more";
  it("accepts whole words and refuses a cut through one, a possessive included", () => {
    expect(onWordBoundaries(text, 0, 3)).toBe(true);
    expect(onWordBoundaries(text, 4, 9)).toBe(false); // "world" of "world's"
    expect(onWordBoundaries(text, 4, 21)).toBe(true);
    expect(onWordBoundaries(text, 1, 3)).toBe(false);
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

  it("refuses a highlight that stops partway through a word", () => {
    const cut = { ...spec, steps: [{ passage: { highlight: ["trade-of"] } }, ...spec.steps.slice(1)] };
    const check = validateWalkthrough(cut, context);
    expect(!check.ok && check.problems.join()).toMatch(/partway through a word/);
  });

  it("accepts prompts and a takeaway, and refuses prompts that can't be asked", () => {
    const good: Walkthrough = {
      ...spec,
      prompts: [
        { step: 2, ask: "Which can you rule out?", options: "choices", answer: [0, 3] },
        { step: 3, ask: "What is $x$?", options: ["$4$", "$5$"], answer: 1, hint: "Divide both sides by $3$." },
      ],
      takeaway: "Divide by the coefficient to isolate $x$.",
    };
    expect(validateWalkthrough(good, context).ok).toBe(true);

    const bad: Walkthrough = {
      ...spec,
      prompts: [
        { step: 9, ask: "Past the end?", options: ["a", "b"], answer: 0 },
        { step: 2, ask: "Rule out?", options: "choices", answer: [0, 2] },
        { step: 3, ask: "Which?", options: ["a", "b"], answer: 4 },
        { step: 3, ask: "Twice?", options: ["a", "b"], answer: 0 },
      ],
      takeaway: "Broken $\\frac{1}{$ maths",
    };
    const check = validateWalkthrough(bad, context);
    const all = !check.ok ? check.problems.join("\n") : "";
    expect(all).toMatch(/there is no step 9/);
    expect(all).toMatch(/mixes the correct choice in/);
    expect(all).toMatch(/an answer past the last option/);
    expect(all).toMatch(/a step can have one prompt/);
    expect(all).toMatch(/takeaway: /);
  });

  it("checks a number line's distances", () => {
    const line = (elements: unknown[]) =>
      ({ ...spec, panels: [...spec.panels.slice(0, 4), { type: "numberline", min: -50, max: 50, elements }], steps: [spec.steps[0], spec.steps[0], { choices: { reveal: true } }] }) as unknown as Walkthrough;
    expect(validateWalkthrough(line([{ kind: "span", id: "d", from: 0, to: -38, label: "$38$" }]), context).ok).toBe(true);
    const off = validateWalkthrough(line([{ kind: "span", id: "d", from: 0, to: 60 }, { kind: "span", id: "z", from: 4, to: 4 }]), context);
    expect(!off.ok && off.problems.join()).toMatch(/d is off the number line/);
    expect(!off.ok && off.problems.join()).toMatch(/a distance of nothing/);
  });
});

describe("LatexText blanks", () => {
  it("wraps a blank in its own element without changing its text", () => {
    const html = renderLatexHtml("Ecuador has ______ volcanoes and $x_1$ stays maths.");
    expect(html).toContain('<span class="latex-blank"><span class="latex-blank-line">______</span></span>');
    expect(html.match(/latex-blank"/g)).toHaveLength(1);
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

describe("chainRows", () => {
  it("puts each later relation of a chain on a row of its own, lined up on it", () => {
    expect(chainRows("R^2 - r^2 = (R - r)(R + r) = 22.36")).toEqual([
      ["R^2 - r^2", "=", "(R - r)(R + r)"],
      ["", "=", "22.36"],
    ]);
    expect(chainRows("V = 2{,}951.4375\\pi \\approx 9{,}272")).toEqual([
      ["V", "=", "2{,}951.4375\\pi"],
      ["", "\\approx", "9{,}272"],
    ]);
  });

  it("leaves a line with one relation as one row, and refuses one with an empty side", () => {
    expect(chainRows("x = 5")).toEqual([["x", "=", "5"]]);
    expect(chainRows("x = = 5")).toBeNull();
    expect(chainRows("\\frac{1}{2}")).toBeNull();
  });
});

describe("goals and formulas", () => {
  const slope = "m = \\frac{y_2 - y_1}{x_2 - x_1}";
  const withGoals: Walkthrough = {
    ...spec,
    goals: [
      { step: 1, label: "Set it up" },
      { step: 3, label: "Check the choices" },
    ],
    steps: [{ work: { formula: { name: "Slope", tex: slope }, add: ["m = 2"] } }, { work: { add: ["y = 2x"] } }, { work: { formula: { name: "Slope", tex: slope } } }],
  };

  it("splits the steps into named parts", () => {
    expect(goalParts(withGoals)).toEqual([
      { label: "Set it up", from: 0, to: 2 },
      { label: "Check the choices", from: 2, to: 3 },
    ]);
    expect(goalAt(withGoals, 1)).toEqual({ label: "Set it up", part: 0, parts: 2 });
    expect(goalAt(withGoals, 2)).toEqual({ label: "Check the choices", part: 1, parts: 2 });
    expect(goalAt(spec, 0)).toBeNull();
  });

  it("puts a formula card before the step's working, and lists each formula once", () => {
    expect(stateAt(withGoals, 0).get("work")).toEqual({
      type: "work",
      state: {
        lines: [
          { tex: slope, formula: "Slope", isNew: true },
          { tex: "m = 2", isNew: true },
        ],
      },
    });
    expect(formulasOf(withGoals)).toEqual([{ name: "Slope", tex: slope }]);
  });

  it("refuses parts out of order, or not starting at step 1", () => {
    const context = { passageText: passage, choiceCount: 4, correctIndex: 2, stepCount: 3 };
    const ok = { ...spec, goals: [{ step: 1, label: "One" }, { step: 3, label: "Two" }] };
    expect(validateWalkthrough(ok, context).ok).toBe(true);
    const late = validateWalkthrough({ ...spec, goals: [{ step: 2, label: "One" }, { step: 3, label: "Two" }] }, context);
    expect(!late.ok && late.problems.join()).toMatch(/must start at step 1/);
    const backwards = validateWalkthrough({ ...spec, goals: [{ step: 1, label: "One" }, { step: 1, label: "Two" }] }, context);
    expect(!backwards.ok && backwards.problems.join()).toMatch(/in step order/);
  });
});

describe("lintWalkthrough", () => {
  it("advises on a figure that stops changing, missing parts and formulas, a sliver of a triangle and a slashed fraction", () => {
    const still: Walkthrough = {
      version: 1,
      panels: [
        { type: "work" },
        {
          type: "diagram",
          width: 300,
          height: 100,
          elements: [
            { kind: "polygon", id: "t", points: [[0, 100], [300, 100], [0, 70]] },
            { kind: "label", id: "f", at: [150, 50], text: "p = 3/4t" },
          ],
        },
      ],
      steps: [{ work: { add: ["a = 1"] }, diagram: { focus: ["t"] } }, { work: { add: ["b = 2"] } }, { work: { add: ["c = 3"] } }, { work: { add: ["d = 4"] } }],
    };
    const advice = lintWalkthrough(still).join("\n");
    expect(advice).toMatch(/no goals/);
    expect(advice).toMatch(/no formula card/);
    expect(advice).toMatch(/diagram: changes on 0 of steps 2-4/);
    expect(advice).toMatch(/t has an angle under 12°/);
    expect(advice).toMatch(/fraction with "\/"/);
  });
});
