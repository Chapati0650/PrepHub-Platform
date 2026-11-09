import { describe, it, expect } from "vitest";
import { buildReport, itemLabels, reachedItem, type ReportItem, type ReportResponse } from "./report";

const mc = (right: string) => ({
  questionType: "MULTIPLE_CHOICE" as const,
  choices: ["a", "b", "c", "d"].map((id) => ({ id, isCorrect: id === right })),
  acceptedAnswers: [],
});

const items: ReportItem[] = [
  { id: "w", position: 0, kind: "WARMUP", key: mc("c"), talked: false },
  { id: "x", position: 1, kind: "EXAMPLE", key: mc("a"), talked: false },
  { id: "q1", position: 2, kind: "CLASS", key: mc("b"), talked: false },
  { id: "q2", position: 3, kind: "CLASS", key: mc("b"), talked: true },
  { id: "t2", position: 4, kind: "TWIN", key: mc("a"), talked: false },
];

function r(itemId: string, studentId: string, first: string | null, right: string, second?: string, catchUp = false): ReportResponse {
  return {
    itemId,
    studentId,
    firstAnswer: first,
    firstCorrect: first === null ? null : first === right,
    secondAnswer: second ?? null,
    secondCorrect: second === undefined ? null : second === right,
    catchUp,
  };
}

const roster = [
  { studentId: "ana", name: "Ana H." },
  { studentId: "luis", name: "Luis M." },
  { studentId: "sam", name: "Sam T." },
  { studentId: "kim", name: "Kim P." },
];

function report() {
  return buildReport({
    items,
    responses: [
      r("q2", "ana", "c", "b", "b"),
      r("q2", "luis", "c", "b", "c"),
      r("q2", "sam", "b", "b", "b"),
      r("q1", "ana", "b", "b"),
      r("q1", "luis", "a", "b"),
      // Kim was absent and caught up afterwards: not part of the room's figures.
      r("w", "kim", "c", "c", undefined, true),
      r("q1", "kim", "a", "b", undefined, true),
      r("q2", "kim", "a", "b", undefined, true),
      r("t2", "kim", "a", "a", undefined, true),
    ],
    ownSlots: [
      { studentId: "ana", isCorrect: true, bonus: false },
      { studentId: "ana", isCorrect: false, bonus: false },
      { studentId: "luis", isCorrect: false, bonus: false },
      { studentId: "luis", isCorrect: false, bonus: false },
      { studentId: "luis", isCorrect: true, bonus: true },
      { studentId: "sam", isCorrect: true, bonus: false },
      { studentId: "sam", isCorrect: null, bonus: false },
    ],
    participants: [
      { studentId: "ana", pace: "ABOUT_RIGHT" },
      { studentId: "luis", pace: "TOO_FAST" },
      { studentId: "sam", pace: null },
    ],
    roster,
  });
}

describe("itemLabels", () => {
  it("numbers class questions and names the extras", () => {
    const labels = itemLabels(items);
    expect([...labels.values()]).toEqual(["Warm-up", "Worked example", "Question 1", "Question 2", "Follow-up to question 2"]);
  });
});

describe("buildReport", () => {
  it("shows the first vote and, where the room talked, the second", () => {
    const q2 = report().questions.find((q) => q.itemId === "q2")!;
    expect(q2.firstAnswered).toBe(3);
    expect(q2.firstRight).toBeCloseTo(1 / 3);
    expect(q2.secondRight).toBeCloseTo(2 / 3);
    expect(q2.correctAnswer).toBe("B");
    expect(q2.first.kind === "choices" && q2.first.commonWrong).toBe("C");
  });

  it("has no second vote where the room didn't talk", () => {
    const q1 = report().questions.find((q) => q.itemId === "q1")!;
    expect(q1.secondAnswered).toBeNull();
    expect(q1.second).toBeNull();
    expect(q1.firstRight).toBeCloseTo(1 / 2);
  });

  it("leaves catch-up answers out of the room's figures", () => {
    const warm = report().questions.find((q) => q.itemId === "w")!;
    expect(warm.firstAnswered).toBe(0);
    expect(warm.firstRight).toBeNull();
  });

  it("skips the worked example", () => {
    expect(report().questions.map((q) => q.itemId)).not.toContain("x");
  });

  it("averages students' own questions without the bonus", () => {
    const result = report();
    // Ana 1, Luis 0, Sam 1 (one unanswered).
    expect(result.ownAverage).toBeCloseTo(2 / 3);
    expect(result.ownTotal).toBe(2);
  });

  it("names students who missed a class question and two of their own", () => {
    expect(report().checkIn.map((s) => s.studentId)).toEqual(["luis"]);
  });

  it("lists absent students and whether they caught up", () => {
    expect(report().absent).toEqual([{ student: { studentId: "kim", name: "Kim P." }, caughtUp: true }]);
  });

  it("counts the pace votes", () => {
    expect(report().pace).toEqual({ TOO_FAST: 1, ABOUT_RIGHT: 1, TOO_SLOW: 0 });
    expect(report().joined).toBe(3);
  });
});

describe("reachedItem", () => {
  const at = new Date("2026-11-05T15:00:00Z");
  it("counts the warm-up once its answer was shown", () => {
    expect(reachedItem({ kind: "WARMUP", openedAt: null, revealedAt: at })).toBe(true);
    expect(reachedItem({ kind: "WARMUP", openedAt: null, revealedAt: null })).toBe(false);
  });
  it("counts a class question or one like it once it was opened", () => {
    expect(reachedItem({ kind: "CLASS", openedAt: at, revealedAt: null })).toBe(true);
    expect(reachedItem({ kind: "TWIN", openedAt: at, revealedAt: at })).toBe(true);
  });
  it("leaves out a question the teacher skipped, and the worked example", () => {
    expect(reachedItem({ kind: "CLASS", openedAt: null, revealedAt: null })).toBe(false);
    expect(reachedItem({ kind: "EXAMPLE", openedAt: at, revealedAt: null })).toBe(false);
  });
});

describe("buildReport with a late joiner", () => {
  it("counts an answer given only on the second vote toward catching up", () => {
    const result = buildReport({
      items: [{ id: "q", position: 0, kind: "CLASS", key: mc("b"), talked: true }],
      responses: [r("q", "late", null, "b", "b")],
      ownSlots: [],
      participants: [],
      roster: [{ studentId: "late", name: "Late S." }],
    });
    expect(result.absent).toEqual([{ student: { studentId: "late", name: "Late S." }, caughtUp: true }]);
  });
});
