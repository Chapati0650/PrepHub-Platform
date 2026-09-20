// Bulk upload needs both AI providers for every single question: Anthropic
// reads the image (transcribe.ts), and DeepSeek does everything after that
// (category, difficulty, answer, explanation, distractors). The pipeline
// runs them in that order, so a missing DeepSeek key used to surface only
// *after* each image's transcription had already been paid for — confirmed
// in production on 2026-09-20: a batch burned ~$4 of Anthropic usage and
// produced almost nothing, because every question died at the category
// step with "isn't configured for this environment." This check runs before
// any provider is called, so a misconfigured environment costs nothing and
// says exactly which variable is missing.
export type BulkUploadRequirement = {
  envVar: "ANTHROPIC_API_KEY" | "DEEPSEEK_API_KEY";
  usedFor: string;
};

export const BULK_UPLOAD_REQUIREMENTS: readonly BulkUploadRequirement[] = [
  { envVar: "ANTHROPIC_API_KEY", usedFor: "reading each question image" },
  { envVar: "DEEPSEEK_API_KEY", usedFor: "category, correct answer, and explanation" },
];

export type BulkUploadReadiness = { ready: true } | { ready: false; missing: BulkUploadRequirement[]; message: string };

export function getBulkUploadReadiness(env: Record<string, string | undefined> = process.env): BulkUploadReadiness {
  const missing = BULK_UPLOAD_REQUIREMENTS.filter((r) => !env[r.envVar]?.trim());
  if (missing.length === 0) return { ready: true };
  const list = missing.map((m) => `${m.envVar} (${m.usedFor})`).join(" and ");
  return {
    ready: false,
    missing,
    message: `Bulk upload can't run in this environment: ${list} ${missing.length === 1 ? "isn't" : "aren't"} set. Nothing was sent to either AI provider, so this cost nothing.`,
  };
}
