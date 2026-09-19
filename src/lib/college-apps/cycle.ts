// The admissions cycle is named for the year applications are due and the
// student enrolls: the season that opens on Common App in August 2026 is
// cycle 2027. Supplements are curated per cycle, so a student adding a
// college in September gets this year's prompts, not last year's.
export function admissionsCycle(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 7 ? year + 1 : year; // August (7) onward rolls over
}

// The four grades the onboarding wizard offers, as the current school year.
export const GRADES = [
  { value: 9, label: "Freshman" },
  { value: 10, label: "Sophomore" },
  { value: 11, label: "Junior" },
  { value: 12, label: "Senior" },
] as const;

export function isGrade(v: unknown): v is 9 | 10 | 11 | 12 {
  return v === 9 || v === 10 || v === 11 || v === 12;
}
