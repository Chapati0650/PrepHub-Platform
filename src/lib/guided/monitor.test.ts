import { describe, it, expect } from "vitest";
import { buildMonitor, trailingWrong, type MonitorSlotInput } from "./monitor";

const NOW = new Date("2026-11-08T15:00:00Z").getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000);
const roster = ["ana", "ben", "cy", "dee", "eli", "fay", "gus"].map((id) => ({ studentId: id, name: id }));
const present = (studentId: string, over: { joined?: number; seen?: number; hidden?: boolean } = {}) => ({
  studentId,
  joinedAt: ago(over.joined ?? 600),
  lastSeenAt: ago(over.seen ?? 3),
  hidden: over.hidden ?? false,
});
const slots = (studentId: string, results: (boolean | null)[], lastAnswerAgo = 30): MonitorSlotInput[] =>
  results.map((isCorrect, position) => ({
    studentId,
    position,
    bonus: false,
    isCorrect,
    answeredAt: isCorrect === null ? null : ago(lastAnswerAgo + (results.length - position) * 10),
    skill: `Skill ${position}`,
  }));

function run(participants: ReturnType<typeof present>[], slotList: MonitorSlotInput[]) {
  return buildMonitor({ roster, participants, slots: slotList, now: NOW });
}
const stateOf = (r: ReturnType<typeof run>, id: string) => r.rows.find((x) => x.studentId === id)!;

describe("buildMonitor states", () => {
  const result = run(
    [
      present("ana"), // working
      present("ben"), // done
      present("cy"), // three wrong in a row
      present("dee", { joined: 600 }), // here ten minutes, nothing answered
      present("eli", { seen: 60 }), // screen quiet
      present("fay", { hidden: true }), // tab hidden
    ],
    [
      ...slots("ana", [true, false, null, null]),
      ...slots("ben", [true, true, false]),
      ...slots("cy", [true, false, false, false, null]),
      ...slots("dee", [null, null]),
      ...slots("eli", [true, null]),
      ...slots("fay", [true, null]),
    ],
  );

  it("marks a student who hasn't joined", () => {
    expect(stateOf(result, "gus").state).toBe("NOT_HERE");
    expect(stateOf(result, "gus").quietMs).toBeNull();
  });
  it("marks a student working normally", () => expect(stateOf(result, "ana").state).toBe("WORKING"));
  it("marks a student done once every question is answered", () => expect(stateOf(result, "ben").state).toBe("DONE"));
  it("marks a student who has missed several in a row as needing help", () => expect(stateOf(result, "cy").state).toBe("NEEDS_HELP"));
  it("marks a student here but silent for minutes as idle, counting from joining", () => expect(stateOf(result, "dee").state).toBe("IDLE"));
  it("marks a student whose screen has gone quiet, or whose tab is hidden, as away", () => {
    expect(stateOf(result, "eli").state).toBe("AWAY");
    expect(stateOf(result, "fay").state).toBe("AWAY");
  });
});

describe("buildMonitor precedence", () => {
  it("shows done even when the student has since gone away", () => {
    const r = run([present("ana", { seen: 600 })], slots("ana", [true, true]));
    expect(stateOf(r, "ana").state).toBe("DONE");
  });
  it("shows away before needs-help and idle", () => {
    const r = run([present("ana", { seen: 600 })], slots("ana", [false, false, false, null]));
    expect(stateOf(r, "ana").state).toBe("AWAY");
  });
  it("shows needs-help before idle", () => {
    const r = run([present("ana")], slots("ana", [false, false, false, null], 900));
    expect(stateOf(r, "ana").state).toBe("NEEDS_HELP");
  });
  it("is working, not idle, just under the idle limit", () => {
    const r = buildMonitor({ roster, participants: [present("ana", { joined: 100 })], slots: slots("ana", [null]), now: NOW, idleAfterMs: 120_000 });
    expect(stateOf(r, "ana").state).toBe("WORKING");
    const late = buildMonitor({ roster, participants: [present("ana", { joined: 130 })], slots: slots("ana", [null]), now: NOW, idleAfterMs: 120_000 });
    expect(stateOf(late, "ana").state).toBe("IDLE");
  });
  it("needs a student to have been dealt questions to be done", () => {
    const r = run([present("ana", { joined: 30 })], []);
    expect(stateOf(r, "ana").state).toBe("WORKING");
    expect(stateOf(r, "ana").total).toBe(0);
  });
});

describe("buildMonitor progress and totals", () => {
  const r = run([present("ana"), present("ben"), present("cy")], [...slots("ana", [true, false, null, null]), ...slots("ben", [true, true]), ...slots("cy", [null, null])]);

  it("reports answered, correct, total and the question each student is on", () => {
    const ana = stateOf(r, "ana");
    expect([ana.answered, ana.correct, ana.total, ana.current, ana.currentSkill]).toEqual([2, 1, 4, 3, "Skill 2"]);
    expect(stateOf(r, "ben").current).toBeNull();
  });
  it("totals the class", () => {
    expect(r.totals).toMatchObject({ joined: 3, done: 1, answered: 4, correct: 3 });
    expect(r.totals.accuracy).toBeCloseTo(0.75);
  });
  it("has no accuracy before anyone answers", () => {
    expect(run([present("ana")], slots("ana", [null, null])).totals.accuracy).toBeNull();
  });
  it("ignores bonus slots", () => {
    const withBonus = run([present("ana")], [...slots("ana", [true, null]), { studentId: "ana", position: 5, bonus: true, isCorrect: true, answeredAt: ago(5) }]);
    expect(stateOf(withBonus, "ana").total).toBe(2);
  });
});

describe("trailingWrong", () => {
  it("counts only the wrong answers at the end", () => {
    expect(trailingWrong([])).toBe(0);
    expect(trailingWrong([{ isCorrect: false }, { isCorrect: true }, { isCorrect: false }, { isCorrect: false }])).toBe(2);
    expect(trailingWrong([{ isCorrect: false }, { isCorrect: true }])).toBe(0);
  });
});
