import type { QuestionCategory } from "@/generated/prisma/client";
import { CATEGORY_LABELS } from "@/lib/content/labels";

// The landing page promises "a free test-analysis pointing out the exact
// categories dragging your score down." The results page showed seven bars
// and left the reader to work it out. This is the sentence.
//
// Pure, so the wording is testable: the two weakest categories by mastery,
// framed against the strongest one when the gap is real.
export function diagnosticVerdict(mastery: { category: QuestionCategory; currentMastery: number }[]): string | null {
  if (mastery.length < 2) return null;
  const sorted = [...mastery].sort((a, b) => a.currentMastery - b.currentMastery);
  const [weakest, second] = sorted;
  const strongest = sorted[sorted.length - 1];
  const w = CATEGORY_LABELS[weakest.category];
  const s = CATEGORY_LABELS[second.category];
  if (strongest.currentMastery - weakest.currentMastery < 15) {
    return `Your categories are close to even, with ${w} and ${s} slightly behind — steady practice across all seven is what moves this score.`;
  }
  return `${w} and ${s} are where you're losing the most points. Your first practice set is built around them.`;
}

export function weakestCategories(mastery: { category: QuestionCategory; currentMastery: number }[], count = 2): QuestionCategory[] {
  return [...mastery]
    .sort((a, b) => a.currentMastery - b.currentMastery)
    .slice(0, count)
    .map((m) => m.category);
}
