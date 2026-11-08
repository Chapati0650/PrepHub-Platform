import { describe, it, expect } from "vitest";
import { buildReport } from "./report";
import {
  buildStudentRows,
  confidencePattern,
  sortStudentRows,
  summarizeStudents,
  timeOnTask,
  type StudentItem,
  type StudentOwnInput,
  type StudentResponseInput,
} from "./student-report";
import { studentDetailRows, studentSummaryRows } from "./report-export";
import { STUDENT_REPORT } from "./config";

const mc = (right: string) => ({
  questionType: "MULTIPLE_CHOICE" as const,
  choices: ["a", "b", "c", "d"].map((id) => ({ id, isCorrect: id === right })),
  acceptedAnswers: [],
});
const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 8, 15, minute, second));

const items: StudentItem[] = [
  { id: "w", position: 0, kind: "WARMUP", label: "Warm-up", key: mc("c"), talked: false },
  { id: "q1", position: 2, kind: "CLASS", label: "Question 1", key: mc("b"), talked: false },
  { id: "q2", position: 3, kind: "CLASS", label: "Question 2", key: mc("b"), talked: true },
];

function resp(itemId: string, studentId: string, first: string | null, right: string, extra: Partial<StudentResponseInput> = {}): StudentResponseInput {
  return {
    itemId,
    studentId,
    firstAnswer: first,
    firstCorrect: first === null ? null : first === right,
    firstAt: first === null ? null : at(1),
    secondAnswer: null,
    secondCorrect: null,
    secondAt: null,
    confidence: null,
    catchUp: false,
    enteredByTeacher: false,
    ...extra,
  };
}

function own(studentId: string, position: number, answer: string | null, right: string, extra: Partial<StudentOwnInput> = {}): StudentOwnInput {
  return {
    studentId,
    position,
    bonus: false,
    key: mc(right),
    skill: "Algebra",
    difficulty: "MEDIUM",
    answer,
    isCorrect: answer === null ? null : answer === right,
    answeredAt: answer === null ? null : at(10 + position),
    retryAnswer: null,
    retryCorrect: null,
    ...extra,
  };
}

const roster = [
  { studentId: "ana", name: "Ana H." },
  { studentId: "luis", name: "Luis M." },
  { studentId: "kim", name: "Kim P." },
  { studentId: "sam", name: "Sam T." },
];
const participants = [
  { studentId: "ana", joinedAt: at(0) },
  { studentId: "luis", joinedAt: at(0) },
  { studentId: "sam", joinedAt: at(0) },
];

function rows() {
  return buildStudentRows({
    items,
    roster,
    participants,
    responses: [
      resp("w", "ana", "c", "c"),
      resp("q1", "ana", "b", "b", { confidence: "SURE", firstAt: at(2) }),
      // Changed her mind after talking: wrong then right.
      resp("q2", "ana", "c", "b", { secondAnswer: "b", secondCorrect: true, secondAt: at(4), firstAt: at(3), confidence: "GUESSING" }),
      resp("q1", "luis", "a", "b", { confidence: "SURE", firstAt: at(2) }),
      // Right then wrong after talking.
      resp("q2", "luis", "b", "b", { secondAnswer: "c", secondCorrect: false, secondAt: at(4), firstAt: at(3), confidence: "SURE" }),
      // Kim was absent and caught up later.
      resp("q1", "kim", "b", "b", { catchUp: true, firstAt: new Date(Date.UTC(2026, 10, 9, 12, 0)) }),
      resp("w", "sam", null, "c"),
      resp("q1", "sam", "d", "b", { enteredByTeacher: true, firstAt: at(2) }),
    ],
    ownSlots: [
      own("ana", 0, "a", "a"),
      own("ana", 1, "b", "a", { retryAnswer: "a", retryCorrect: true }),
      own("ana", 2, "c", "c", { bonus: true }),
      own("luis", 0, "d", "a"),
      own("luis", 1, null, "a"),
    ],
  });
}
const byId = (id: string) => rows().find((r) => r.studentId === id)!;

describe("buildStudentRows", () => {
  it("returns one row per rostered student, in roster order", () => {
    expect(rows().map((r) => r.studentId)).toEqual(["ana", "luis", "kim", "sam"]);
  });

  it("counts answers, first-try and final correctness across class and own questions", () => {
    const ana = byId("ana");
    // Warm-up right, Q1 right, Q2 wrong then right; own: 1 right, 1 wrong. Bonus left out.
    expect(ana.answered).toBe(5);
    expect(ana.firstTryRight).toBe(3);
    expect(ana.finalRight).toBe(4);
    expect(ana.firstTryPct).toBeCloseTo(3 / 5);
    expect(ana.finalPct).toBeCloseTo(4 / 5);
  });

  it("uses the second vote as final only where the room talked and voted again", () => {
    const luis = byId("luis");
    // Q1 wrong (no second vote), Q2 right then wrong, own 1 wrong, 1 unanswered.
    expect(luis.answered).toBe(3);
    expect(luis.firstTryRight).toBe(1);
    expect(luis.finalRight).toBe(0);
  });

  it("reports own-question score separately, without the bonus", () => {
    expect(byId("ana").own).toEqual({ answered: 2, right: 1, total: 2 });
    expect(byId("luis").own).toEqual({ answered: 1, right: 0, total: 2 });
  });

  it("keeps catch-up answers out of the figures but lists them in the drill-down", () => {
    const kim = byId("kim");
    expect(kim.attended).toBe(false);
    expect(kim.answered).toBe(0);
    expect(kim.caughtUp).toBe(1);
    expect(kim.firstTryPct).toBeNull();
    expect(kim.timeOnTaskMs).toBeNull();
    const q1 = kim.drill.find((d) => d.label === "Question 1")!;
    expect(q1.answer).toBe("B");
    expect(q1.notes).toContain("Caught up later");
  });

  it("lists every question in the drill-down: class, then own, with answers and results", () => {
    const ana = byId("ana");
    expect(ana.drill.map((d) => d.label)).toEqual(["Warm-up", "Question 1", "Question 2", "Own question 1", "Own question 2", "Bonus question"]);
    const q2 = ana.drill.find((d) => d.label === "Question 2")!;
    expect([q2.answer, q2.secondAnswer, q2.correctAnswer, q2.firstCorrect, q2.finalCorrect, q2.confidence]).toEqual(["C", "B", "B", false, true, "GUESSING"]);
    const retried = ana.drill.find((d) => d.label === "Own question 2")!;
    expect(retried.notes).toEqual(["Tried again later: A (right)"]);
    expect(retried.skill).toBe("Algebra");
    expect(ana.drill.find((d) => d.label === "Bonus question")!.notes).toEqual(["Bonus"]);
  });

  it("shows a question a joined student didn't answer as no answer, and notes paper answers", () => {
    const sam = byId("sam");
    expect(sam.drill.find((d) => d.label === "Warm-up")!.answer).toBeNull();
    expect(sam.drill.find((d) => d.label === "Question 1")!.notes).toEqual(["Entered by teacher"]);
    expect(sam.answered).toBe(1);
  });

  it("works for an individual practice session: no class questions at all", () => {
    const result = buildStudentRows({
      items: [],
      roster: [roster[0]],
      participants: [participants[0]],
      responses: [],
      ownSlots: [own("ana", 0, "a", "a"), own("ana", 1, "b", "a"), own("ana", 2, "a", "a")],
    });
    expect(result[0].answered).toBe(3);
    expect(result[0].own).toEqual({ answered: 3, right: 2, total: 3 });
    expect(result[0].firstTryPct).toBeCloseTo(2 / 3);
    expect(result[0].drill.every((d) => d.group === "OWN")).toBe(true);
    expect(result[0].confidencePattern).toBe("NONE");
  });

  it("times a student from joining through their answers, capping long gaps", () => {
    // Ana: joined 0:00, answers at 1:00, 2:00, 3:00, 4:00, then own at 10:00 and 11:00.
    // Own answers at 10:00, 11:00 and the bonus at 12:00. Gaps: 1,1,1,1, (6 min capped to 5), 1, 1 = 11 minutes.
    expect(byId("ana").timeOnTaskMs).toBe(11 * 60_000);
  });
});

describe("lobby warm-up answers", () => {
  const lobby = (participantRows: { studentId: string; joinedAt: Date }[]) => {
    const responses = [resp("w", "ana", "a", "c", { firstAt: at(-3) }), resp("w", "luis", "c", "c", { firstAt: at(-2) })];
    const args = {
      items,
      roster: roster.slice(0, 2),
      participants: participantRows,
      responses,
      ownSlots: [],
    };
    return { students: buildStudentRows(args), report: buildReport({ ...args, participants: participantRows.map((p) => ({ ...p, pace: null })) }) };
  };

  it("counts a warm-up answered before Start the same way the class report does", () => {
    // Answers are stamped before the students' join stamps (joined at Start), and one student has no participant row.
    const { students, report } = lobby([{ studentId: "ana", joinedAt: at(0) }]);
    const warm = report.questions.find((q) => q.itemId === "w")!;
    expect(warm.firstAnswered).toBe(2);
    for (const s of students) {
      const d = s.drill.find((x) => x.label === "Warm-up")!;
      expect(d.answer).not.toBeNull();
      expect(s.answered).toBe(1);
    }
    expect(students.find((s) => s.studentId === "ana")!.firstTryRight).toBe(0);
    expect(students.find((s) => s.studentId === "luis")!.firstTryRight).toBe(1);
    expect(students.find((s) => s.studentId === "luis")!.attended).toBe(true);
    expect(students.reduce((n, s) => n + s.answered, 0)).toBe(warm.firstAnswered);
  });
});

describe("confidence", () => {
  it("counts ratings on class questions, never the warm-up", () => {
    const ana = byId("ana");
    expect(ana.confidence).toEqual({ sure: 1, thinkSo: 0, guessing: 1, sureWrong: 0, unsureRight: 0 });
    expect(byId("luis").confidence).toMatchObject({ sure: 2, sureWrong: 1 });
  });

  it("needs enough ratings before it says anything", () => {
    expect(confidencePattern({ sure: 1, thinkSo: 1, guessing: 0, sureWrong: 1, unsureRight: 0 })).toBe("NONE");
  });
  it("flags students who are often sure and wrong, those right but unsure, and the rest as well calibrated", () => {
    const min = STUDENT_REPORT.minConfidenceRatings;
    expect(min).toBe(3);
    expect(confidencePattern({ sure: 4, thinkSo: 0, guessing: 0, sureWrong: 2, unsureRight: 0 })).toBe("SURE_BUT_WRONG");
    expect(confidencePattern({ sure: 1, thinkSo: 3, guessing: 1, sureWrong: 0, unsureRight: 3 })).toBe("RIGHT_BUT_UNSURE");
    expect(confidencePattern({ sure: 3, thinkSo: 1, guessing: 1, sureWrong: 0, unsureRight: 1 })).toBe("WELL_CALIBRATED");
  });
  it("puts sure-but-wrong ahead of right-but-unsure when both qualify", () => {
    expect(confidencePattern({ sure: 3, thinkSo: 3, guessing: 0, sureWrong: 2, unsureRight: 3 })).toBe("SURE_BUT_WRONG");
  });
});

describe("timeOnTask", () => {
  it("is null with nothing, zero with one stamp, and sums capped gaps", () => {
    expect(timeOnTask([])).toBeNull();
    expect(timeOnTask([at(0)])).toBe(0);
    expect(timeOnTask([at(3), at(0), at(1)])).toBe(3 * 60_000);
    expect(timeOnTask([at(0), at(30)], 60_000)).toBe(60_000);
  });
});

describe("summarizeStudents", () => {
  it("averages over students who were here and answered", () => {
    const summary = summarizeStudents(rows());
    expect(summary.attended).toBe(3);
    expect(summary.absent).toBe(1);
    // Ana 3/5, Luis 1/3, Sam 0/1 first try.
    expect(summary.avgFirstTryPct).toBeCloseTo((3 / 5 + 1 / 3 + 0) / 3);
    expect(summary.avgFinalPct).toBeCloseTo((4 / 5 + 0 + 0) / 3);
    // Own: Ana 1/2, Luis 0/1.
    expect(summary.avgOwnPct).toBeCloseTo((1 / 2 + 0) / 2);
    expect(summary.medianTimeOnTaskMs).not.toBeNull();
  });
  it("is empty-safe", () => {
    expect(summarizeStudents([])).toEqual({
      attended: 0,
      absent: 0,
      avgFirstTryPct: null,
      avgFinalPct: null,
      avgOwnPct: null,
      medianTimeOnTaskMs: null,
      sureButWrong: 0,
    });
  });
  it("takes the middle of an even number of times", () => {
    const base = rows();
    const timed = [
      { ...base[0], timeOnTaskMs: 60_000 },
      { ...base[1], timeOnTaskMs: 180_000 },
    ];
    expect(summarizeStudents(timed).medianTimeOnTaskMs).toBe(120_000);
  });
});

describe("sortStudentRows", () => {
  const names = (key: Parameters<typeof sortStudentRows>[1], dir: "asc" | "desc") => sortStudentRows(rows(), key, dir).map((r) => r.studentId);

  it("sorts by name", () => {
    expect(names("name", "asc")).toEqual(["ana", "kim", "luis", "sam"]);
    expect(names("name", "desc")).toEqual(["sam", "luis", "kim", "ana"]);
  });
  it("sorts by a figure, and keeps students with no value last either way", () => {
    expect(names("firstTryPct", "desc")).toEqual(["ana", "luis", "sam", "kim"]);
    expect(names("firstTryPct", "asc")).toEqual(["sam", "luis", "ana", "kim"]);
  });
  it("sorts by attendance, answers and own score", () => {
    expect(names("answered", "desc")[0]).toBe("ana");
    expect(names("attended", "desc")[3]).toBe("kim");
    expect(names("own", "desc").slice(0, 2)).toEqual(["ana", "luis"]);
  });
  it("sorts by confidence pattern (concerning first) and time", () => {
    const base = rows();
    const tagged = [
      { ...base[0], confidencePattern: "WELL_CALIBRATED" as const },
      { ...base[1], confidencePattern: "SURE_BUT_WRONG" as const },
      { ...base[2], confidencePattern: "NONE" as const },
      { ...base[3], confidencePattern: "RIGHT_BUT_UNSURE" as const },
    ];
    expect(sortStudentRows(tagged, "confidence", "asc").map((r) => r.studentId)).toEqual(["luis", "sam", "ana", "kim"]);
    expect(names("time", "desc")[0]).toBe("ana");
  });
  it("keeps roster order for ties and doesn't change the input", () => {
    const input = rows();
    sortStudentRows(input, "name", "desc");
    expect(input.map((r) => r.studentId)).toEqual(["ana", "luis", "kim", "sam"]);
  });
});

describe("CSV rows", () => {
  it("has one summary row per student under a header", () => {
    const csv = studentSummaryRows(rows());
    expect(csv).toHaveLength(5);
    expect(csv[0][0]).toBe("Student");
    expect(csv[1].slice(0, 5)).toEqual(["Ana H.", "Yes", "5", "60", "80"]);
    expect(csv[3][1]).toBe("No");
    expect(csv[3][3]).toBe("");
    expect(csv.every((row) => row.length === csv[0].length)).toBe(true);
  });
  it("flattens the drill-down to one row per student per question", () => {
    const detail = studentDetailRows(rows());
    const total = rows().reduce((n, r) => n + r.drill.length, 0);
    expect(detail).toHaveLength(total + 1);
    const q2 = detail.find((r) => r[0] === "Ana H." && r[1] === "Question 2")!;
    expect(q2).toEqual(["Ana H.", "Question 2", "", "C", "B", "B", "Wrong", "Right", "Guessing", ""]);
  });
});
