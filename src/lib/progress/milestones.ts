// PRD-008 §8 — one badge per group, showing the highest threshold reached so
// far (rather than every milestone ever crossed) to keep the section compact.
const STUDY_HOURS = [1, 5, 10, 25, 50, 100];
const QUESTION_COUNTS = [100, 250, 500, 1000, 2500];
const SESSION_COUNTS = [1, 10, 25, 50, 100];
const SCORE_THRESHOLDS = [1200, 1300, 1400, 1500, 1550];

function highestReached(value: number, thresholds: number[]): number | null {
  const reached = thresholds.filter((t) => value >= t);
  return reached.length > 0 ? reached[reached.length - 1] : null;
}

export function computeMilestones(input: {
  totalStudyTimeSeconds: number;
  totalQuestionsAnswered: number;
  completedSessions: number;
  highestPredictedScore: number;
}): string[] {
  const badges: string[] = [];

  const hours = highestReached(input.totalStudyTimeSeconds / 3600, STUDY_HOURS);
  if (hours !== null) badges.push(hours === 1 ? "First Hour Studied" : `${spellOut(hours)} Hours Studied`);

  const questions = highestReached(input.totalQuestionsAnswered, QUESTION_COUNTS);
  if (questions !== null) badges.push(`${questions.toLocaleString()} Questions`);

  const sessions = highestReached(input.completedSessions, SESSION_COUNTS);
  if (sessions !== null) badges.push(sessions === 1 ? "First Session" : `${spellOut(sessions)} Sessions`);

  const score = highestReached(input.highestPredictedScore, SCORE_THRESHOLDS);
  if (score !== null) badges.push(`First ${score}+`);

  return badges;
}

function spellOut(n: number): string {
  const words: Record<number, string> = { 5: "Five", 10: "Ten", 25: "Twenty-Five", 50: "Fifty", 100: "One Hundred" };
  return words[n] ?? String(n);
}
