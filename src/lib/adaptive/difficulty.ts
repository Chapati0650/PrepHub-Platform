import type { QuestionDifficulty } from "@/generated/prisma/client";
import { distributionForAbility } from "./config";

// PRD-014 §9 — one weighted-random sample per slot, using the category's
// Ability Score at set-generation time.
export function sampleDifficulty(ability: number, random: () => number): QuestionDifficulty {
  const { easy, medium } = distributionForAbility(ability);
  const r = random();
  if (r < easy) return "EASY";
  if (r < easy + medium) return "MEDIUM";
  return "HARD";
}
