import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cacheAcrossRequests } from "@/lib/shared-cache";
import { computeStudyStreak } from "@/lib/dashboard/study-streak";
import { localDateInputValue, startOfLocalDay } from "@/lib/community/local-day";
import {
  answerDays,
  countActiveStudents,
  countAnswers,
  getSessionTotals,
} from "@/lib/school/student-activity";

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

/**
 * How far back the school-wide study streak is allowed to look.
 *
 * A streak only depends on the unbroken run of days ending today, so there is
 * no reason to scan a district's entire history to find it. Mirrors
 * STREAK_HORIZON_MS on the per-student dashboard streak.
 */
const STREAK_HORIZON_DAYS = 400;

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
//
// Everything is counted in the database. An earlier version pulled every
// FinalizedAttempt row for every student into memory and called `.length` on
// the array; that is fine for a school of 50 and fatal for a district, where
// 2,000 students who have each answered a few hundred questions is most of a
// million rows crossing the wire to produce one integer, on a serverless
// function with a hard execution limit.
//
// "Questions answered", "study hours", "active students" and the streak all
// come from `lib/school/student-activity`, which knows about every table a
// student's answers can land in. Before that they counted adaptive practice
// and the diagnostic only, so a campus that had taken to the 800 Club, 1v1
// Rush, Focused Practice or the Daily Challenge was reported as having done
// less work than it had. `totalAdaptiveSessionsCompleted` is the one figure
// still restricted to `PracticeSet`, and deliberately so — it is labelled
// "Practice Sets" on both pages, and a Rush run is not one.
//
// Shared for a minute across everyone who opens School Community, Admin
// Overview or the admin goal page: the answer is the same for the whole
// school, and a class opening Community together would otherwise compute it
// thirty times over. Every field is a number, so it survives the cache's JSON.
export const getSchoolAggregateStats = cacheAcrossRequests("school-aggregate-stats", computeSchoolAggregateStats, 60);

async function computeSchoolAggregateStats(schoolId: string): Promise<SchoolAggregateResult> {
  const memberships = await prisma.studentMembership.findMany({
    where: { schoolId, status: "ACTIVE" },
    select: { studentId: true },
  });
  const studentIds = memberships.map((m) => m.studentId);

  if (studentIds.length === 0) return EMPTY_RESULT;

  const now = new Date();
  // "Today" is the school's day, in the zone its goals and the Rush
  // leaderboard keep. `setHours(0)` used the server's clock, which is UTC in
  // production, so "answered today" rolled over at 7pm in Texas. (The school
  // streak below still steps through UTC days, as `answerDays` buckets them.)
  const startOfToday = startOfLocalDay(localDateInputValue(now)) ?? now;
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const streakHorizon = new Date(now.getTime() - STREAK_HORIZON_DAYS * DAY_MS);

  const [
    totalQuestionsAnswered,
    questionsAnsweredToday,
    activeStudentsThisWeek,
    studentsActiveToday,
    totalAdaptiveSessionsCompleted,
    sessions,
    improvement,
    activityDays,
  ] = await Promise.all([
    countAnswers(studentIds),
    countAnswers(studentIds, startOfToday),
    countActiveStudents(studentIds, weekAgo),
    countActiveStudents(studentIds, startOfToday),

    // The one deliberately narrow figure: "Adaptive Sessions" means a
    // Personalized Practice set, not any completed session.
    prisma.practiceSet.count({ where: { studentId: { in: studentIds }, status: "COMPLETED" } }),

    getSessionTotals(studentIds, weekAgo),
    scoreImprovement(studentIds, weekAgo),
    answerDays(studentIds, streakHorizon),
  ]);

  return {
    stats: {
      totalQuestionsAnswered,
      totalStudyHours: Math.round(sessions.studyHours),
      totalAdaptiveSessionsCompleted,
      totalEstimatedSatPointsImproved: improvement.total,
      activeStudentsThisWeek,
      studyStreak: computeStudyStreak(activityDays, now),
    },
    questionsAnsweredToday,
    studentsActiveToday,
    weeklyEstimatedSatPointsImproved: improvement.weekly,
    weeklyStudyHours: Math.round(sessions.studyHoursSince),
  };
}

/**
 * School-wide estimated SAT points improved, all-time and in the last week.
 *
 * Per-student improvement is `latest - first` prediction midpoint, floored at
 * 0 so a student who regressed doesn't cancel out another's progress — both
 * pages celebrate collective accomplishment, not a net score. The weekly
 * figure is the same floor applied to each consecutive step that landed inside
 * the window, so a student who improved twice this week contributes both.
 *
 * Raw SQL with window functions because `PredictionHistoryEntry` is the
 * fastest-growing table per student (one row per completed set) and this needs
 * two integers from it. `FIRST_VALUE`/`LAST_VALUE` give the ends and `LAG`
 * gives each step, all in one pass, so nothing per-student crosses the wire.
 * `id` is the tiebreaker on the ordering so two entries written in the same
 * transaction still have a stable order.
 */
async function scoreImprovement(
  studentIds: string[],
  since: Date,
): Promise<{ total: number; weekly: number }> {
  const rows = await prisma.$queryRaw<{ total: number; weekly: number }[]>`
    WITH seq AS (
      SELECT p."studentId",
             p."representativeMidpoint" AS mid,
             p."createdAt",
             LAG(p."representativeMidpoint") OVER w AS prev_mid,
             FIRST_VALUE(p."representativeMidpoint") OVER w AS first_mid,
             LAST_VALUE(p."representativeMidpoint") OVER (
               PARTITION BY p."studentId"
               ORDER BY p."createdAt", p."id"
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
             ) AS last_mid
        FROM "prediction_history_entries" p
       WHERE p."studentId" IN (${Prisma.join(studentIds)})
      WINDOW w AS (PARTITION BY p."studentId" ORDER BY p."createdAt", p."id")
    )
    SELECT (
             SELECT COALESCE(SUM(GREATEST(last_mid - first_mid, 0)), 0)::int
               FROM (SELECT DISTINCT "studentId", first_mid, last_mid FROM seq) ends
           ) AS total,
           (
             SELECT COALESCE(SUM(GREATEST(mid - prev_mid, 0)), 0)::int
               FROM seq
              WHERE prev_mid IS NOT NULL
                AND "createdAt" >= ${since}
           ) AS weekly
  `;
  return { total: Number(rows[0]?.total ?? 0), weekly: Number(rows[0]?.weekly ?? 0) };
}
