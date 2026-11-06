import { describe, it, expect } from "vitest";
import type { QuestionDifficulty } from "@/generated/prisma/client";
import { createRandom } from "@/lib/adaptive/random";
import { bonusDifficulty, chooseQuestion, ownDifficulties, rankByFreshness, type Candidate } from "./select";

function q(id: string, difficulty: QuestionDifficulty = "MEDIUM", stepCount = 3): Candidate {
  return { questionId: id, questionRevisionId: `${id}-rev`, difficulty, stepCount };
}

describe("rankByFreshness", () => {
  it("puts the questions the fewest students have seen first", () => {
    const seen = new Map([
      ["a", 12],
      ["b", 0],
      ["c", 3],
    ]);
    const ranked = rankByFreshness([q("a"), q("b"), q("c")], seen, createRandom("x"));
    expect(ranked.map((c) => c.questionId)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties at random but reproducibly", () => {
    const pool = ["a", "b", "c", "d", "e"].map((id) => q(id));
    const one = rankByFreshness(pool, new Map(), createRandom("seed")).map((c) => c.questionId);
    const two = rankByFreshness(pool, new Map(), createRandom("seed")).map((c) => c.questionId);
    expect(one).toEqual(two);
    expect([...one].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("chooseQuestion", () => {
  const random = () => createRandom("pick");

  it("takes the requested tier when it has a question", () => {
    const pick = chooseQuestion({
      candidates: [q("e", "EASY"), q("m", "MEDIUM"), q("h", "HARD")],
      difficulty: "HARD",
      used: new Set(),
      seenBy: new Map(),
      random: random(),
    });
    expect(pick?.questionId).toBe("h");
  });

  it("falls back to the nearest tier when one runs out", () => {
    const pick = chooseQuestion({
      candidates: [q("e", "EASY"), q("h", "HARD")],
      difficulty: "MEDIUM",
      used: new Set(),
      seenBy: new Map(),
      random: random(),
    });
    expect(pick?.questionId).toBe("e");
  });

  it("never reuses a question already in the session", () => {
    const pick = chooseQuestion({
      candidates: [q("a", "EASY"), q("b", "EASY")],
      difficulty: "EASY",
      used: new Set(["a"]),
      seenBy: new Map(),
      random: random(),
    });
    expect(pick?.questionId).toBe("b");
    expect(
      chooseQuestion({ candidates: [q("a")], difficulty: "MEDIUM", used: new Set(["a"]), seenBy: new Map(), random: random() }),
    ).toBeNull();
  });

  it("prefers a question with steps for a worked example, and settles for any", () => {
    const withSteps = chooseQuestion({
      candidates: [q("bare", "MEDIUM", 0), q("easy-steps", "EASY", 4)],
      difficulty: "MEDIUM",
      used: new Set(),
      seenBy: new Map(),
      random: random(),
      needsSteps: true,
    });
    expect(withSteps?.questionId).toBe("easy-steps");
    const none = chooseQuestion({
      candidates: [q("bare", "MEDIUM", 1)],
      difficulty: "MEDIUM",
      used: new Set(),
      seenBy: new Map(),
      random: random(),
      needsSteps: true,
    });
    expect(none?.questionId).toBe("bare");
  });
});

describe("own questions", () => {
  it("gives Medium to a student with no Diagnostic", () => {
    expect(ownDifficulties(null, 4, createRandom("o"))).toEqual(["MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM"]);
  });

  it("draws harder questions for a stronger student", () => {
    const strong = ownDifficulties(95, 40, createRandom("s"));
    const building = ownDifficulties(5, 40, createRandom("s"));
    const hard = (ds: QuestionDifficulty[]) => ds.filter((d) => d === "HARD").length;
    expect(hard(strong)).toBeGreaterThan(hard(building));
  });

  it("pitches the bonus a step above the hardest", () => {
    expect(bonusDifficulty(["EASY", "EASY"])).toBe("MEDIUM");
    expect(bonusDifficulty(["EASY", "MEDIUM"])).toBe("HARD");
    expect(bonusDifficulty(["HARD"])).toBe("HARD");
  });
});
