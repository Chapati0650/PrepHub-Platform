import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_STUDENTS_FOR_SCORE_FIGURES,
  getCampusImpact,
  measureCampusImpact,
  protectCampusImpact,
  type CampusImpact,
} from "@/lib/admin/impact";
import { flattenSql } from "@/lib/school/test-fixtures";
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
    // Study time reads the shared session fragment, so the table names are
    // inside a nested fragment; the outer query is recognised by its columns.
    if (sql.includes('AS "averageHours"')) return Promise.resolve(studyTimeRows());
    throw new Error(`unexpected query: ${sql}`);
  });
});

function givenPredictions(rows: Prediction[]) {
  predictions = rows;
}

function givenSessions(rows: Session[]) {
  sessions = rows;
}

describe("measureCampusImpact", () => {
  it("returns a zeroed report for a school with no active students", async () => {
    const impact = await measureCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(0);
    expect(impact.averageScoreGain).toBeNull();
    expect(impact.biggestScoreGain).toBeNull();
    expect(impact.activeStudents).toBe(0);
    expect(impact.averageStudyHours).toBeNull();
    expect(impact.benchmark.crossed).toBe(0);
  });

  it("scopes every query to ACTIVE memberships at the requested school", async () => {
    await measureCampusImpact("school-1");

    expect(mocked.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of mocked.$queryRaw.mock.calls) {
      const { text, values } = flattenSql(call);
      // The school filter is a bound parameter, never interpolated text.
      expect(text).toContain('m."schoolId" =');
      expect(text).toContain(`m."status" = 'ACTIVE'`);
      expect(values).toContain("school-1");
    }
  });

  it("counts study time from every kind of finished session, the same definition as the school's total hours", async () => {
    await measureCampusImpact("school-1");

    const studyQuery = mocked.$queryRaw.mock.calls
      .map((call) => flattenSql(call).text)
      .find((text) => text.includes('AS "averageHours"'));
    for (const table of ["practice_sets", "diagnostic_sessions", "focused_sessions", "club_sessions", "rush_runs", "homework_sessions"]) {
      expect(studyQuery).toContain(table);
    }
  });

  it("ignores a student with only one prediction - there is no before/after", async () => {
    givenPredictions([prediction("s1", 1000, LOW, LOW)]);
    const impact = await measureCampusImpact("school-1");
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
    const impact = await measureCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(2);
    expect(impact.averageScoreGain).toBe(150);
    expect(impact.biggestScoreGain).toBe(200);
    expect(impact.studentsImproved).toBe(2);
  });

  it("counts a decline without letting it masquerade as improvement", async () => {
    givenPredictions([prediction("s1", 1200, LOW, LOW), prediction("s1", 1100, LOW, LOW)]);
    const impact = await measureCampusImpact("school-1");
    expect(impact.averageScoreGain).toBe(-100);
    expect(impact.studentsImproved).toBe(0);
  });

  it("counts a student who started below both criteria and now meets both as CROSSED", async () => {
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1200, HIGH, HIGH)]);
    const impact = await measureCampusImpact("school-1");
    expect(impact.benchmark.crossed).toBe(1);
    expect(impact.benchmark.held).toBe(0);
  });

  it("does not count a student who improved but still misses a criterion", async () => {
    // Reading clears, math does not — the common shape, and worth nothing
    // to the district until the math criterion is also met.
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1100, HIGH, LOW)]);
    const impact = await measureCampusImpact("school-1");
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
    const impact = await measureCampusImpact("school-1");
    expect(impact.benchmark.held).toBe(1);
    expect(impact.benchmark.slipped).toBe(1);
    expect(impact.benchmark.below).toBe(1);
  });

  it("skips benchmark classification when section abilities were never recorded", async () => {
    givenPredictions([prediction("s1", 900, null, null), prediction("s1", 1200, null, null)]);
    const impact = await measureCampusImpact("school-1");
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
    const impact = await measureCampusImpact("school-1");
    expect(impact.activeStudents).toBe(2);
    expect(impact.topStudentStudyHours).toBe(1);
    expect(impact.averageStudyHours).toBe(1);
  });

  it("caps an abandoned session rather than reporting it as a day of study", async () => {
    givenSessions([practiceSetSession("s1", 14 * 60)]);
    const impact = await measureCampusImpact("school-1");
    expect(impact.topStudentStudyHours).toBe(3);
  });

  it("exposes no field that could identify an individual student", async () => {
    givenPredictions([prediction("s1", 900, LOW, LOW), prediction("s1", 1200, HIGH, HIGH)]);
    givenSessions([practiceSetSession("s1", 30)]);
    const impact = await measureCampusImpact("school-1");
    const serialized = JSON.stringify(impact);
    expect(serialized).not.toContain("s1");
    expect(serialized).not.toContain("studentId");
  });
});

describe("getCampusImpact (what an administrator sees)", () => {
  /** `n` students who each gained `gain` points, at section scores that cross the benchmark. */
  function cohort(prefix: string, n: number, gain: number, [fromRw, fromMath, toRw, toMath] = [LOW, LOW, HIGH, HIGH]) {
    return Array.from({ length: n }, (_, i) => [
      prediction(`${prefix}${i}`, 1000, fromRw, fromMath, new Date("2026-01-01")),
      prediction(`${prefix}${i}`, 1000 + gain, toRw, toMath, new Date("2026-02-01")),
    ]).flat();
  }

  it("withholds score growth and readiness until enough students can be measured", async () => {
    // One student: "1 of 1 improved" and the average would both be their own score change.
    givenPredictions(cohort("s", 1, 120));
    const impact = await getCampusImpact("school-1");
    expect(impact.measurableStudents).toBe(1);
    expect(impact.scoreGrowth).toBeNull();
    expect(impact.benchmark).toBeNull();
    expect(JSON.stringify(impact)).not.toContain("120");
  });

  it("shows them once the threshold is met, with any group under five withheld", async () => {
    givenPredictions([
      ...cohort("up", MIN_STUDENTS_FOR_SCORE_FIGURES - 2, 100),
      // Two who fell back: a group small enough to point at someone.
      ...cohort("down", 2, -50, [HIGH, HIGH, LOW, LOW]),
    ]);
    const impact = await getCampusImpact("school-1");

    expect(impact.scoreGrowth).toEqual({ studentsImproved: 8, averageScoreGain: 70, biggestScoreGain: 100 });
    expect(impact.benchmark).toMatchObject({ measured: 10, crossed: 8, held: 0, slipped: null, below: 0 });
  });

  it("withholds a small count of students who improved", () => {
    const raw: CampusImpact = {
      measurableStudents: 12,
      averageScoreGain: -5,
      biggestScoreGain: 40,
      studentsImproved: 3,
      averageStudyHours: 2,
      topStudentStudyHours: 3,
      activeStudents: 12,
      benchmark: {
        crossed: 0,
        held: 0,
        slipped: 0,
        below: 0,
        shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 },
        readingWritingBenchmark: 480,
        mathBenchmark: 530,
      },
    };
    const report = protectCampusImpact(raw);
    expect(report.scoreGrowth?.studentsImproved).toBeNull();
    // Nobody placed against the benchmark: the section is withheld, not shown as zeros.
    expect(report.benchmark).toBeNull();
  });
});
