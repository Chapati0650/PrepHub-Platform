import type { CommunityGoalMetric } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { countAnswers, studyHoursBetween } from "@/lib/school/student-activity";
import { GOAL_LABELS, goalStatus, type GoalStatus } from "./goal";
import { computeSchoolMilestones } from "./milestones";
import { buildCommunityUpdates } from "./updates";

export type SchoolCommunityData = {
  schoolName: string;
  stats: {
    totalQuestionsAnswered: number;
    totalStudyHours: number;
    totalAdaptiveSessionsCompleted: number;
    totalEstimatedSatPointsImproved: number;
    activeStudentsThisWeek: number;
    studyStreak: number;
  };
  goal: CommunityGoal | null;
  updates: string[];
  milestones: string[];
};

export type CommunityGoal = {
  metric: CommunityGoalMetric;
  label: string;
  current: number;
  target: number;
  /** What the school wins; null for a goal with no prize. */
  prize: string | null;
  /** When counting started; null for an all-time goal set before windows existed. */
  startsAt: Date | null;
  endsAt: Date | null;
  reachedAt: Date | null;
  status: GoalStatus;
};

// PRD-009 §5-§10 — every metric here is a cross-student aggregate; nothing in
// this module's return shape can carry a single student's identity or
// individual performance (the privacy rule is enforced by the data shape,
// not by a separate filtering step). The aggregate math itself lives in
// `getSchoolAggregateStats` so Admin Overview (PRD-011 §10) computes the
// exact same numbers rather than a second, potentially-drifting copy.
export async function getSchoolCommunityData(schoolId: string): Promise<SchoolCommunityData> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: schoolId } });

  const { stats, questionsAnsweredToday, studentsActiveToday, weeklyEstimatedSatPointsImproved, weeklyStudyHours } =
    await getSchoolAggregateStats(schoolId);
  const { totalQuestionsAnswered, totalAdaptiveSessionsCompleted, totalStudyHours } = stats;

  let goal: SchoolCommunityData["goal"] = null;
  if (org.communityGoalMetric && org.communityGoalTarget) {
    const now = new Date();
    const metric = org.communityGoalMetric;
    const startsAt = org.communityGoalStartsAt ?? null;
    const endsAt = org.communityGoalEndsAt ?? null;
    // A windowed goal counts only what happened inside its window; one set
    // before windows existed keeps its all-time total, already computed above.
    const current = startsAt
      ? await goalProgressInWindow(schoolId, metric, startsAt, endsAt && endsAt < now ? endsAt : now)
      : metric === "QUESTIONS_ANSWERED"
        ? totalQuestionsAnswered
        : metric === "STUDY_HOURS"
          ? totalStudyHours
          : totalAdaptiveSessionsCompleted;

    let reachedAt = org.communityGoalReachedAt ?? null;
    const status = goalStatus({ current, target: org.communityGoalTarget, endsAt, reachedAt, now });
    if (status.state === "REACHED" && !reachedAt) {
      // Recorded the first time anyone sees it reached, so the date never
      // moves and the win survives the deadline. Guarded on the goal itself:
      // if the Owner changed the goal in the meantime, this one isn't it.
      reachedAt = now;
      await prisma.organization.updateMany({
        where: {
          id: schoolId,
          communityGoalReachedAt: null,
          communityGoalMetric: metric,
          communityGoalTarget: org.communityGoalTarget,
        },
        data: { communityGoalReachedAt: now },
      });
    }

    goal = {
      metric,
      label: GOAL_LABELS[metric],
      current,
      target: org.communityGoalTarget,
      prize: org.communityGoalPrize ?? null,
      startsAt,
      endsAt,
      reachedAt,
      status,
    };
  }

  return {
    schoolName: org.officialName,
    stats,
    goal,
    updates: buildCommunityUpdates({
      schoolName: org.officialName,
      questionsAnsweredToday,
      studentsActiveToday,
      weeklyEstimatedSatPointsImproved,
      weeklyStudyHours,
    }),
    milestones: computeSchoolMilestones(stats),
  };
}

/**
 * A goal's progress inside its window, from the same shared activity
 * definitions every school figure uses — a homework answer or a Rush answer
 * counts toward "Questions Answered" here exactly as it does on the campus
 * report. Scoped to the school's ACTIVE students, as the all-time totals are.
 */
async function goalProgressInWindow(
  schoolId: string,
  metric: CommunityGoalMetric,
  from: Date,
  to: Date,
): Promise<number> {
  const memberships = await prisma.studentMembership.findMany({
    where: { schoolId, status: "ACTIVE" },
    select: { studentId: true },
  });
  const studentIds = memberships.map((m) => m.studentId);
  if (studentIds.length === 0) return 0;

  if (metric === "QUESTIONS_ANSWERED") return countAnswers(studentIds, from, to);
  if (metric === "STUDY_HOURS") return Math.round(await studyHoursBetween(studentIds, from, to));
  return prisma.practiceSet.count({
    where: { studentId: { in: studentIds }, status: "COMPLETED", completedAt: { gte: from, lte: to } },
  });
}
