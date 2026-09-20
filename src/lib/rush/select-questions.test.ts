import { describe, it, expect } from "vitest";
import { createRandom } from "@/lib/adaptive/random";
import { selectRushQuestions, type RushCandidate } from "./select-questions";

function pool(counts: { EASY?: number; MEDIUM?: number; HARD?: number }): RushCandidate[] {
  const out: RushCandidate[] = [];
  for (const d of ["EASY", "MEDIUM", "HARD"] as const) {
    for (let i = 0; i < (counts[d] ?? 0); i++) out.push({ questionId: `${d}${i}`, questionRevisionId: `${d}${i}-rev`, difficulty: d });
  }
  return out;
}

describe("selectRushQuestions", () => {
  it("draws only from the chosen difficulty", () => {
    const picked = selectRushQuestions({ candidates: pool({ EASY: 20, MEDIUM: 20, HARD: 20 }), seenQuestionIds: new Set(), difficulty: "HARD", size: 10, random: createRandom("a") });
    expect(picked).toHaveLength(10);
    expect(picked.every((p) => p.difficulty === "HARD")).toBe(true);
  });

  it("deals a MIXED set evenly across the three difficulties", () => {
    const picked = selectRushQuestions({ candidates: pool({ EASY: 20, MEDIUM: 20, HARD: 20 }), seenQuestionIds: new Set(), difficulty: "MIXED", size: 10, random: createRandom("b") });
    expect(picked).toHaveLength(10);
    const count = (d: string) => picked.filter((p) => p.difficulty === d).length;
    // Round-robin over 10 → 4/3/3 in dealing order (E, M, H, E, M, H, E, M, H, E).
    expect(count("EASY")).toBe(4);
    expect(count("MEDIUM")).toBe(3);
    expect(count("HARD")).toBe(3);
  });

  it("fills a MIXED set from the other difficulties when one runs short", () => {
    const picked = selectRushQuestions({ candidates: pool({ EASY: 1, MEDIUM: 20, HARD: 20 }), seenQuestionIds: new Set(), difficulty: "MIXED", size: 10, random: createRandom("c") });
    expect(picked).toHaveLength(10);
    expect(picked.filter((p) => p.difficulty === "EASY")).toHaveLength(1);
  });

  it("never pads: a set is as long as the pool allows", () => {
    const picked = selectRushQuestions({ candidates: pool({ HARD: 4 }), seenQuestionIds: new Set(), difficulty: "HARD", size: 10, random: createRandom("d") });
    expect(picked).toHaveLength(4);
    expect(selectRushQuestions({ candidates: pool({ EASY: 3 }), seenQuestionIds: new Set(), difficulty: "MEDIUM", size: 10, random: createRandom("e") })).toHaveLength(0);
  });

  it("never repeats a question within a set", () => {
    const picked = selectRushQuestions({ candidates: pool({ EASY: 5, MEDIUM: 5, HARD: 5 }), seenQuestionIds: new Set(), difficulty: "MIXED", size: 10, random: createRandom("f") });
    expect(new Set(picked.map((p) => p.questionId)).size).toBe(picked.length);
  });

  it("prefers unseen questions", () => {
    const seen = new Set(Array.from({ length: 15 }, (_, i) => `HARD${i}`)); // HARD15..19 unseen
    const picked = selectRushQuestions({ candidates: pool({ HARD: 20 }), seenQuestionIds: seen, difficulty: "HARD", size: 10, random: createRandom("g") });
    const ids = new Set(picked.map((p) => p.questionId));
    for (let i = 15; i < 20; i++) expect(ids.has(`HARD${i}`)).toBe(true);
  });

  it("is reproducible from the seed", () => {
    const run = () =>
      selectRushQuestions({ candidates: pool({ EASY: 20, MEDIUM: 20, HARD: 20 }), seenQuestionIds: new Set(), difficulty: "MIXED", size: 10, random: createRandom("seed") }).map((p) => p.questionId);
    expect(run()).toEqual(run());
  });
});
