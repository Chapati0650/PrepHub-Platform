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
  // Counts students who answered any question today, in any mode — not
  // finished sessions — and "adaptive" is an internal word students never see.
  if (input.studentsActiveToday > 0) {
    updates.push(`${input.studentsActiveToday} student${input.studentsActiveToday === 1 ? "" : "s"} practiced today.`);
  }
  if (input.weeklyEstimatedSatPointsImproved > 0) {
    // Said as what it is, a sum across students: "improved by 650 points" read as one school's score
    // jumping 650 (review, 2026-11-09).
    updates.push(`Students at ${input.schoolName} gained an estimated ${input.weeklyEstimatedSatPointsImproved} SAT points between them this week.`);
  }
  if (input.weeklyStudyHours > 0) {
    updates.push(`The school studied for ${input.weeklyStudyHours} hours this week.`);
  }

  return updates;
}
