import { describe, expect, it } from "vitest";
import { answerBreakdown, answerLabel, correctLabel, mostMissedPositions, type AssignedQuestionKey } from "./answer-stats";

const mc: AssignedQuestionKey = {
  questionType: "MULTIPLE_CHOICE",
  choices: [
    { id: "a", isCorrect: false },
    { id: "b", isCorrect: true },
    { id: "c", isCorrect: false },
    { id: "d", isCorrect: false },
  ],
  acceptedAnswers: [],
};
const gridIn: AssignedQuestionKey = { questionType: "OPEN_ENDED_NUMERIC", choices: [], acceptedAnswers: ["3/4", ".75"] };

const picks = (...ids: (string | null)[]) => ids.map((answer) => ({ answer, isCorrect: answer === "b" }));

describe("answerLabel / correctLabel", () => {
  it("names a choice by its letter and a grid-in by what was typed", () => {
    expect(answerLabel(mc, "c")).toBe("C");
    expect(answerLabel(mc, "zzz")).toBe("");
    expect(answerLabel(mc, null)).toBe("");
    expect(answerLabel(gridIn, " 0.7 ")).toBe("0.7");
    expect(correctLabel(mc)).toBe("B");
    expect(correctLabel(gridIn)).toBe("3/4");
  });
});

describe("answerBreakdown", () => {
  it("counts every choice and names the wrong one most of the class chose", () => {
    const result = answerBreakdown(mc, picks("b", "c", "c", "c", "a", null));
    expect(result).toEqual({
      kind: "choices",
      answered: 5,
      commonWrong: "C",
      choices: [
        { label: "A", count: 1, correct: false },
        { label: "B", count: 1, correct: true },
        { label: "C", count: 3, correct: false },
        { label: "D", count: 0, correct: false },
      ],
    });
  });

  it("calls no wrong answer common when it's a single pick or a tie", () => {
    expect(answerBreakdown(mc, picks("b", "a"))).toMatchObject({ commonWrong: null });
    expect(answerBreakdown(mc, picks("a", "a", "c", "c"))).toMatchObject({ commonWrong: null });
  });

  it("groups a grid-in's wrong entries, most common first", () => {
    const result = answerBreakdown(gridIn, [
      { answer: "3/4", isCorrect: true },
      { answer: "4/3", isCorrect: false },
      { answer: " 4/3", isCorrect: false },
      { answer: "1", isCorrect: false },
      { answer: null, isCorrect: null },
    ]);
    expect(result).toEqual({
      kind: "entries",
      correctAnswer: "3/4",
      correctCount: 1,
      answered: 4,
      wrong: [
        { value: "4/3", count: 2 },
        { value: "1", count: 1 },
      ],
    });
  });
});

describe("mostMissedPositions", () => {
  it("picks at most two of the worst questions below 70% right", () => {
    const stats = [
      { position: 0, answered: 10, correct: 9 },
      { position: 1, answered: 10, correct: 3 },
      { position: 2, answered: 10, correct: 5 },
      { position: 3, answered: 10, correct: 4 },
      { position: 4, answered: 2, correct: 0 }, // too few answers to mean anything
    ];
    expect([...mostMissedPositions(stats)]).toEqual([1, 3]);
  });

  it("flags nothing when the class did well everywhere", () => {
    expect(mostMissedPositions([{ position: 0, answered: 10, correct: 8 }]).size).toBe(0);
  });
});
