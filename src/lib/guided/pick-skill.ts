import type { QuestionCategory } from "@/generated/prisma/client";
import { CATEGORY_ORDER } from "@/lib/content/constants";
import { abilityForSectionScore } from "@/lib/score/config";
import { TSI_MATH_BENCHMARK, TSI_READING_WRITING_BENCHMARK } from "@/lib/score/ccmr";
import { MIN_STUDENTS_FOR_PICK, RECENT_SKILL_FACTOR, SKILL_WEIGHTS, sectionOf, type Section } from "./config";

/**
 * Which skill a class should work on together. Pure, so the rule is tested
 * directly.
 *
 * **Count students, don't average them.** An average lets a few students far
 * behind make a skill look like the class's weakest while the skill most of
 * the room needs sits just above it (about a quarter of classrooms have a
 * two-humped spread; Sibbald 2014). So each skill scores
 *
 *   students below the college-ready line × how much of its section it is
 *
 * and a skill the class covered last session counts half, so sessions vary.
 * Students far behind in a skill most of the class has are served by their
 * own questions and Practice Sets, not by thirty students at once.
 *
 * "The line" is the skill level that, across a whole section, predicts the
 * TSI college-ready score: 480 in Reading & Writing, 530 in Math.
 */

/** One student's level in each skill (0–100), as stored after their Diagnostic. */
export type StudentSkillLevels = Partial<Record<QuestionCategory, number>>;

export type SkillRank = {
  category: QuestionCategory;
  section: Section;
  /** Students with a level in this skill. */
  measured: number;
  /** Of them, how many are below the line. */
  below: number;
  /** The class average, for the comparison the teacher sees; never the basis of the pick. */
  average: number | null;
  /** The middle student's level, used to pitch the questions. */
  median: number | null;
  line: number;
  weight: number;
  recent: boolean;
  priority: number;
};

export type SkillPick = {
  /** Students with a Diagnostic. */
  measured: number;
  /** Whether there are enough of them for PrepHub to suggest a skill. */
  ready: boolean;
  /** Every skill, best first. */
  ranked: SkillRank[];
  pick: QuestionCategory | null;
  alternatives: QuestionCategory[];
};

/**
 * The skill level whose section-score equivalent is `benchmark`, on the same
 * line every prediction is scored on (SECTION_SCORE_LINES): about 44 in
 * Reading & Writing and 55 in Math under engine 2026.2.
 */
export function tsiAbilityLine(section: Section, benchmark: number): number {
  return Math.round(abilityForSectionScore(section, benchmark) * 10) / 10;
}

export const SKILL_LINES: Record<Section, number> = {
  READING_WRITING: tsiAbilityLine("READING_WRITING", TSI_READING_WRITING_BENCHMARK),
  MATH: tsiAbilityLine("MATH", TSI_MATH_BENCHMARK),
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function pickSkill(params: {
  students: StudentSkillLevels[];
  /** Skills the class worked on in its most recent session. */
  recentCategories?: readonly QuestionCategory[];
  /** Limit the pick to one section, or null for either. */
  section?: Section | null;
}): SkillPick {
  const { students, recentCategories = [], section = null } = params;
  const measuredStudents = students.filter((s) => Object.keys(s).length > 0);
  const measured = measuredStudents.length;
  const ready = measured >= MIN_STUDENTS_FOR_PICK;

  const ranked: SkillRank[] = CATEGORY_ORDER.filter((c) => !section || sectionOf(c) === section).map((category) => {
    const sec = sectionOf(category);
    const line = SKILL_LINES[sec];
    const levels = measuredStudents.map((s) => s[category]).filter((v): v is number => typeof v === "number");
    const below = levels.filter((v) => v < line).length;
    const recent = recentCategories.includes(category);
    const weight = SKILL_WEIGHTS[category];
    return {
      category,
      section: sec,
      measured: levels.length,
      below,
      average: levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : null,
      median: median(levels),
      line,
      weight,
      recent,
      priority: below * weight * (recent ? RECENT_SKILL_FACTOR : 1),
    };
  });

  ranked.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Nobody below the line anywhere: the skill the class is lowest in still
    // has the most room, so it leads.
    const avgA = a.average ?? Infinity;
    const avgB = b.average ?? Infinity;
    if (avgA !== avgB) return avgA - avgB;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });

  if (!ready) return { measured, ready, ranked, pick: null, alternatives: [] };
  return {
    measured,
    ready,
    ranked,
    pick: ranked[0]?.category ?? null,
    alternatives: ranked.slice(1, 3).map((r) => r.category),
  };
}
