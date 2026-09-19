// Score fit — a student's Predicted SAT Score range against a college's
// middle 50% of admitted students. This is the one thing in College Apps
// nobody else can build: the student's range is *live*, from PrepHub's own
// engine, not a number they typed in.
//
// Definitions, kept deliberately simple and stated on the page:
//   likely  — the student's whole range sits at or above the college's 75th
//             percentile: a strong score even for that school.
//   target  — the ranges overlap: the student is inside the middle 50%.
//   reach   — the student's whole range sits below the 25th percentile.
//   unknown — the college doesn't report SAT ranges (test-blind, or Scorecard
//             has no data) or the student has no prediction yet.
//
// "aimFor" is the 75th percentile: scoring there puts the student in the top
// quarter of that college's admitted class, which is the honest answer to
// "what score should I aim for if I want in." It is never below the
// student's own current maximum — the message is "you're already there,"
// not "aim lower."

export type Fit = "likely" | "target" | "reach" | "unknown";

export type ScoreFit = {
  fit: Fit;
  /** The score to aim for (college 75th percentile), null when the college reports no range. */
  aimFor: number | null;
  /** Points between the student's current upper bound and aimFor; 0 when already there; null when unknown. */
  gap: number | null;
};

export function scoreFit(
  student: { min: number; max: number } | null,
  college: { sat25: number | null; sat75: number | null },
): ScoreFit {
  const has = college.sat25 !== null && college.sat75 !== null;
  if (!has) return { fit: "unknown", aimFor: null, gap: null };
  const aimFor = college.sat75!;
  if (!student) return { fit: "unknown", aimFor, gap: null };
  const gap = Math.max(0, aimFor - student.max);
  if (student.min >= college.sat75!) return { fit: "likely", aimFor, gap };
  if (student.max < college.sat25!) return { fit: "reach", aimFor, gap };
  return { fit: "target", aimFor, gap };
}

export const FIT_LABEL: Record<Fit, string> = {
  likely: "Likely",
  target: "Target",
  reach: "Reach",
  unknown: "No score data",
};
