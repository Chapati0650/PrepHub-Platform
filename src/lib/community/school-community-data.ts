import type { CommunityGoalMetric } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
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
  goal: { metric: CommunityGoalMetric; label: string; current: number; target: number } | null;
  updates: string[];
  milestones: string[];
};

const GOAL_LABELS: Record<CommunityGoalMetric, string> = {
  QUESTIONS_ANSWERED: "Questions Answered",
  STUDY_HOURS: "Study Hours",
  ADAPTIVE_SESSIONS: "Adaptive Sessions",
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
    const current =
      org.communityGoalMetric === "QUESTIONS_ANSWERED"
        ? totalQuestionsAnswered
        : org.communityGoalMetric === "STUDY_HOURS"
          ? totalStudyHours
          : totalAdaptiveSessionsCompleted;
    goal = { metric: org.communityGoalMetric, label: GOAL_LABELS[org.communityGoalMetric], current, target: org.communityGoalTarget };
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
