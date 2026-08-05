import { prisma } from "@/lib/prisma";
import { computeStudyStreak } from "@/lib/dashboard/study-streak";

export type SchoolAggregateStats = {
  totalQuestionsAnswered: number;
  totalStudyHours: number;
  totalAdaptiveSessionsCompleted: number;
  totalEstimatedSatPointsImproved: number;
  activeStudentsThisWeek: number;
  studyStreak: number;
};

export type SchoolAggregateResult = {
  stats: SchoolAggregateStats;
  questionsAnsweredToday: number;
  studentsActiveToday: number;
  weeklyEstimatedSatPointsImproved: number;
  weeklyStudyHours: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (60 * 60 * 1000));
}

const EMPTY_RESULT: SchoolAggregateResult = {
  stats: {
    totalQuestionsAnswered: 0,
    totalStudyHours: 0,
    totalAdaptiveSessionsCompleted: 0,
    totalEstimatedSatPointsImproved: 0,
    activeStudentsThisWeek: 0,
    studyStreak: 0,
  },
  questionsAnsweredToday: 0,
  studentsActiveToday: 0,
  weeklyEstimatedSatPointsImproved: 0,
  weeklyStudyHours: 0,
};

// Shared by School Community (PRD-009) and Admin Overview (PRD-011 §10) so
// the two pages can never quietly disagree about what "Total Questions
// Answered" etc. means for a school. Every metric here is a cross-student
// aggregate scoped by ACTIVE `StudentMembership` rows — Administrators are
// structurally excluded (PRD-011 §7) simply because they have an
// `AdministratorAssignment`, never a `StudentMembership`, so their own
// diagnostic/practice activity is never pulled into `studentIds` at all.
export async function getSchoolAggregateStats(schoolId: string): Promise<SchoolAggregateResult> {
  const memberships = await prisma.studentMembership.findMany({
    where: { schoolId, status: "ACTIVE" },
    select: { studentId: true },
  });
  const studentIds = memberships.map((m) => m.studentId);

  if (studentIds.length === 0) return EMPTY_RESULT;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [finalizedAttempts, diagnosticAttempts, completedSets, completedDiagnostics, predictions] = await Promise.all([
    prisma.finalizedAttempt.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, finalizedAt: true },
    }),
    prisma.diagnosticAttempt.findMany({
      where: { diagnosticSession: { studentId: { in: studentIds } }, submittedAt: { not: null } },
      select: { submittedAt: true, diagnosticSession: { select: { studentId: true } } },
    }),
    prisma.practiceSet.findMany({
      where: { studentId: { in: studentIds }, status: "COMPLETED" },
      select: { studentId: true, createdAt: true, completedAt: true },
    }),
    prisma.diagnosticSession.findMany({
      where: { studentId: { in: studentIds }, status: "COMPLETED" },
      select: { studentId: true, startedAt: true, completedAt: true },
    }),
    prisma.predictionHistoryEntry.findMany({
      where: { studentId: { in: studentIds } },
      orderBy: { createdAt: "asc" },
      select: { studentId: true, representativeMidpoint: true, createdAt: true },
    }),
  ]);

  const totalQuestionsAnswered = finalizedAttempts.length + diagnosticAttempts.length;
  const totalAdaptiveSessionsCompleted = completedSets.length;

  const totalStudyHours = Math.round(
    completedSets.reduce((sum, s) => sum + hoursBetween(s.createdAt, s.completedAt!), 0) +
      completedDiagnostics.reduce((sum, d) => sum + hoursBetween(d.startedAt, d.completedAt!), 0),
  );

  const activeStudentIds = new Set<string>();
  for (const a of finalizedAttempts) if (a.finalizedAt >= weekAgo) activeStudentIds.add(a.studentId);
  for (const d of diagnosticAttempts) if (d.submittedAt! >= weekAgo) activeStudentIds.add(d.diagnosticSession.studentId);
  const activeStudentsThisWeek = activeStudentIds.size;

  // Per-student improvement: (latest - first) prediction midpoint, floored at
  // 0 so a student who regressed doesn't cancel out another's progress —
  // both pages celebrate collective accomplishment, not a net score.
  const predictionsByStudent = new Map<string, typeof predictions>();
  for (const p of predictions) {
    const list = predictionsByStudent.get(p.studentId) ?? [];
    list.push(p);
    predictionsByStudent.set(p.studentId, list);
  }
  let totalEstimatedSatPointsImproved = 0;
  let weeklyEstimatedSatPointsImproved = 0;
  for (const list of predictionsByStudent.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const latest = list[list.length - 1];
    totalEstimatedSatPointsImproved += Math.max(0, latest.representativeMidpoint - first.representativeMidpoint);

    for (let i = 1; i < list.length; i++) {
      if (list[i].createdAt >= weekAgo) {
        weeklyEstimatedSatPointsImproved += Math.max(0, list[i].representativeMidpoint - list[i - 1].representativeMidpoint);
      }
    }
  }

  const studyStreak = computeStudyStreak(
    [...finalizedAttempts.map((a) => a.finalizedAt), ...diagnosticAttempts.map((d) => d.submittedAt!)],
    now,
  );

  const questionsAnsweredToday =
    finalizedAttempts.filter((a) => a.finalizedAt >= startOfToday).length +
    diagnosticAttempts.filter((d) => d.submittedAt! >= startOfToday).length;
  const studentsActiveToday = new Set(completedSets.filter((s) => s.completedAt! >= startOfToday).map((s) => s.studentId)).size;
  const weeklyStudyHours = Math.round(
    completedSets
      .filter((s) => s.completedAt! >= weekAgo)
      .reduce((sum, s) => sum + hoursBetween(s.createdAt, s.completedAt!), 0),
  );

  return {
    stats: {
      totalQuestionsAnswered,
      totalStudyHours,
      totalAdaptiveSessionsCompleted,
      totalEstimatedSatPointsImproved,
      activeStudentsThisWeek,
      studyStreak,
    },
    questionsAnsweredToday,
    studentsActiveToday,
    weeklyEstimatedSatPointsImproved,
    weeklyStudyHours,
  };
}
