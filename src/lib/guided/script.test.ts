import { describe, it, expect } from "vitest";
import type { GuidedPhase } from "@/generated/prisma/client";
import { monitorGuidance, outOfTen, scriptFor, type ScriptInput } from "./script";

const base: ScriptInput = {
  phase: "THINK",
  kind: "CLASS",
  skill: "Algebra",
  suggestion: null,
  firstRight: null,
  hasNextQuestion: true,
  step: 0,
  steps: ["Subtract 3 from both sides.", "Divide by 2.", "So $x = 4$."],
  takeaway: "Do the same thing to both sides.",
  correctLabel: "B",
  correctText: "$x = 4$",
  commonWrong: { label: "C", note: "C forgets to divide by 2." },
  takeaways: ["Do the same thing to both sides."],
};
const input = (over: Partial<ScriptInput>): ScriptInput => ({ ...base, ...over });
const labels = (s: ReturnType<typeof scriptFor>) => [s.primary?.label, ...s.secondary.map((a) => a.label)];
const allText = (s: ReturnType<typeof scriptFor>) =>
  [s.title, ...s.doThis, ...s.say, ...s.readAloud.flatMap((b) => [b.heading, ...b.lines])].join("\n");

describe("scriptFor: every phase", () => {
  const phases: GuidedPhase[] = ["LOBBY", "PLAN", "EXAMPLE", "THINK", "TALK", "REVOTE", "REVEAL", "EXPLAIN", "OWN", "RECAP"];

  it("gives every phase a title, something to do, and a main button", () => {
    for (const phase of phases) {
      const s = scriptFor(input({ phase, kind: phase === "LOBBY" ? "WARMUP" : "CLASS" }));
      expect(s.title, phase).not.toBe("");
      expect(s.doThis.length, phase).toBeGreaterThan(0);
      expect(s.primary, phase).not.toBeNull();
    }
  });

  it("uses no test jargon a substitute wouldn't know", () => {
    const jargon = /\b(distractor|stem|rationale|item|scaffold|formative|TSI|Diagnostic|ability)\b/i;
    for (const phase of phases) {
      for (const suggestion of [null, "TALK", "MOVE_ON", "EXPLAIN"] as const) {
        for (const firstRight of [null, 0.2, 0.5, 0.9]) {
          expect(allText(scriptFor(input({ phase, suggestion, firstRight }))), `${phase}/${suggestion}`).not.toMatch(jargon);
        }
      }
    }
  });

  it("names the skill in the plan", () => {
    expect(scriptFor(input({ phase: "PLAN" })).say.join(" ")).toContain("Algebra");
  });
});

describe("scriptFor: the lobby, plan and example", () => {
  it("tells the teacher how students join", () => {
    const s = scriptFor(input({ phase: "LOBBY", kind: "WARMUP" }));
    expect(s.doThis.join(" ")).toContain("prephubtp.com/live");
    expect(s.primary).toEqual({ label: "Start the session", command: { type: "NEXT" } });
  });

  it("hands over the current step of the example to read, and only says the intro on the first", () => {
    const first = scriptFor(input({ phase: "EXAMPLE", kind: "EXAMPLE", step: 0 }));
    expect(first.readAloud[0].lines).toEqual(["Subtract 3 from both sides."]);
    expect(first.readAloud[0].heading).toBe("Read step 1 of 3 aloud");
    expect(first.say.length).toBe(1);
    // Until the last step the big button is "Next step", so pressing it can't skip the walkthrough.
    expect(labels(first)).toEqual(["Next step", "Back a step", "Skip to question 1"]);
    const second = scriptFor(input({ phase: "EXAMPLE", kind: "EXAMPLE", step: 2 }));
    expect(second.readAloud[0].lines).toEqual(["So $x = 4$."]);
    expect(second.say).toEqual([]);
    expect(labels(second)).toEqual(["Start question 1", "Back a step"]);
  });

  it("clamps a step past the end, and copes with an example that has no steps", () => {
    expect(scriptFor(input({ phase: "EXAMPLE", kind: "EXAMPLE", step: 9 })).readAloud[0].heading).toBe("Read step 3 of 3 aloud");
    const none = scriptFor(input({ phase: "EXAMPLE", kind: "EXAMPLE", steps: [] }));
    expect(none.readAloud).toEqual([]);
    expect(none.doThis[0]).toContain("no written steps");
  });
});

describe("scriptFor: while students answer", () => {
  it("waits when nobody has voted", () => {
    const s = scriptFor(input({ suggestion: null }));
    expect(s.title).toBe("Students are answering on their own");
    expect(s.primary?.command).toEqual({ type: "REVEAL" });
  });

  it("suggests partner talk when the class is split, and says it in plain words", () => {
    const s = scriptFor(input({ suggestion: "TALK", firstRight: 0.5 }));
    expect(s.primary).toEqual({ label: "Start partner talk", command: { type: "TALK" } });
    expect(s.doThis[0]).toContain("about 5 out of 10 students");
    expect(s.say[0]).toContain("Turn to the person next to you");
    expect(labels(s)).toContain("Show the answer");
  });

  it("moves on when most have it", () => {
    const s = scriptFor(input({ suggestion: "MOVE_ON", firstRight: 0.85 }));
    expect(s.primary?.command).toEqual({ type: "REVEAL" });
    expect(labels(s)).toContain("Partner talk");
  });

  it("goes straight to the explanation when most missed it", () => {
    const s = scriptFor(input({ suggestion: "EXPLAIN", firstRight: 0.1 }));
    expect(s.title).toContain("missed it");
    expect(s.doThis.join(" ")).toContain("Explain it");
  });

  it("always offers more time and skip", () => {
    for (const suggestion of [null, "TALK", "MOVE_ON", "EXPLAIN"] as const) {
      expect(labels(scriptFor(input({ suggestion })))).toEqual(expect.arrayContaining(["+30 seconds", "Skip this question"]));
    }
  });

  it("has a script for partner talk and the second vote", () => {
    expect(scriptFor(input({ phase: "TALK" })).primary?.command).toEqual({ type: "REVOTE" });
    expect(scriptFor(input({ phase: "REVOTE" })).primary?.command).toEqual({ type: "REVEAL" });
  });
});

describe("scriptFor: the answer", () => {
  it("reads the warm-up answer and the stored reason the common wrong answer tempts people", () => {
    const s = scriptFor(input({ phase: "REVEAL", kind: "WARMUP" }));
    expect(s.title).toContain("warm-up");
    expect(s.readAloud[0].lines[0]).toBe("The correct answer is B: $x = 4$");
    expect(s.readAloud[1].lines[0]).toContain("C forgets to divide by 2.");
    expect(s.primary?.label).toBe("Show today's plan");
  });

  it("when most missed it, leads with the explanation and then a question like it", () => {
    const s = scriptFor(input({ phase: "REVEAL", firstRight: 0.2 }));
    expect(s.primary?.command).toEqual({ type: "EXPLAIN" });
    expect(labels(s)).toEqual(["Explain it", "One like it", "Next question"]);
    expect(s.readAloud.map((b) => b.heading).join()).not.toContain("Why the right answer is right");
  });

  it("when most got it, gives the full reason the right answer is right and moves on", () => {
    const s = scriptFor(input({ phase: "REVEAL", firstRight: 0.8, hasNextQuestion: true }));
    expect(s.primary).toEqual({ label: "Next question", command: { type: "NEXT" } });
    const why = s.readAloud.find((b) => b.heading.startsWith("Why the right answer is right"))!;
    expect(why.lines).toEqual(base.steps);
  });

  it("names the last button after the last question", () => {
    const s = scriptFor(input({ phase: "REVEAL", firstRight: 0.8, hasNextQuestion: false }));
    expect(s.primary?.label).toBe("Start their own questions");
    expect(s.doThis.join(" ")).toContain("Start their own questions");
  });

  it("falls back to a generic line when the wrong choice has no stored reason, and skips it when none stood out", () => {
    const noNote = scriptFor(input({ phase: "REVEAL", firstRight: 0.8, commonWrong: { label: "D", note: null } }));
    expect(noNote.readAloud[1].lines[0]).toContain("A lot of students picked D");
    const none = scriptFor(input({ phase: "REVEAL", firstRight: 0.8, commonWrong: null }));
    expect(none.readAloud.map((b) => b.heading).join()).not.toContain("tempting");
  });

  it("handles a question with no stored steps or answer text", () => {
    const s = scriptFor(input({ phase: "REVEAL", firstRight: 0.8, steps: [], correctText: null, correctLabel: "12" }));
    expect(s.readAloud[0].lines[0]).toBe("The correct answer is 12.");
    expect(s.readAloud.length).toBe(2);
  });
});

describe("scriptFor: explaining", () => {
  it("gives the step on the board and the wrong-answer reason up front", () => {
    const s = scriptFor(input({ phase: "EXPLAIN", step: 0, firstRight: 0.2 }));
    expect(s.say[0]).toContain("one step at a time");
    expect(s.readAloud.map((b) => b.heading)).toEqual(["Why C is tempting but wrong (read this aloud)", "Read step 1 of 3 aloud"]);
    expect(s.primary?.label).toBe("Next step");
    expect(s.secondary.map((a) => a.label)).toContain("Try one like it");
    const last = scriptFor(input({ phase: "EXPLAIN", step: 2, firstRight: 0.2 }));
    expect(last.primary).toEqual({ label: "Try one like it", command: { type: "TWIN" } });
  });

  it("closes with the takeaway on the last step", () => {
    const s = scriptFor(input({ phase: "EXPLAIN", step: 2, firstRight: 0.5 }));
    expect(s.readAloud.map((b) => b.heading)).toEqual(["Read step 3 of 3 aloud", "Finish with this rule (read it aloud)"]);
    expect(s.readAloud[1].lines).toEqual(["Do the same thing to both sides."]);
    expect(s.primary?.label).toBe("Next question");
    expect(labels(s)).toContain("One like it");
  });
});

describe("scriptFor: own questions and the recap", () => {
  it("tells the teacher they don't need to explain the questions", () => {
    const s = scriptFor(input({ phase: "OWN" }));
    expect(s.doThis.join(" ")).toContain("You don't need to explain the questions");
    expect(s.primary?.command).toEqual({ type: "RECAP" });
  });

  it("hands over the takeaways to read at the recap", () => {
    expect(scriptFor(input({ phase: "RECAP" })).readAloud[0].lines).toEqual(base.takeaways);
    expect(scriptFor(input({ phase: "RECAP", takeaways: [] })).readAloud).toEqual([]);
    expect(scriptFor(input({ phase: "RECAP" })).primary?.command).toEqual({ type: "END" });
  });
});

describe("outOfTen", () => {
  it("rounds to a count out of ten and handles the ends", () => {
    expect(outOfTen(0.52)).toBe("about 5 out of 10 students");
    expect(outOfTen(0.02)).toBe("almost no students");
    expect(outOfTen(0.97)).toBe("almost all students");
  });
});

describe("monitorGuidance", () => {
  const quiet = { joined: 5, rosterSize: 8, idle: 0, needsHelp: 0, done: 0 };

  it("tells the teacher how to get students in before anyone has", () => {
    expect(monitorGuidance({ ...quiet, joined: 0 }).title).toBe("Waiting for students to join");
  });
  it("points at students who need help first, then idle ones", () => {
    expect(monitorGuidance({ ...quiet, needsHelp: 2, idle: 1 }).title).toBe("2 students may need help");
    expect(monitorGuidance({ ...quiet, needsHelp: 1 }).title).toBe("1 student may need help");
    expect(monitorGuidance({ ...quiet, idle: 3 }).title).toBe("3 students have gone quiet");
    expect(monitorGuidance({ ...quiet, idle: 1 }).title).toBe("1 student has gone quiet");
  });
  it("says to read the stored explanation rather than know the answer", () => {
    expect(monitorGuidance({ ...quiet, needsHelp: 1 }).doThis.join(" ")).toContain("You don't need to know the answer");
  });
  it("says when everyone is done, otherwise that nothing is needed", () => {
    expect(monitorGuidance({ ...quiet, done: 5 }).title).toBe("Everyone has finished");
    expect(monitorGuidance({ ...quiet, done: 2 }).title).toBe("Students are practicing");
  });
});
