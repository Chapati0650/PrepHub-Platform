import { describe, it, expect } from "vitest";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { createRandom } from "@/lib/adaptive/random";
import { SKILL_LINES } from "./pick-skill";
import { allocateSkills, planPracticeRun, weakestCategories } from "./practice-plan";
import type { Candidate } from "./select";

const ALL: QuestionCategory[] = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
  "GEOMETRY_TRIGONOMETRY",
];

function pool(category: QuestionCategory, perTier: number): Candidate[] {
  const tiers: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];
  return tiers.flatMap((difficulty) =>
    Array.from({ length: perTier }, (_, i) => ({
      questionId: `${category}-${difficulty}-${i}`,
      questionRevisionId: `rev-${category}-${difficulty}-${i}`,
      difficulty,
      stepCount: 3,
    })),
  );
}

describe("weakestCategories", () => {
  it("orders skills by how far each is below the college-ready line for its section", () => {
    const levels = {
      ALGEBRA: SKILL_LINES.MATH - 15,
      GRAMMAR: SKILL_LINES.READING_WRITING - 5,
      VOCABULARY: SKILL_LINES.READING_WRITING + 20,
      ADVANCED_MATH: SKILL_LINES.MATH - 2,
    };
    expect(weakestCategories(levels, ALL, 3)).toEqual(["ALGEBRA", "GRAMMAR", "ADVANCED_MATH"]);
  });

  it("puts a skill never measured on the line: after known weaknesses, before strengths", () => {
    const levels = { ALGEBRA: SKILL_LINES.MATH + 10, GRAMMAR: SKILL_LINES.READING_WRITING - 10 };
    const order = weakestCategories(levels, ALL, 7);
    expect(order[0]).toBe("GRAMMAR");
    expect(order[order.length - 1]).toBe("ALGEBRA");
  });

  it("falls back to the given order for a student with no data, and honours the count", () => {
    expect(weakestCategories({}, ALL, 3)).toEqual(ALL.slice(0, 3));
    expect(weakestCategories({}, ALL, 0)).toEqual([]);
  });

  it("only considers skills that have questions", () => {
    expect(weakestCategories({ ALGEBRA: 0 }, ["GRAMMAR", "VOCABULARY"], 3)).toEqual(["GRAMMAR", "VOCABULARY"]);
  });
});

describe("allocateSkills", () => {
  it("deals skills around in turn, weakest first", () => {
    expect(allocateSkills(7, ["ALGEBRA", "GRAMMAR", "VOCABULARY"])).toEqual([
      "ALGEBRA",
      "GRAMMAR",
      "VOCABULARY",
      "ALGEBRA",
      "GRAMMAR",
      "VOCABULARY",
      "ALGEBRA",
    ]);
  });
  it("is empty with no skills or no questions", () => {
    expect(allocateSkills(5, [])).toEqual([]);
    expect(allocateSkills(0, ["ALGEBRA"])).toEqual([]);
  });
});

describe("planPracticeRun", () => {
  const candidates = new Map(ALL.map((c) => [c, pool(c, 4)]));
  const run = (over: Partial<Parameters<typeof planPracticeRun>[0]> = {}) =>
    planPracticeRun({
      categories: ["ALGEBRA", "GRAMMAR", "VOCABULARY"],
      count: 10,
      abilityOf: () => null,
      candidates,
      seenBy: new Map(),
      used: new Set(),
      random: createRandom("7"),
      ...over,
    });

  it("deals the requested number, split across the student's skills", () => {
    const plan = run();
    expect(plan).toHaveLength(10);
    const counts = plan.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category]: (m[p.category] ?? 0) + 1 }), {});
    expect(counts).toEqual({ ALGEBRA: 4, GRAMMAR: 3, VOCABULARY: 3 });
  });

  it("never repeats a question", () => {
    const ids = run().map((p) => p.candidate.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pitches a student with no Diagnostic at Medium", () => {
    expect(run().every((p) => p.candidate.difficulty === "MEDIUM")).toBe(true);
  });

  it("pitches a strong student harder than a weak one", () => {
    const rank = { EASY: 0, MEDIUM: 1, HARD: 2 } as const;
    const mean = (plan: ReturnType<typeof run>) => plan.reduce((a, p) => a + rank[p.candidate.difficulty], 0) / plan.length;
    const strong = run({ abilityOf: () => 95, count: 30, random: createRandom("3") });
    const weak = run({ abilityOf: () => 5, count: 30, random: createRandom("3") });
    expect(mean(strong)).toBeGreaterThan(mean(weak));
  });

  it("prefers questions the student hasn't seen", () => {
    const seen = new Map<string, number>();
    for (const c of candidates.get("ALGEBRA")!.filter((x) => x.difficulty === "MEDIUM").slice(0, 3)) seen.set(c.questionId, 1);
    const plan = run({ categories: ["ALGEBRA"], count: 1, seenBy: seen });
    expect(seen.has(plan[0].candidate.questionId)).toBe(false);
  });

  it("hands a slot to the next skill when one runs out, and runs short only when every skill is empty", () => {
    const thin = new Map(candidates);
    thin.set("ALGEBRA", []);
    const plan = run({ candidates: thin });
    expect(plan).toHaveLength(10);
    expect(plan.some((p) => p.category === "ALGEBRA")).toBe(false);

    const none = run({ candidates: new Map() });
    expect(none).toEqual([]);

    const few = new Map<QuestionCategory, Candidate[]>([["ALGEBRA", pool("ALGEBRA", 1).slice(0, 2)]]);
    expect(run({ categories: ["ALGEBRA"], candidates: few })).toHaveLength(2);
  });

  it("works for a single chosen skill", () => {
    const plan = run({ categories: ["GRAMMAR"], count: 6 });
    expect(plan).toHaveLength(6);
    expect(plan.every((p) => p.category === "GRAMMAR")).toBe(true);
  });
});
