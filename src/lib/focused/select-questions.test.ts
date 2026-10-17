import { describe, expect, it } from "vitest";
import type { QuestionDifficulty } from "@/generated/prisma/client";
import { createRandom } from "@/lib/adaptive/random";
import { selectFocusedQuestions, type FocusedCandidate } from "./select-questions";

function candidate(id: string, difficulty: QuestionDifficulty): FocusedCandidate {
  return { questionId: id, questionRevisionId: `${id}-rev`, difficulty };
}

function pool(prefix: string, difficulty: QuestionDifficulty, count: number) {
  return Array.from({ length: count }, (_, i) => candidate(`${prefix}${i}`, difficulty));
}

const random = () => createRandom("seed")();

describe("selectFocusedQuestions", () => {
  it("returns nothing for a non-positive size", () => {
    expect(
      selectFocusedQuestions({
        candidates: pool("e", "EASY", 5),
        seenQuestionIds: new Set(),
        difficulty: "EASY",
        size: 0,
        random: createRandom("a"),
      }),
    ).toEqual([]);
  });

  it("draws only from the chosen difficulty", () => {
    const picked = selectFocusedQuestions({
      candidates: [...pool("e", "EASY", 10), ...pool("m", "MEDIUM", 10), ...pool("h", "HARD", 10)],
      seenQuestionIds: new Set(),
      difficulty: "HARD",
      size: 10,
      random: createRandom("a"),
    });
    expect(picked).toHaveLength(10);
    expect(picked.every((c) => c.difficulty === "HARD")).toBe(true);
  });

  it("never pads beyond the available pool", () => {
    const picked = selectFocusedQuestions({
      candidates: pool("e", "EASY", 3),
      seenQuestionIds: new Set(),
      difficulty: "EASY",
      size: 10,
      random: createRandom("a"),
    });
    expect(picked).toHaveLength(3);
  });

  it("never repeats a question inside one session", () => {
    const picked = selectFocusedQuestions({
      candidates: [...pool("e", "EASY", 4), ...pool("m", "MEDIUM", 4), ...pool("h", "HARD", 4)],
      seenQuestionIds: new Set(),
      difficulty: "MIXED",
      size: 10,
      random: createRandom("a"),
    });
    expect(new Set(picked.map((c) => c.questionId)).size).toBe(picked.length);
  });

  it("prefers unseen questions before reusing seen ones", () => {
    const candidates = pool("e", "EASY", 6);
    const seen = new Set(["e0", "e1", "e2", "e3"]);
    const picked = selectFocusedQuestions({
      candidates,
      seenQuestionIds: seen,
      difficulty: "EASY",
      size: 2,
      random: createRandom("a"),
    });
    // Exactly two unseen exist (e4, e5) and the session is two long, so both
    // picks must be the unseen ones.
    expect(picked.map((c) => c.questionId).sort()).toEqual(["e4", "e5"]);
  });

  it("spreads a MIXED session across all three difficulties rather than one", () => {
    // Easy dominates the bank 30:5:5 — a naive sample would come out almost
    // all Easy, which is the exact failure the round-robin deal prevents.
    const picked = selectFocusedQuestions({
      candidates: [...pool("e", "EASY", 30), ...pool("m", "MEDIUM", 5), ...pool("h", "HARD", 5)],
      seenQuestionIds: new Set(),
      difficulty: "MIXED",
      size: 9,
      random: createRandom("a"),
    });
    const counts = { EASY: 0, MEDIUM: 0, HARD: 0 } as Record<QuestionDifficulty, number>;
    for (const c of picked) counts[c.difficulty]++;
    expect(picked).toHaveLength(9);
    expect(counts.EASY).toBe(3);
    expect(counts.MEDIUM).toBe(3);
    expect(counts.HARD).toBe(3);
  });

  it("lets the other difficulties fill in when one runs short on MIXED", () => {
    const picked = selectFocusedQuestions({
      candidates: [...pool("e", "EASY", 10), ...pool("m", "MEDIUM", 10), ...pool("h", "HARD", 1)],
      seenQuestionIds: new Set(),
      difficulty: "MIXED",
      size: 10,
      random: createRandom("a"),
    });
    const hard = picked.filter((c) => c.difficulty === "HARD");
    expect(picked).toHaveLength(10);
    expect(hard).toHaveLength(1);
  });

  it("de-duplicates a candidate supplied twice", () => {
    const dupe = candidate("e0", "EASY");
    const picked = selectFocusedQuestions({
      candidates: [dupe, dupe, candidate("e1", "EASY")],
      seenQuestionIds: new Set(),
      difficulty: "EASY",
      size: 10,
      random: createRandom("a"),
    });
    expect(picked).toHaveLength(2);
  });

  it("is reproducible from the same seed", () => {
    const args = {
      candidates: [...pool("e", "EASY", 20), ...pool("m", "MEDIUM", 20)],
      seenQuestionIds: new Set<string>(),
      difficulty: "MIXED" as const,
      size: 10,
    };
    const a = selectFocusedQuestions({ ...args, random: createRandom("same") });
    const b = selectFocusedQuestions({ ...args, random: createRandom("same") });
    expect(a.map((c) => c.questionId)).toEqual(b.map((c) => c.questionId));
  });

  it("returns nothing when the category has no published questions", () => {
    expect(
      selectFocusedQuestions({
        candidates: [],
        seenQuestionIds: new Set(),
        difficulty: "MIXED",
        size: 10,
        random,
      }),
    ).toEqual([]);
  });
});
