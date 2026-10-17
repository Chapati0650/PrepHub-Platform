import { prisma } from "@/lib/prisma";
import {
  TSI_MATH_BENCHMARK,
  TSI_READING_WRITING_BENCHMARK,
  classifyBenchmarkMovement,
  shapeOfShortfall,
  tsiStatusFromAbilities,
  type BelowBenchmarkShape,
} from "@/lib/score/ccmr";

/**
 * The campus impact report (added 2026-10-17): what the platform actually
 * moved, in the terms a Texas district is funded on.
 *
 * Privacy, which is the load-bearing constraint here (PRD-011 §7, CLAUDE.md's
 * "aggregate-only, never individual student performance"): every field below
 * is either a count or a distribution statistic. `biggestScoreGain` and
 * `topStudentStudyHours` are extremes of a distribution, not a named student
 * — the return type has no field that could carry an identity, so there is
 * nothing to accidentally leak downstream. That is the same structural
 * guarantee `getSchoolCommunityData` relies on rather than a filtering step
 * someone could later remove.
 *
 * Scope: ACTIVE `StudentMembership` at this school. An administrator has an
 * `AdministratorAssignment` and never a `StudentMembership`, so their own
 * practice is excluded for free — the same way every other school aggregate
 * excludes it.
 */
export type CampusImpact = {
  /** Students with at least two predictions, i.e. a measurable before/after. */
  measurableStudents: number;

  averageScoreGain: number | null;
  biggestScoreGain: number | null;
  /** Students whose latest prediction midpoint is above their first. */
  studentsImproved: number;

  averageStudyHours: number | null;
  topStudentStudyHours: number | null;
  /** Students who have answered at least one question. */
  activeStudents: number;

  benchmark: {
    /** Below on at least one TSI criterion at first prediction, meets both now. */
    crossed: number;
    /** Met both at first prediction and still does. */
    held: number;
    /** Met both at first prediction, no longer does. */
    slipped: number;
    /** Below at first prediction and still below. */
    below: number;
    /** Of those still below, how far: the one-criterion group is the cheapest to move. */
    shortfall: Record<BelowBenchmarkShape, number>;
    readingWritingBenchmark: number;
    mathBenchmark: number;
  };
};

const MS_PER_HOUR = 1000 * 60 * 60;

export async function getCampusImpact(schoolId: string): Promise<CampusImpact> {
  const memberships = await prisma.studentMembership.findMany({
    where: { schoolId, status: "ACTIVE" },
    select: { studentId: true },
  });
  const studentIds = memberships.map((m) => m.studentId);

  if (studentIds.length === 0) return emptyImpact();

  const [predictions, practiceSets, diagnostics] = await Promise.all([
    // Ordered so the first and last entry per student are the ends of their
    // journey. Only entries carrying both section abilities can be scored
    // against TSI, but all of them count toward the total-score gain.
    prisma.predictionHistoryEntry.findMany({
      where: { studentId: { in: studentIds } },
      orderBy: { createdAt: "asc" },
      select: {
        studentId: true,
        representativeMidpoint: true,
        readingWritingAbility: true,
        mathAbility: true,
      },
    }),
    // Study time uses the same session-level derivation the dashboard and
    // School Community already use (CLAUDE.md's "known simplification":
    // createdAt -> completedAt, since per-question timing is deliberately
    // not modelled). Keeping the same derivation means this page cannot
    // disagree with the ones beside it.
    prisma.practiceSet.findMany({
      where: { studentId: { in: studentIds }, completedAt: { not: null } },
      select: { studentId: true, createdAt: true, completedAt: true },
    }),
    // DiagnosticSession records its start as `startedAt`, not `createdAt`.
    prisma.diagnosticSession.findMany({
      where: { studentId: { in: studentIds }, completedAt: { not: null } },
      select: { studentId: true, startedAt: true, completedAt: true },
    }),
  ]);

  // --- score movement -------------------------------------------------
  const byStudent = new Map<string, typeof predictions>();
  for (const p of predictions) {
    const list = byStudent.get(p.studentId);
    if (list) list.push(p);
    else byStudent.set(p.studentId, [p]);
  }

  const gains: number[] = [];
  const benchmark = {
    crossed: 0,
    held: 0,
    slipped: 0,
    below: 0,
    shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } as Record<
      BelowBenchmarkShape,
      number
    >,
  };

  for (const entries of byStudent.values()) {
    if (entries.length < 2) continue;
    const first = entries[0];
    const latest = entries[entries.length - 1];
    gains.push(latest.representativeMidpoint - first.representativeMidpoint);

    // A prediction written before section abilities were recorded cannot be
    // scored against TSI; such a student is simply not counted in the
    // benchmark breakdown rather than guessed at.
    if (
      first.readingWritingAbility === null ||
      first.mathAbility === null ||
      latest.readingWritingAbility === null ||
      latest.mathAbility === null
    ) {
      continue;
    }

    const firstStatus = tsiStatusFromAbilities(first.readingWritingAbility, first.mathAbility);
    const latestStatus = tsiStatusFromAbilities(latest.readingWritingAbility, latest.mathAbility);

    switch (classifyBenchmarkMovement(firstStatus, latestStatus)) {
      case "CROSSED":
        benchmark.crossed++;
        break;
      case "HELD":
        benchmark.held++;
        break;
      case "SLIPPED":
        benchmark.slipped++;
        break;
      case "BELOW":
        benchmark.below++;
        break;
    }

    const shape = shapeOfShortfall(latestStatus);
    if (shape) benchmark.shortfall[shape]++;
  }

  // --- study time -----------------------------------------------------
  const hoursByStudent = new Map<string, number>();
  const timedSessions = [
    ...practiceSets.map((p) => ({ studentId: p.studentId, startedAt: p.createdAt, completedAt: p.completedAt })),
    ...diagnostics,
  ];
  for (const session of timedSessions) {
    if (!session.completedAt) continue;
    const hours = (session.completedAt.getTime() - session.startedAt.getTime()) / MS_PER_HOUR;
    // A session left open overnight would otherwise report as a 14-hour
    // sitting. Capped rather than discarded, so a long-but-real session
    // still counts for something.
    const capped = Math.min(Math.max(hours, 0), 3);
    hoursByStudent.set(session.studentId, (hoursByStudent.get(session.studentId) ?? 0) + capped);
  }

  const studyHours = [...hoursByStudent.values()];

  return {
    measurableStudents: gains.length,
    averageScoreGain: gains.length > 0 ? Math.round(average(gains)) : null,
    biggestScoreGain: gains.length > 0 ? Math.max(...gains) : null,
    studentsImproved: gains.filter((g) => g > 0).length,
    averageStudyHours: studyHours.length > 0 ? round1(average(studyHours)) : null,
    topStudentStudyHours: studyHours.length > 0 ? round1(Math.max(...studyHours)) : null,
    activeStudents: studyHours.length,
    benchmark: {
      ...benchmark,
      readingWritingBenchmark: TSI_READING_WRITING_BENCHMARK,
      mathBenchmark: TSI_MATH_BENCHMARK,
    },
  };
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyImpact(): CampusImpact {
  return {
    measurableStudents: 0,
    averageScoreGain: null,
    biggestScoreGain: null,
    studentsImproved: 0,
    averageStudyHours: null,
    topStudentStudyHours: null,
    activeStudents: 0,
    benchmark: {
      crossed: 0,
      held: 0,
      slipped: 0,
      below: 0,
      shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 },
      readingWritingBenchmark: TSI_READING_WRITING_BENCHMARK,
      mathBenchmark: TSI_MATH_BENCHMARK,
    },
  };
}
