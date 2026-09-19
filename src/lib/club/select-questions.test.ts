import { describe, it, expect } from "vitest";
import { createRandom } from "@/lib/adaptive/random";
import { selectClubQuestions, type ClubCandidate } from "./select-questions";

function pool(n: number, prefix = "q"): ClubCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ questionId: `${prefix}${i}`, questionRevisionId: `${prefix}${i}-rev` }));
}

describe("selectClubQuestions", () => {
  it("returns exactly `size` questions from a large enough pool", () => {
    const picked = selectClubQuestions({ candidates: pool(30), seenQuestionIds: new Set(), size: 10, random: createRandom("a") });
    expect(picked).toHaveLength(10);
  });

  it("never asks the same question twice in one session", () => {
    const picked = selectClubQuestions({ candidates: pool(30), seenQuestionIds: new Set(), size: 10, random: createRandom("b") });
    expect(new Set(picked.map((p) => p.questionId)).size).toBe(10);
  });

  it("shrinks to the pool size instead of padding when the pool is small", () => {
    const picked = selectClubQuestions({ candidates: pool(4), seenQuestionIds: new Set(), size: 10, random: createRandom("c") });
    expect(picked).toHaveLength(4);
  });

  it("prefers unseen questions and only reuses seen ones once unseen are exhausted", () => {
    const candidates = pool(12);
    const seen = new Set(["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"]); // 4 unseen: q8..q11
    const picked = selectClubQuestions({ candidates, seenQuestionIds: seen, size: 6, random: createRandom("d") });
    const ids = new Set(picked.map((p) => p.questionId));
    // All 4 unseen must be present; the remaining 2 come from seen.
    for (const id of ["q8", "q9", "q10", "q11"]) expect(ids.has(id)).toBe(true);
    expect(picked).toHaveLength(6);
    expect([...ids].filter((id) => seen.has(id))).toHaveLength(2);
  });

  it("uses only unseen questions when there are enough of them", () => {
    const candidates = pool(20);
    const seen = new Set(["q0", "q1", "q2"]);
    const picked = selectClubQuestions({ candidates, seenQuestionIds: seen, size: 10, random: createRandom("e") });
    expect(picked.some((p) => seen.has(p.questionId))).toBe(false);
  });

  it("is reproducible for the same seed and differs across seeds", () => {
    const a1 = selectClubQuestions({ candidates: pool(40), seenQuestionIds: new Set(), size: 10, random: createRandom("seed-1") });
    const a2 = selectClubQuestions({ candidates: pool(40), seenQuestionIds: new Set(), size: 10, random: createRandom("seed-1") });
    const b = selectClubQuestions({ candidates: pool(40), seenQuestionIds: new Set(), size: 10, random: createRandom("seed-2") });
    expect(a1.map((p) => p.questionId)).toEqual(a2.map((p) => p.questionId));
    expect(a1.map((p) => p.questionId)).not.toEqual(b.map((p) => p.questionId));
  });

  it("de-duplicates candidates passed in twice", () => {
    const dup = [...pool(5), ...pool(5)];
    const picked = selectClubQuestions({ candidates: dup, seenQuestionIds: new Set(), size: 10, random: createRandom("f") });
    expect(picked).toHaveLength(5);
  });

  it("returns nothing for an empty pool or a non-positive size", () => {
    expect(selectClubQuestions({ candidates: [], seenQuestionIds: new Set(), size: 10, random: createRandom("g") })).toEqual([]);
    expect(selectClubQuestions({ candidates: pool(5), seenQuestionIds: new Set(), size: 0, random: createRandom("g") })).toEqual([]);
  });

  it("carries each question's pinned revision id through untouched", () => {
    const picked = selectClubQuestions({ candidates: pool(3), seenQuestionIds: new Set(), size: 3, random: createRandom("h") });
    for (const p of picked) expect(p.questionRevisionId).toBe(`${p.questionId}-rev`);
  });
});
