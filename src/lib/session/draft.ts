/**
 * The only fields a student's unsubmitted work may write to a question row.
 *
 * Every runner autosaves a draft through a server action that takes a
 * `patch` object, and a server action's argument is whatever the browser
 * sends: its TypeScript type is never checked at runtime. Passed straight to
 * Prisma as `data`, a hand-made call could set `isCorrect`, `submittedAt`,
 * `answer` or `questionRevisionId` on the student's own row — forging a
 * Diagnostic score, a homework grade, or (on a practice slot) moving the row
 * into another student's set. So the patch is rebuilt here from the two
 * fields a draft legitimately has, and anything else is dropped.
 */
export type DraftPatch = { draftAnswer?: string | null; skipped?: boolean };

/** Longer than any real answer (a numeric response or a choice id). */
const MAX_DRAFT_LENGTH = 200;

export function sanitizeDraftPatch(patch: unknown): DraftPatch {
  if (typeof patch !== "object" || patch === null) return {};
  const input = patch as Record<string, unknown>;
  const clean: DraftPatch = {};
  if (input.draftAnswer === null) clean.draftAnswer = null;
  else if (typeof input.draftAnswer === "string") clean.draftAnswer = input.draftAnswer.slice(0, MAX_DRAFT_LENGTH);
  if (typeof input.skipped === "boolean") clean.skipped = input.skipped;
  return clean;
}
