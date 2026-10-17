import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCampusImpact } from "@/lib/admin/impact";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studentMembership: { findMany: vi.fn() },
    predictionHistoryEntry: { findMany: vi.fn() },
    practiceSet: { findMany: vi.fn() },
    diagnosticSession: { findMany: vi.fn() },
  },
}));

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
};

// Abilities chosen against the section thresholds in lib/score/ccmr:
// ability 10 -> 262 per section (below both), ability 50 -> 582 (above both),
// ability 20 -> 302, ability 95 -> 782.
const LOW = 10;
const HIGH = 50;

function prediction(
  studentId: string,
  midpoint: number,
  rw: number | null,
  math: number | null,
  createdAt = new Date("2026-01-01"),
) {
  return {
    studentId,
    representativeMidpoint: midpoint,
    readingWritingAbility: rw,
    mathAbility: math,
    createdAt,
  };
}

const SESSION_START = new Date("2026-02-01T10:00:00Z");

// PracticeSet records its start as `createdAt`; DiagnosticSession as
// `startedAt`. The two helpers keep that difference explicit rather than
// letting one shape silently stand in for the other.
function practiceSetSession(studentId: string, minutes: number) {
  return {
    studentId,
    createdAt: SESSION_START,
    completedAt: new Date(SESSION_START.getTime() + minutes * 60_000),
  };
}

function diagnosticSession(studentId: string, minutes: number) {
  return {
    studentId,
    startedAt: SESSION_START,
    completedAt: new Date(SESSION_START.getTime() + minutes * 60_000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.studentMembership.findMany.mockResolvedValue([]);
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
  mocked.practiceSet.findMany.mockResolvedValue([]);
  mocked.diagnosticSession.findMany.mockResolvedValue([]);
});

function withStudents(ids: string[]) {
  mocked.studentMembership.findMany.mockResolvedValue(ids.map((studentId) => ({ studentId })));
}

describe("getCampusImpact", () => {
  it("returns a zeroed report for a school with no active students", async () => {
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(0);
    expect(impact.averageScoreGain).toBeNull();
    expect(impact.biggestScoreGain).toBeNull();
    expect(impact.benchmark.crossed).toBe(0);
  });

  it("scopes to ACTIVE memberships at the requested school", async () => {
    withStudents(["s1"]);
    await getCampusImpact("school-1");
    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith({
      where: { schoolId: "school-1", status: "ACTIVE" },
      select: { studentId: true },
    });
  });

  it("ignores a student with only one prediction - there is no before/after", async () => {
    withStudents(["s1"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 1000, LOW, LOW),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(0);
    expect(impact.averageScoreGain).toBeNull();
  });

  it("averages gains across students and reports the largest", async () => {
    withStudents(["s1", "s2"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 1000, LOW, LOW),
      prediction("s1", 1100, LOW, LOW), // +100
      prediction("s2", 1200, LOW, LOW),
      prediction("s2", 1400, LOW, LOW), // +200
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(2);
    expect(impact.averageScoreGain).toBe(150);
    expect(impact.biggestScoreGain).toBe(200);
    expect(impact.studentsImproved).toBe(2);
  });

  it("counts a decline without letting it masquerade as improvement", async () => {
    withStudents(["s1"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 1200, LOW, LOW),
      prediction("s1", 1100, LOW, LOW),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.averageScoreGain).toBe(-100);
    expect(impact.studentsImproved).toBe(0);
  });

  it("counts a student who started below both criteria and now meets both as CROSSED", async () => {
    withStudents(["s1"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 900, LOW, LOW),
      prediction("s1", 1200, HIGH, HIGH),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.benchmark.crossed).toBe(1);
    expect(impact.benchmark.held).toBe(0);
  });

  it("does not count a student who improved but still misses a criterion", async () => {
    withStudents(["s1"]);
    // Reading clears, math does not — the common shape, and worth nothing
    // to the district until the math criterion is also met.
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 900, LOW, LOW),
      prediction("s1", 1100, HIGH, LOW),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.benchmark.crossed).toBe(0);
    expect(impact.benchmark.below).toBe(1);
    expect(impact.benchmark.shortfall.MISSES_MATH_ONLY).toBe(1);
  });

  it("separates held, slipped and below", async () => {
    withStudents(["held", "slipped", "below"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("held", 1300, HIGH, HIGH),
      prediction("held", 1350, HIGH, HIGH),
      prediction("slipped", 1300, HIGH, HIGH),
      prediction("slipped", 900, LOW, LOW),
      prediction("below", 900, LOW, LOW),
      prediction("below", 950, LOW, LOW),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.benchmark.held).toBe(1);
    expect(impact.benchmark.slipped).toBe(1);
    expect(impact.benchmark.below).toBe(1);
  });

  it("skips benchmark classification when section abilities were never recorded", async () => {
    withStudents(["s1"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 900, null, null),
      prediction("s1", 1200, null, null),
    ]);
    const impact = await getCampusImpact("school-1");
    // The gain is still measurable even though TSI status is not.
    expect(impact.averageScoreGain).toBe(300);
    expect(impact.benchmark.crossed + impact.benchmark.held + impact.benchmark.below).toBe(0);
  });

  it("sums study time per student and reports the average and the top", async () => {
    withStudents(["s1", "s2"]);
    mocked.practiceSet.findMany.mockResolvedValue([practiceSetSession("s1", 30), practiceSetSession("s1", 30)]);
    mocked.diagnosticSession.findMany.mockResolvedValue([diagnosticSession("s2", 60)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.activeStudents).toBe(2);
    expect(impact.topStudentStudyHours).toBe(1);
    expect(impact.averageStudyHours).toBe(1);
  });

  it("caps an abandoned session rather than reporting it as a day of study", async () => {
    withStudents(["s1"]);
    mocked.practiceSet.findMany.mockResolvedValue([practiceSetSession("s1", 14 * 60)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.topStudentStudyHours).toBe(3);
  });

  it("exposes no field that could identify an individual student", async () => {
    withStudents(["s1"]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("s1", 900, LOW, LOW),
      prediction("s1", 1200, HIGH, HIGH),
    ]);
    const impact = await getCampusImpact("school-1");
    const serialized = JSON.stringify(impact);
    expect(serialized).not.toContain("s1");
    expect(serialized).not.toContain("studentId");
  });
});
