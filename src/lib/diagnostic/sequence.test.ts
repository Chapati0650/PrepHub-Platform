import { describe, expect, it } from "vitest";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import {
  BONUS_SEQUENCE,
  CORE_QUESTION_COUNT,
  CORE_SEQUENCE,
  DIAGNOSTIC_SEQUENCE,
  attemptsToWaive,
  diagnosticStage,
  pendingBonusAttempts,
  sequenceIndex,
  unansweredAttempts,
  type StageAttempt,
} from "./sequence";

const DIFFICULTIES: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

describe("the served order", () => {
  it("covers every (category, difficulty) exactly once — the scoring tables need all 21", () => {
    expect(DIAGNOSTIC_SEQUENCE).toHaveLength(21);
    for (const category of ALL_CATEGORIES) {
      for (const difficulty of DIFFICULTIES) {
        const matches = DIAGNOSTIC_SEQUENCE.filter((s) => s.category === category && s.difficulty === difficulty);
        expect(matches, `${category}/${difficulty}`).toHaveLength(1);
      }
    }
  });

  it("keeps every Hard question out of the core and in the bonus round", () => {
    expect(CORE_QUESTION_COUNT).toBe(14);
    expect(CORE_SEQUENCE.every((s) => s.difficulty !== "HARD")).toBe(true);
    expect(BONUS_SEQUENCE.every((s) => s.difficulty === "HARD")).toBe(true);
  });

  it("opens with four Easy questions, none of them a reading passage", () => {
    // The regression this guards: every student used to meet Reading
    // Comprehension Easy, Medium and Hard as questions one to three, and 48
    // of the 73 who quit did so right there.
    const opening = CORE_SEQUENCE.slice(0, 4);
    expect(opening.every((s) => s.difficulty === "EASY")).toBe(true);
    expect(opening.some((s) => s.category === "READING_COMPREHENSION")).toBe(false);
  });

  it("never puts two reading passages back to back", () => {
    for (let i = 1; i < DIAGNOSTIC_SEQUENCE.length; i++) {
      const both =
        DIAGNOSTIC_SEQUENCE[i - 1].category === "READING_COMPREHENSION" &&
        DIAGNOSTIC_SEQUENCE[i].category === "READING_COMPREHENSION";
      expect(both, `positions ${i - 1} and ${i}`).toBe(false);
    }
  });

  it("serves each category's Easy before its Medium", () => {
    for (const category of ALL_CATEGORIES) {
      expect(sequenceIndex(category, "EASY")).toBeLessThan(sequenceIndex(category, "MEDIUM"));
    }
  });
});

let nextId = 0;
function attempt(
  category: QuestionCategory,
  difficulty: QuestionDifficulty,
  state: "unanswered" | "right" | "wrong" | "waived" = "unanswered",
): StageAttempt {
  nextId++;
  return {
    id: `${category}-${difficulty}-${nextId}`,
    category,
    difficulty,
    submittedAt: state === "right" || state === "wrong" ? new Date() : null,
    isCorrect: state === "right" ? true : state === "wrong" ? false : null,
    waivedAt: state === "waived" ? new Date() : null,
  };
}

/** A whole session with every core question answered, Mediums as given. */
function coreDone(mediums: Partial<Record<QuestionCategory, "right" | "wrong">>): StageAttempt[] {
  return DIAGNOSTIC_SEQUENCE.map((s) => {
    if (s.difficulty === "EASY") return attempt(s.category, "EASY", "right");
    if (s.difficulty === "MEDIUM") return attempt(s.category, "MEDIUM", mediums[s.category] ?? "wrong");
    return attempt(s.category, "HARD");
  });
}

describe("the bonus round", () => {
  it("unlocks a category's Hard question only when its Medium was right", () => {
    const attempts = coreDone({ ALGEBRA: "right", GRAMMAR: "right" });

    const pending = pendingBonusAttempts(attempts).map((a) => a.category).sort();

    expect(pending).toEqual(["ALGEBRA", "GRAMMAR"]);
  });

  it("waives every Hard whose Medium was missed, once the core is finished", () => {
    const attempts = coreDone({ ALGEBRA: "right" });

    const waived = attemptsToWaive(attempts).map((a) => a.category);

    expect(waived).toHaveLength(6);
    expect(waived).not.toContain("ALGEBRA");
  });

  it("waives nothing while any core question is unanswered", () => {
    // A skipped Medium hasn't been missed yet. Waiving early would throw away
    // a Hard question the student might still earn.
    const attempts = coreDone({});
    const algebraMedium = attempts.find((a) => a.category === "ALGEBRA" && a.difficulty === "MEDIUM")!;
    algebraMedium.submittedAt = null;
    algebraMedium.isCorrect = null;

    expect(attemptsToWaive(attempts)).toEqual([]);
  });

  it("waives the Hard question of a category whose Medium is missing entirely", () => {
    // A content gap can leave a category without a Medium. There is nothing
    // to earn the Hard with, so it is waived rather than left hanging.
    const attempts = coreDone({}).filter((a) => !(a.category === "VOCABULARY" && a.difficulty === "MEDIUM"));

    expect(attemptsToWaive(attempts).map((a) => a.category)).toContain("VOCABULARY");
  });

  it("never waives a Hard question that was already answered", () => {
    // Only possible for a session that began under the old fixed order,
    // where the Hard question came third. Its answer stands.
    const attempts = coreDone({});
    const readingHard = attempts.find((a) => a.category === "READING_COMPREHENSION" && a.difficulty === "HARD")!;
    readingHard.submittedAt = new Date();
    readingHard.isCorrect = true;

    expect(attemptsToWaive(attempts)).not.toContain(readingHard);
  });

  it("does not waive the same question twice", () => {
    const attempts = coreDone({});
    for (const a of attemptsToWaive(attempts)) a.waivedAt = new Date();

    expect(attemptsToWaive(attempts)).toEqual([]);
  });
});

describe("diagnosticStage", () => {
  it("is CORE while any Easy or Medium question is unanswered", () => {
    const attempts = DIAGNOSTIC_SEQUENCE.map((s) => attempt(s.category, s.difficulty));
    expect(diagnosticStage(attempts)).toBe("CORE");
  });

  it("is BONUS once the core is done and a Hard question has been earned", () => {
    expect(diagnosticStage(coreDone({ ALGEBRA: "right" }))).toBe("BONUS");
  });

  it("goes straight to DONE when no Medium was right — no bonus round at all", () => {
    // The student who struggled never sees a Hard question, and never learns
    // they "unlocked nothing". They just finish at fourteen.
    expect(diagnosticStage(coreDone({}))).toBe("DONE");
  });

  it("is DONE once every earned Hard question is answered", () => {
    const attempts = coreDone({ ALGEBRA: "right" });
    const algebraHard = attempts.find((a) => a.category === "ALGEBRA" && a.difficulty === "HARD")!;
    algebraHard.submittedAt = new Date();
    algebraHard.isCorrect = false;

    expect(diagnosticStage(attempts)).toBe("DONE");
  });
});

describe("unansweredAttempts", () => {
  it("does not count a waived question as unanswered", () => {
    const attempts = [
      attempt("ALGEBRA", "EASY", "right"),
      attempt("ALGEBRA", "MEDIUM", "wrong"),
      attempt("ALGEBRA", "HARD", "waived"),
    ];

    expect(unansweredAttempts(attempts)).toEqual([]);
  });
});
