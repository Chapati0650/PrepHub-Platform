import { prisma } from "@/lib/prisma";
import { cappedHours, schoolSessionActivity } from "@/lib/school/student-activity";
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
 * Scope: ACTIVE `StudentMembership` at this school, applied as a join inside
 * each query rather than as a list of ids fetched first. An administrator has
 * an `AdministratorAssignment` and never a `StudentMembership`, so their own
 * practice is excluded for free — the same way every other school aggregate
 * excludes it. `StudentMembership.studentId` is `@unique`, so the join can
 * never duplicate a student's rows.
 *
 * Both queries are written so the number of rows crossing the wire depends on
 * the number of *students*, not on how much they have practiced. The first
 * version loaded every prediction row and every completed session row for
 * every student in order to compute six numbers; for a 2,000-student district
 * that is six figures of rows for a page that renders a dozen integers.
 *
 * Counts and extremes are not enough on their own, though (2026-10-26). With
 * one measurable student, "1 of 1 improved", the average gain and the biggest
 * gain are all that student's own score change, and the Students page lists
 * who has finished a Practice Set — so an administrator could tell exactly
 * whose prediction moved and by how much (PRD-011 §21). `getCampusImpact`
 * therefore returns `CampusImpactReport`, where the score figures are withheld
 * below a minimum group size; the unprotected `measureCampusImpact` is only
 * ever read through it.
 */

/**
 * Score growth and college readiness appear only once this many students have
 * a first and a latest prediction to compare. Below it, an average or a
 * "biggest gain" is one or two students' own results, and the Students page
 * says who those students are likely to be.
 */
export const MIN_STUDENTS_FOR_SCORE_FIGURES = 10;

/**
 * Any group smaller than this ("Fell back: 2", "Students improved: 1") is
 * shown as "fewer than 5" rather than a number, the usual small-cell rule for
 * student data. Zero is still shown: it describes nobody.
 */
export const MIN_GROUP_SIZE = 5;

/** A group's size, or null when it is between 1 and MIN_GROUP_SIZE - 1 and so not shown. */
export type ProtectedCount = number | null;

export type CampusImpactReport = {
  /** Students with a measurable before/after: a count of who has practiced, not how well. */
  measurableStudents: number;
  /** Null until MIN_STUDENTS_FOR_SCORE_FIGURES students are measurable. */
  scoreGrowth: {
    studentsImproved: ProtectedCount;
    averageScoreGain: number;
    biggestScoreGain: number;
  } | null;
  /** Null until MIN_STUDENTS_FOR_SCORE_FIGURES students can be placed against the benchmark. */
  benchmark: {
    /** How many students the four groups below cover. */
    measured: number;
    crossed: ProtectedCount;
    held: ProtectedCount;
    slipped: ProtectedCount;
    below: ProtectedCount;
    shortfall: Record<BelowBenchmarkShape, ProtectedCount>;
    readingWritingBenchmark: number;
    mathBenchmark: number;
  } | null;
  averageStudyHours: number | null;
  /** Students who have finished at least one session of any kind. */
  studentsWhoStudied: number;
};

export function protectedCount(count: number): ProtectedCount {
  return count > 0 && count < MIN_GROUP_SIZE ? null : count;
}

/** Pure: the raw campus figures with everything that could single a student out withheld. */
export function protectCampusImpact(raw: CampusImpact): CampusImpactReport {
  const b = raw.benchmark;
  const measured = b.crossed + b.held + b.slipped + b.below;
  const enough = (n: number) => n >= MIN_STUDENTS_FOR_SCORE_FIGURES;
  return {
    measurableStudents: raw.measurableStudents,
    scoreGrowth:
      enough(raw.measurableStudents) && raw.averageScoreGain !== null && raw.biggestScoreGain !== null
        ? {
            studentsImproved: protectedCount(raw.studentsImproved),
            averageScoreGain: raw.averageScoreGain,
            biggestScoreGain: raw.biggestScoreGain,
          }
        : null,
    benchmark: enough(measured)
      ? {
          measured,
          crossed: protectedCount(b.crossed),
          held: protectedCount(b.held),
          slipped: protectedCount(b.slipped),
          below: protectedCount(b.below),
          shortfall: {
            MISSES_MATH_ONLY: protectedCount(b.shortfall.MISSES_MATH_ONLY),
            MISSES_READING_ONLY: protectedCount(b.shortfall.MISSES_READING_ONLY),
            MISSES_BOTH: protectedCount(b.shortfall.MISSES_BOTH),
          },
          readingWritingBenchmark: b.readingWritingBenchmark,
          mathBenchmark: b.mathBenchmark,
        }
      : null,
    averageStudyHours: raw.averageStudyHours,
    studentsWhoStudied: raw.activeStudents,
  };
}

export type CampusImpact = {
  /** Students with at least two predictions, i.e. a measurable before/after. */
  measurableStudents: number;

  averageScoreGain: number | null;
  biggestScoreGain: number | null;
  /** Students whose latest prediction midpoint is above their first. */
  studentsImproved: number;

  averageStudyHours: number | null;
  topStudentStudyHours: number | null;
  /** Students who have finished at least one session of any kind. */
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

/** One row per student with a measurable before/after, both ends in one row. */
type PredictionEnds = {
  firstMidpoint: number;
  lastMidpoint: number;
  firstRw: number | null;
  firstMath: number | null;
  lastRw: number | null;
  lastMath: number | null;
};

type StudyTimeSummary = {
  activeStudents: number;
  averageHours: number | null;
  topHours: number | null;
};

/** The campus report an administrator sees: `measureCampusImpact` with small groups withheld. */
export async function getCampusImpact(schoolId: string): Promise<CampusImpactReport> {
  return protectCampusImpact(await measureCampusImpact(schoolId));
}

/**
 * The unprotected figures. Exported for its tests; a page reads
 * `getCampusImpact`, never this.
 */
export async function measureCampusImpact(schoolId: string): Promise<CampusImpact> {
  const [ends, studyTime] = await Promise.all([
    predictionEndsForSchool(schoolId),
    studyTimeForSchool(schoolId),
  ]);

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

  for (const student of ends) {
    gains.push(student.lastMidpoint - student.firstMidpoint);

    // A prediction written before section abilities were recorded cannot be
    // scored against TSI; such a student is simply not counted in the
    // benchmark breakdown rather than guessed at.
    if (
      student.firstRw === null ||
      student.firstMath === null ||
      student.lastRw === null ||
      student.lastMath === null
    ) {
      continue;
    }

    const firstStatus = tsiStatusFromAbilities(student.firstRw, student.firstMath);
    const latestStatus = tsiStatusFromAbilities(student.lastRw, student.lastMath);

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

  return {
    measurableStudents: gains.length,
    averageScoreGain: gains.length > 0 ? Math.round(average(gains)) : null,
    biggestScoreGain: gains.length > 0 ? Math.max(...gains) : null,
    studentsImproved: gains.filter((g) => g > 0).length,
    averageStudyHours: studyTime.averageHours === null ? null : round1(studyTime.averageHours),
    topStudentStudyHours: studyTime.topHours === null ? null : round1(studyTime.topHours),
    activeStudents: studyTime.activeStudents,
    benchmark: {
      ...benchmark,
      readingWritingBenchmark: TSI_READING_WRITING_BENCHMARK,
      mathBenchmark: TSI_MATH_BENCHMARK,
    },
  };
}

/**
 * The first and last prediction of every student at this school who has at
 * least two, as one row each.
 *
 * Raw SQL because the whole point is to not transfer a student's prediction
 * history in order to find its two ends. `ROW_NUMBER()` numbers each student's
 * entries from both directions in one pass and the outer query keeps only the
 * ends; `COUNT(*) OVER` is what lets a single-prediction student be dropped in
 * the database rather than by a `length < 2` check here. `id` is the tiebreaker
 * on both orderings so two predictions written in the same transaction still
 * have a stable first and last.
 */
async function predictionEndsForSchool(schoolId: string): Promise<PredictionEnds[]> {
  return prisma.$queryRaw<PredictionEnds[]>`
    WITH scoped AS (
      SELECT p."studentId",
             p."representativeMidpoint",
             p."readingWritingAbility",
             p."mathAbility",
             ROW_NUMBER() OVER (PARTITION BY p."studentId" ORDER BY p."createdAt" ASC, p."id" ASC) AS rn_first,
             ROW_NUMBER() OVER (PARTITION BY p."studentId" ORDER BY p."createdAt" DESC, p."id" DESC) AS rn_last,
             COUNT(*) OVER (PARTITION BY p."studentId") AS entry_count
        FROM "prediction_history_entries" p
        JOIN "student_memberships" m ON m."studentId" = p."studentId"
       WHERE m."schoolId" = ${schoolId}
         AND m."status" = 'ACTIVE'
    )
    SELECT f."representativeMidpoint"  AS "firstMidpoint",
           f."readingWritingAbility"  AS "firstRw",
           f."mathAbility"            AS "firstMath",
           l."representativeMidpoint" AS "lastMidpoint",
           l."readingWritingAbility"  AS "lastRw",
           l."mathAbility"            AS "lastMath"
      FROM scoped f
      JOIN scoped l ON l."studentId" = f."studentId" AND l.rn_last = 1
     WHERE f.rn_first = 1
       AND f.entry_count > 1
  `;
}

/**
 * Average and maximum per-student study hours, plus how many students have any.
 *
 * Read from the same session definition as the school's total study hours
 * (`lib/school/student-activity`: every kind of finished session, each capped
 * at three hours) over the same students (ACTIVE at this school), so the
 * Overview's "N hours across M students, about Y each" adds up. It used to
 * count only Practice Sets and the Diagnostic, beside a total that counted
 * six kinds of session, and the two figures on one line disagreed.
 *
 * Aggregated all the way down to one row: the average and the maximum are
 * taken over per-student sums, so nothing per-student is returned at all.
 * The casts are explicit because the node-postgres adapter hands `numeric`
 * back as a string, and `EXTRACT`/`AVG`/`SUM` all produce `numeric`.
 */
async function studyTimeForSchool(schoolId: string): Promise<StudyTimeSummary> {
  const rows = await prisma.$queryRaw<
    { activeStudents: number; averageHours: number | null; topHours: number | null }[]
  >`
    WITH sessions AS (${schoolSessionActivity(schoolId, { activeOnly: true })}),
         per_student AS (
           SELECT student_id, SUM(${cappedHours("started_at", "completed_at")}) AS hours
             FROM sessions
            GROUP BY student_id
         )
    SELECT COUNT(*)::int                AS "activeStudents",
           AVG(hours)::double precision AS "averageHours",
           MAX(hours)::double precision AS "topHours"
      FROM per_student
  `;

  const row = rows[0];
  if (!row) return { activeStudents: 0, averageHours: null, topHours: null };
  return {
    activeStudents: Number(row.activeStudents ?? 0),
    averageHours: row.averageHours === null ? null : Number(row.averageHours),
    topHours: row.topHours === null ? null : Number(row.topHours),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
