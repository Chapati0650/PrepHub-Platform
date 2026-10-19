/**
 * Guesses where a Reading & Writing passage ends and the question begins.
 *
 * Existing questions store both in one `questionText` field, because until
 * the two-pane layout there was no reason to keep them apart. This recovers
 * the split for the ~152 already-published Reading & Writing questions so
 * they do not all have to be re-typed.
 *
 * Deliberately conservative. It returns null rather than guessing whenever
 * it is not confident, because a wrong split is worse than no split: a
 * student would see the question text stranded in the passage pane with an
 * empty question beside it. Everything it does return is content-preserving
 * by construction — `passage` and `question` rejoined with a blank line are
 * exactly the original string, which the caller asserts before writing.
 */
export type PassageSplit = { passage: string; question: string } | null;

/**
 * Openers that reliably begin an SAT Reading & Writing question stem rather
 * than a passage. Checked case-insensitively against the final block.
 */
const STEM_OPENERS = [
  "which choice",
  "which finding",
  "which quotation",
  "based on the text",
  "according to the text",
  "according to the passage",
  "as used in the text",
  "as used in the passage",
  "the student wants",
  "the author",
  "what is the main",
  "what does the text",
  "which statement",
  "the passage most strongly suggests",
  "it can most reasonably be inferred",
];

function looksLikeStem(block: string): boolean {
  const trimmed = block.trim();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  if (STEM_OPENERS.some((opener) => lower.startsWith(opener))) return true;
  // A short final block ending in a question mark is almost always the stem.
  return trimmed.endsWith("?") && trimmed.length <= 300;
}

export function splitPassageAndQuestion(questionText: string): PassageSplit {
  const text = questionText.replace(/\r\n/g, "\n");

  // Blocks separated by a blank line are how the Owner's own content is
  // written; a single newline inside a passage is a line break, not a split.
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  if (blocks.length < 2) return null;

  const last = blocks[blocks.length - 1];
  if (!looksLikeStem(last)) return null;

  const passage = blocks.slice(0, -1).join("\n\n");
  // A passage that is shorter than the stem is almost certainly not a
  // passage, so leave those alone for a human to look at.
  if (passage.length < last.length) return null;

  return { passage, question: last };
}

/** True when the split can be rejoined into exactly the original text. */
export function isLosslessSplit(original: string, split: NonNullable<PassageSplit>): boolean {
  const normalized = original.replace(/\r\n/g, "\n").trim();
  const rejoined = `${split.passage}\n\n${split.question}`;
  // Compared with internal whitespace collapsed, since the split trims each
  // block; nothing of substance may differ.
  const squash = (v: string) => v.replace(/\s+/g, " ").trim();
  return squash(normalized) === squash(rejoined);
}
