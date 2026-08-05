// PRD-009 §8 — automatically generated, always aggregate, never referencing
// an individual student. Pure formatting over pre-computed numbers so the
// "no PII" rule is trivially auditable: nothing here ever takes a student id
// or name as input.
export function buildCommunityUpdates(input: {
  schoolName: string;
  questionsAnsweredToday: number;
  studentsActiveToday: number;
  weeklyEstimatedSatPointsImproved: number;
  weeklyStudyHours: number;
}): string[] {
  const updates: string[] = [];

  if (input.questionsAnsweredToday > 0) {
    updates.push(`${input.schoolName} students answered ${input.questionsAnsweredToday.toLocaleString()} questions today.`);
  }
  if (input.studentsActiveToday > 0) {
    updates.push(
      `${input.studentsActiveToday} student${input.studentsActiveToday === 1 ? "" : "s"} completed an adaptive session today.`,
    );
  }
  if (input.weeklyEstimatedSatPointsImproved > 0) {
    updates.push(`${input.schoolName} improved by an estimated ${input.weeklyEstimatedSatPointsImproved} SAT points this week.`);
  }
  if (input.weeklyStudyHours > 0) {
    updates.push(`The school studied for ${input.weeklyStudyHours} hours this week.`);
  }

  return updates;
}
