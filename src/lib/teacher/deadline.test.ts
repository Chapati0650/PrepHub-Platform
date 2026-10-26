import { describe, expect, it } from "vitest";
import { homeworkDeadline, joinedAfterDeadline, turnedInLate } from "@/lib/teacher/deadline";

const oct = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);

describe("homeworkDeadline", () => {
  it("is the due date, or the close, whichever came first", () => {
    expect(homeworkDeadline({ dueAt: oct(10), closedAt: oct(20) })).toEqual(oct(10));
    expect(homeworkDeadline({ dueAt: oct(30), closedAt: oct(12) })).toEqual(oct(12));
    expect(homeworkDeadline({ dueAt: oct(10), closedAt: null })).toEqual(oct(10));
    expect(homeworkDeadline({ dueAt: null, closedAt: oct(12) })).toEqual(oct(12));
  });

  it("is null for open homework with no due date", () => {
    expect(homeworkDeadline({ dueAt: null, closedAt: null })).toBeNull();
  });
});

describe("joinedAfterDeadline", () => {
  it("is true for a student who joined after the due date", () => {
    expect(joinedAfterDeadline(oct(15), { dueAt: oct(10), closedAt: null })).toBe(true);
  });

  it("stays true when the teacher closes the homework after the student joined", () => {
    expect(joinedAfterDeadline(oct(15), { dueAt: oct(10), closedAt: oct(20) })).toBe(true);
  });

  it("is true for a student who joined after homework with no due date was closed", () => {
    expect(joinedAfterDeadline(oct(15), { dueAt: null, closedAt: oct(12) })).toBe(true);
  });

  it("is false for a student who was in the class before the deadline", () => {
    expect(joinedAfterDeadline(oct(5), { dueAt: oct(10), closedAt: null })).toBe(false);
    expect(joinedAfterDeadline(oct(15), { dueAt: null, closedAt: oct(20) })).toBe(false);
  });

  it("is false for open homework with no due date, whenever they joined", () => {
    expect(joinedAfterDeadline(oct(25), { dueAt: null, closedAt: null })).toBe(false);
  });
});

describe("turnedInLate", () => {
  const assignment = { dueAt: oct(10), closedAt: null };

  it("is late when turned in after the due date", () => {
    expect(turnedInLate(oct(11), assignment, oct(1))).toBe(true);
    expect(turnedInLate(oct(11), assignment, null)).toBe(true);
  });

  it("isn't late on time, unfinished, or with no due date", () => {
    expect(turnedInLate(oct(9), assignment, oct(1))).toBe(false);
    expect(turnedInLate(null, assignment, oct(1))).toBe(false);
    expect(turnedInLate(oct(11), { dueAt: null, closedAt: null }, oct(1))).toBe(false);
  });

  it("is never late for a student who joined after it was due", () => {
    expect(turnedInLate(oct(20), assignment, oct(15))).toBe(false);
  });
});
