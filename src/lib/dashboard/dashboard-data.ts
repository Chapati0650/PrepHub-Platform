import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { getRecommendedPace, type RecommendedPace } from "@/lib/onboarding/study-commitment";
import { answerActivity, studyHoursBetween } from "@/lib/school/student-activity";
// A student's study day is the same Central calendar day a community goal's
// deadline and the Rush leaderboard's week are counted in: PrepHub's students
// are in Texas, and a UTC day ends there at 7pm.
import { GOAL_TIME_ZONE as STUDY_DAY_TIME_ZONE, localDateInputValue } from "@/lib/community/goal";
import { streakFromDays } from "./study-streak";

export type DashboardData = {
  firstName: string;
  diagnosticStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  currentRange: { min: number; max: number } | null;
  approximateImprovementSinceStart: number | null;
  weeklyQuestionsCompleted: number;
  weeklyStudyTimeSeconds: number;
  totalQuestionsAnswered: number;
  studyStreak: number;
  recentImprovements: string[];
  mastery: { category: QuestionCategory; currentMastery: number }[];
  recommendedPace: RecommendedPace | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Two years: longer than any streak this product can have produced, and it
// keeps the streak query from scanning a student's entire answer history.
const STREAK_HORIZON_MS = 730 * 24 * 60 * 60 * 1000;

export async function getDashboardData(studentId: string): Promise<DashboardData> {
  const now = new Date();
  const since = new Date(now.getTime() - WEEK_MS);

  // The activity figures don't depend on the Diagnostic, so they're real even
  // before it: Settings shows the streak and question count to a student who
  // has so far only done Daily Challenges, and for them those aren't zero.
  const [user, diagnostic, answers, weeklyStudyHours] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true, studyCommitment: true } }),
    prisma.diagnosticSession.findUnique({ where: { studentId } }),
    // A study streak can only be as long as the run of consecutive days
    // ending today, so answers older than the horizon can't change it.
    getAnswerTotals(studentId, since, new Date(now.getTime() - STREAK_HORIZON_MS)),
    // Every kind of session finished this week, each capped so a set left
    // open overnight doesn't count as a fourteen-hour sitting: the same
    // figure the student's school sees.
    studyHoursBetween([studentId], since, now),
  ]);
  const recommendedPace = user.studyCommitment ? getRecommendedPace(user.studyCommitment) : null;
  const activity = {
    weeklyQuestionsCompleted: answers.thisWeek,
    weeklyStudyTimeSeconds: Math.round(weeklyStudyHours * 3600),
    totalQuestionsAnswered: answers.total,
    studyStreak: streakFromDays(new Set(answers.studyDays), localDateInputValue(now, STUDY_DAY_TIME_ZONE)),
  };

  if (diagnostic?.status !== "COMPLETED") {
    return {
      firstName: user.firstName,
      diagnosticStatus: diagnostic ? "IN_PROGRESS" : "NOT_STARTED",
      currentRange: null,
      approximateImprovementSinceStart: null,
      ...activity,
      recentImprovements: [],
      mastery: [],
      recommendedPace,
    };
  }

  const [recentPredictions, diagnosticPrediction, categoryStates, lastCompletedSet] = await Promise.all([
    prisma.predictionHistoryEntry.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 2 }),
    prisma.predictionHistoryEntry.findFirst({ where: { studentId, sourceType: "DIAGNOSTIC" }, orderBy: { createdAt: "asc" } }),
    prisma.categoryState.findMany({ where: { studentId } }),
    prisma.practiceSet.findFirst({
      where: { studentId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      include: { categorySnapshots: true },
    }),
  ]);

  const abilityByCategory = new Map(categoryStates.map((s) => [s.category, s.ability]));
  const mastery = ALL_CATEGORIES.map((category) => ({ category, currentMastery: Math.round(abilityByCategory.get(category) ?? 0) }));

  // Both come from the one take:2 fetch above — the most recent entry and the
  // one before it were previously two separate round trips over the same
  // ordering.
  const [latestPrediction, previousPrediction] = recentPredictions;

  const recentImprovements: string[] = [];
  if (latestPrediction && previousPrediction && latestPrediction.representativeMidpoint > previousPrediction.representativeMidpoint) {
    recentImprovements.push(
      `Estimated SAT increased by ${latestPrediction.representativeMidpoint - previousPrediction.representativeMidpoint} points.`,
    );
  }
  if (lastCompletedSet) {
    const snapshotByCategory = new Map(lastCompletedSet.categorySnapshots.map((s) => [s.category, s.abilityAtGeneration]));
    for (const category of ALL_CATEGORIES) {
      const before = snapshotByCategory.get(category);
      const after = abilityByCategory.get(category);
      if (before !== undefined && after !== undefined && Math.round(after) - Math.round(before) >= 1) {
        recentImprovements.push(`${CATEGORY_LABELS[category]} mastery improved.`);
      }
    }
  }

  return {
    firstName: user.firstName,
    diagnosticStatus: "COMPLETED",
    currentRange: latestPrediction ? { min: latestPrediction.displayedRangeMinimum, max: latestPrediction.displayedRangeMaximum } : null,
    approximateImprovementSinceStart:
      latestPrediction && diagnosticPrediction ? latestPrediction.representativeMidpoint - diagnosticPrediction.representativeMidpoint : 0,
    ...activity,
    recentImprovements: recentImprovements.slice(0, 4),
    mastery,
    recommendedPace,
  };
}

/**
 * Every question this student has answered, in any of the seven study modes,
 * counted in the database: the all-time total, the last seven days, and the
 * Central calendar days they answered on, for the streak. One row back.
 *
 * These used to count adaptive practice and the Diagnostic only, so a free
 * student whose studying after Set 1 was the Daily Challenge, Rush or their
 * homework saw "0 questions, 0-day streak" directly under the Daily row's own
 * five-day streak. `answerActivity` is the one definition of "answered" the
 * school figures use, so a new study mode reaches this page with them.
 *
 * The streak needs only the days, and only as far back as the longest streak
 * there could be: one short string per day, never a row per answer. Days are
 * keyed in the database because that's where the rows are; the zone is passed
 * in, so it is the same constant `today` is keyed with in `getDashboardData`.
 */
async function getAnswerTotals(
  studentId: string,
  since: Date,
  streakHorizon: Date,
): Promise<{ total: number; thisWeek: number; studyDays: string[] }> {
  const rows = await prisma.$queryRaw<{ total: number; thisWeek: number; studyDays: string[] | null }[]>`
    WITH answers AS (${answerActivity([studentId])})
    SELECT COUNT(*)::int AS "total",
           COUNT(*) FILTER (WHERE answered_at >= ${since})::int AS "thisWeek",
           ARRAY_AGG(DISTINCT TO_CHAR((answered_at AT TIME ZONE 'UTC') AT TIME ZONE ${STUDY_DAY_TIME_ZONE}::text, 'YYYY-MM-DD'))
             FILTER (WHERE answered_at >= ${streakHorizon}) AS "studyDays"
      FROM answers
  `;
  const row = rows[0];
  return { total: Number(row?.total ?? 0), thisWeek: Number(row?.thisWeek ?? 0), studyDays: row?.studyDays ?? [] };
}
