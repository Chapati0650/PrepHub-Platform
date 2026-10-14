/**
 * Neither PRD-001 (signup) nor PRD-002 (verification) collects an expected
 * graduation year, but PRD-017's StudentMembership requires one. We derive a
 * reasonable default from the grade already collected at signup, using the
 * standard US school-year convention (Aug–Jun). PRD-017 §10 explicitly allows
 * the Owner/administrator to correct this later, so an auto-computed guess
 * here — rather than an extra required field neither PRD asks for — is the
 * right tradeoff.
 */
export function computeExpectedGraduationYear(grade: number, asOf: Date = new Date()): number {
  const month = asOf.getMonth(); // 0 = Jan
  const isFallSemester = month >= 7; // Aug–Dec
  const currentSpringYear = isFallSemester ? asOf.getFullYear() + 1 : asOf.getFullYear();
  const yearsUntilGraduation = 12 - grade;
  return currentSpringYear + yearsUntilGraduation;
}

/**
 * The inverse of `computeExpectedGraduationYear`: what grade is a student in
 * now, given the year they are expected to graduate? Used when a district's
 * roster supplies a graduation year — the district has then already answered
 * the question onboarding would otherwise have to ask, so the student can be
 * enrolled before they have answered anything.
 *
 * Returns null outside grades 9-12 rather than clamping: a roster line that
 * implies 7th grade or a year in the past is bad data, and inventing a grade
 * from it would quietly put the student in the wrong place.
 */
export function gradeFromGraduationYear(
  graduationYear: number | null,
  asOf: Date = new Date(),
): number | null {
  if (graduationYear == null || !Number.isInteger(graduationYear)) return null;
  const isFallSemester = asOf.getMonth() >= 7; // Aug-Dec, same convention as above
  const currentSpringYear = isFallSemester ? asOf.getFullYear() + 1 : asOf.getFullYear();
  const grade = 12 - (graduationYear - currentSpringYear);
  return grade >= 9 && grade <= 12 ? grade : null;
}
