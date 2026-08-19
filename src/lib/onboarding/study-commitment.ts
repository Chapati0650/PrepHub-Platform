import type { StudyCommitment } from "@/generated/prisma/client";

// Onboarding wizard's Study Commitment step — options and their recommended
// pace. Purely a display/recommendation input: it must never feed the
// adaptive ability system (see StudyCommitment's schema comment), only the
// wizard's inline preview and the Dashboard's "Recommended Pace" card.
export const STUDY_COMMITMENT_OPTIONS: {
  value: StudyCommitment;
  label: string;
  description: string;
}[] = [
  { value: "LIGHT", label: "10–15 minutes a day", description: "I can fit in a little practice every day." },
  { value: "MODERATE", label: "20–30 minutes a day", description: "I can consistently make time to practice." },
  { value: "INTENSIVE", label: "30–60 minutes a day", description: "I'm ready to put in more time." },
  { value: "FEW_TIMES_WEEK", label: "A few times a week", description: "I'll practice when I have time." },
  { value: "UNSURE", label: "I'm not sure yet", description: "" },
];

export type RecommendedPace = { label: string; description: string };

const RECOMMENDED_PACE: Record<StudyCommitment, RecommendedPace> = {
  LIGHT: { label: "Complete ½ a set per day", description: "to build a steady daily habit." },
  MODERATE: { label: "Complete 1 set per day", description: "to build consistent progress." },
  INTENSIVE: { label: "Complete 2 sets per day", description: "to make the most of your time." },
  FEW_TIMES_WEEK: { label: "Complete 1 set on practice days", description: "to stay on track between sessions." },
  UNSURE: { label: "Start with ½ a set per day", description: "you can always adjust your pace later." },
};

export function getRecommendedPace(commitment: StudyCommitment): RecommendedPace {
  return RECOMMENDED_PACE[commitment];
}
