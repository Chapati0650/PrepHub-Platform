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
