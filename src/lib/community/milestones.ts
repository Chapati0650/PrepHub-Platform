// PRD-009 §9 — school-scale milestone thresholds, celebrating the whole
// community rather than any one student. Same "highest reached only" shape
// as the individual Progress page's milestones (src/lib/progress/milestones.ts).
const QUESTION_THRESHOLDS = [10_000, 50_000, 100_000];
const STUDY_HOUR_THRESHOLDS = [100, 500, 1000];
const SESSION_THRESHOLDS = [1000, 5000, 10_000];
const SAT_IMPROVEMENT_THRESHOLDS = [1000, 5000, 10_000];

function highestReached(value: number, thresholds: number[]): number | null {
  const reached = thresholds.filter((t) => value >= t);
  return reached.length > 0 ? reached[reached.length - 1] : null;
}

export function computeSchoolMilestones(input: {
  totalQuestionsAnswered: number;
  totalStudyHours: number;
  totalAdaptiveSessionsCompleted: number;
  totalEstimatedSatPointsImproved: number;
}): string[] {
  const badges: string[] = [];

  const questions = highestReached(input.totalQuestionsAnswered, QUESTION_THRESHOLDS);
  if (questions !== null) badges.push(`${questions.toLocaleString()} Questions`);

  const hours = highestReached(input.totalStudyHours, STUDY_HOUR_THRESHOLDS);
  if (hours !== null) badges.push(`${hours.toLocaleString()} Hours`);

  const sessions = highestReached(input.totalAdaptiveSessionsCompleted, SESSION_THRESHOLDS);
  if (sessions !== null) badges.push(`${sessions.toLocaleString()} Sessions`);

  const points = highestReached(input.totalEstimatedSatPointsImproved, SAT_IMPROVEMENT_THRESHOLDS);
  if (points !== null) badges.push(`${points.toLocaleString()} Total Estimated SAT Points`);

  return badges;
}
