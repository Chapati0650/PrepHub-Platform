import { describe, expect, it } from "vitest";
import { describeDue } from "./homework-due";

const NOW = new Date("2026-11-08T15:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);

describe("describeDue", () => {
  it("has no urgency without a date", () => {
    expect(describeDue(null, NOW)).toEqual({ text: "No due date", tone: "none" });
  });
  it("is overdue once passed, unless it was set before joining", () => {
    expect(describeDue(at(-1), NOW)).toMatchObject({ tone: "overdue" });
    expect(describeDue(at(-1), NOW).text).toMatch(/^Was due /);
    expect(describeDue(at(-1), NOW, { setBeforeJoining: true })).toMatchObject({ tone: "later" });
  });
  it("says today, tomorrow, in N days, then a date", () => {
    expect(describeDue(at(5), NOW)).toEqual({ text: "Due today", tone: "soon" });
    expect(describeDue(at(24), NOW)).toEqual({ text: "Due today", tone: "soon" });
    expect(describeDue(at(30), NOW)).toEqual({ text: "Due tomorrow", tone: "soon" });
    expect(describeDue(at(24 * 4 - 2), NOW).text).toMatch(/^Due in 4 days · /);
    expect(describeDue(at(24 * 7), NOW).text).toMatch(/^Due in 7 days · /);
    const far = describeDue(at(24 * 20), NOW);
    expect(far.tone).toBe("later");
    expect(far.text).toMatch(/^Due /);
    expect(far.text).not.toMatch(/in \d+ days/);
  });
});
