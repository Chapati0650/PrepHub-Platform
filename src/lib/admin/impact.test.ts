import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCampusImpact } from "@/lib/admin/impact";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

const mocked = prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> };

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
// letting one shape silently stand in for the other — even though both reach
// the same SQL union now, the production query reads a different column for
// each.
function practiceSetSession(studentId: string, minutes: number) {
  return {
    studentId,
    startedAt: SESSION_START,
    completedAt: new Date(SESSION_START.getTime() + minutes * 60_000),
  };
}

const diagnosticSession = practiceSetSession;

type Prediction = ReturnType<typeof prediction>;
type Session = ReturnType<typeof practiceSetSession>;

// Both campus-impact queries are raw SQL, because the point of them is that
// neither a student's prediction history nor their session rows cross the wire
// (see the comments in impact.ts). These tests still want to describe the
// fixtures as rows, so the mock derives from a readable fixture exactly what
// Postgres would have returned — the first/last-per-student pair and the
// per-student study-hour aggregate — and routes on which table the SQL names.
let predictions: Prediction[] = [];
let sessions: Session[] = [];

const SESSION_HOUR_CAP = 3;

function groupByStudent<T extends { studentId: string }>(rows: T[]): Map<string, T[]> {
  const byStudent = new Map<string, T[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId);
    if (list) list.push(row);
    else byStudent.set(row.studentId, [row]);
  }
  return byStudent;
}

/** What the ROW_NUMBER()/COUNT(*) OVER query returns for `predictions`. */
function predictionEndRows() {
  const rows: Record<string, number | null>[] = [];
  for (const entries of groupByStudent(predictions).values()) {
    if (entries.length < 2) continue; // `entry_count > 1` in SQL
    const ordered = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    rows.push({
      firstMidpoint: first.representativeMidpoint,
      firstRw: first.readingWritingAbility,
      firstMath: first.mathAbility,
      lastMidpoint: last.representativeMidpoint,
      lastRw: last.readingWritingAbility,
      lastMath: last.mathAbility,
    });
  }
  return rows;
}

/** What the per-student SUM / AVG / MAX query returns for `sessions`. */
function studyTimeRows() {
  const hoursByStudent = new Map<string, number>();
  for (const session of sessions) {
    const hours = (session.completedAt.getTime() - session.startedAt.getTime()) / 3_600_000;
    const capped = Math.min(Math.max(hours, 0), SESSION_HOUR_CAP);
    hoursByStudent.set(session.studentId, (hoursByStudent.get(session.studentId) ?? 0) + capped);
  }
  const hours = [...hoursByStudent.values()];
  return [
    {
      activeStudents: hours.length,
      averageHours: hours.length > 0 ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
      topHours: hours.length > 0 ? Math.max(...hours) : null,
    },
  ];
}

function sqlTextOf(call: unknown[]): string {
  return Array.from(call[0] as ArrayLike<string>).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  predictions = [];
  sessions = [];
  mocked.$queryRaw.mockImplementation((...call: unknown[]) => {
    const sql = sqlTextOf(call);
    if (sql.includes("prediction_history_entries")) return Promise.resolve(predictionEndRows());
    if (sql.includes("practice_sets")) return Promise.resolve(studyTimeRows());
    throw new Error(`unexpected query: ${sql}`);
  });
});

function givenPredictions(rows: Prediction[]) {
  predictions = rows;
}

function givenSessions(rows: Session[]) {
  sessions = rows;
}

describe("getCampusImpact", () => {
  it("returns a zeroed report for a school with no active students", async () => {
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(0);
    expect(impact.averageScoreGain).toBeNull();
    expect(impact.biggestScoreGain).toBeNull();
    expect(impact.activeStudents).toBe(0);
    expect(impact.averageStudyHours).toBeNull();
    expect(impact.benchmark.crossed).toBe(0);
  });

  it("scopes every query to ACTIVE memberships at the requested school", async () => {
    await getCampusImpact("school-1");

    expect(mocked.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of mocked.$queryRaw.mock.calls) {
      const sql = sqlTextOf(call);
      // The school filter is a bound parameter, never interpolated text.
      expect(sql).toContain('m."schoolId" =');
      expect(sql).toContain(`m."status" = 'ACTIVE'`);
      expect(call).toContain("school-1");
    }
  });

  it("ignores a student with only one prediction - there is no before/after", async () => {
    givenPredictions([prediction("s1", 1000, LOW, LOW)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(0);
    expect(impact.averageScoreGain).toBeNull();
  });

  it("averages gains across students and reports the largest", async () => {
    givenPredictions([
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
    givenPredictions([prediction("s1", 1200, LOW, LOW), prediction("s1", 1100, LOW, LOW)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.averageScoreGain).toBe(-100);
    expect(impact.studentsImproved).toBe(0);
  });

  it("counts a student who started below both criteria and now meets both as CROSSED", async () => {
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1200, HIGH, HIGH)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.benchmark.crossed).toBe(1);
    expect(impact.benchmark.held).toBe(0);
  });

  it("does not count a student who improved but still misses a criterion", async () => {
    // Reading clears, math does not — the common shape, and worth nothing
    // to the district until the math criterion is also met.
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1100, HIGH, LOW)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.benchmark.crossed).toBe(0);
    expect(impact.benchmark.below).toBe(1);
    expect(impact.benchmark.shortfall.MISSES_MATH_ONLY).toBe(1);
  });

  it("separates held, slipped and below", async () => {
    givenPredictions([
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
    givenPredictions([prediction("s1", 900, null, null), prediction("s1", 1200, null, null)]);
    const impact = await getCampusImpact("school-1");
    // The gain is still measurable even though TSI status is not.
    expect(impact.averageScoreGain).toBe(300);
    expect(impact.benchmark.crossed + impact.benchmark.held + impact.benchmark.below).toBe(0);
  });

  it("sums study time per student and reports the average and the top", async () => {
    givenSessions([
      practiceSetSession("s1", 30),
      practiceSetSession("s1", 30),
      diagnosticSession("s2", 60),
    ]);
    const impact = await getCampusImpact("school-1");
    expect(impact.activeStudents).toBe(2);
    expect(impact.topStudentStudyHours).toBe(1);
    expect(impact.averageStudyHours).toBe(1);
  });

  it("caps an abandoned session rather than reporting it as a day of study", async () => {
    givenSessions([practiceSetSession("s1", 14 * 60)]);
    const impact = await getCampusImpact("school-1");
    expect(impact.topStudentStudyHours).toBe(3);
  });

  it("exposes no field that could identify an individual student", async () => {
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1200, HIGH, HIGH)]);
    givenSessions([practiceSetSession("s1", 30)]);
    const impact = await getCampusImpact("school-1");
    const serialized = JSON.stringify(impact);
    expect(serialized).not.toContain("s1");
    expect(serialized).not.toContain("studentId");
  });
});
