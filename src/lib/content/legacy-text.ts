// Two shapes older questions were stored in, which the walkthrough backfill
// (scripts/question-import/bank.ts) straightens out without changing a word.

/**
 * An older Reading & Writing question's single field — the stem, a blank
 * line, then the passage — split into the stem and the passage. Null when the
 * first paragraph doesn't read as a question, so a passage is never mistaken
 * for one. The words are never changed.
 */
export function splitStoredPassage(text: string): { questionText: string; passageText: string } | null {
  const at = text.indexOf("\n\n");
  if (at === -1) return null;
  const questionText = text.slice(0, at).trim();
  const passageText = text.slice(at + 2).trim();
  if (!questionText || !passageText || questionText.length > 300) return null;
  if (!/\?$/.test(questionText) && !/^(Which|What|Based on|As used|According)\b/.test(questionText)) return null;
  return { questionText, passageText };
}

/** "Step 3: …" or "3. …" at the start of an explanation step: the site numbers steps itself, so the prefix doubles it. */
export function stripStepPrefix(text: string): string {
  return text.replace(/^\s*(?:Step\s*\d+\s*[:.)\-–]|\d+\s*[.)](?!\d))\s*/i, "");
}
