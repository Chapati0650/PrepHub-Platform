import type { QuestionCategory } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CATEGORY_ORDER } from "@/lib/content/constants";
import { SKILL_LINES } from "@/lib/guided/pick-skill";
import { SKILL_WEIGHTS, sectionOf } from "@/lib/guided/config";
import { inSchools } from "@/lib/school/student-activity";
import { MIN_STUDENTS_FOR_SCORE_FIGURES, protectedCount, type CellCount } from "./impact";

/**
 * "Where students fall short, by skill" (2026-11-09) for the campus and district Overviews: for each
 * of the seven tested skills, how many students with a Diagnostic are below the college-ready level
 * in it, the same line the Guided Session pick uses (the skill level that, across its section,
 * predicts 480 in Reading & Writing or 530 in Math). It is what /schools promised as "which of the
 * seven tested areas is costing your campus most", and what a CCMR office plans sessions around.
 *
 * Aggregate-only, as everything in the admin area: counts per skill, never a student. A count of 1
 * to 4 is withheld; nothing shows below MIN_STUDENTS_FOR_SCORE_FIGURES students with a Diagnostic;
 * and a district figure sums only campuses whose seven counts are all shown, so a withheld campus
 * count can't be recovered by subtraction (the rule the district readiness roll-up follows).
 */

export type RawSkillGaps = { measured: number; below: Partial<Record<QuestionCategory, number>> };

export type SkillGap = {
  category: QuestionCategory;
  below: CellCount;
  /** Share below, 0-1, or null when the count is withheld. */
  share: number | null;
  /** How much of its section the skill is, for ordering. */
  weight: number;
};

export type SkillGaps = { measured: number; skills: SkillGap[] } | null;

/**
 * Pure: raw counts into the shown figures, most students below first. `hide` names skills to show as
 * "Withheld" (a district's, where one campus alone hides that skill).
 */
export function protectSkillGaps(raw: RawSkillGaps, hide: QuestionCategory[] = []): SkillGaps {
  if (raw.measured < MIN_STUDENTS_FOR_SCORE_FIGURES) return null;
  const skills = CATEGORY_ORDER.map((category) => {
    const n = raw.below[category] ?? 0;
    const below: CellCount = hide.includes(category) ? "withheld" : protectedCount(n);
    return { category, below, share: typeof below === "number" ? n / raw.measured : null, weight: SKILL_WEIGHTS[category], n };
  })
    // Most students below first: plainer to read than the Guided pick's weighted priority, which is
    // for choosing one skill, not for listing seven.
    .sort((a, b) => b.n - a.n || b.weight - a.weight)
    .map(({ category, below, share, weight }) => ({ category, below, share, weight }));
  return { measured: raw.measured, skills };
}

/** Whether every count of a campus is shown (0 or at least the small-group size), so it can join a district sum. */
export function allShown(raw: RawSkillGaps): boolean {
  return raw.measured >= MIN_STUDENTS_FOR_SCORE_FIGURES && CATEGORY_ORDER.every((c) => protectedCount(raw.below[c] ?? 0) !== null);
}

/**
 * Pure: a district's figures from every campus with enough students (2026-11-09; it used to take only
 * campuses with no small count). A skill one campus alone hides is withheld at district level, since
 * the district minus the other campuses would give it away; one hidden at two or more reveals only a sum.
 */
export function combineSkillGaps(campuses: RawSkillGaps[]): { raw: RawSkillGaps; left: number; hide: QuestionCategory[] } {
  const included = campuses.filter((c) => c.measured >= MIN_STUDENTS_FOR_SCORE_FIGURES);
  const raw: RawSkillGaps = { measured: 0, below: {} };
  for (const c of included) {
    raw.measured += c.measured;
    for (const cat of CATEGORY_ORDER) raw.below[cat] = (raw.below[cat] ?? 0) + (c.below[cat] ?? 0);
  }
  const hide = CATEGORY_ORDER.filter((cat) => included.filter((c) => protectedCount(c.below[cat] ?? 0) === null).length === 1);
  return { raw, left: campuses.filter((c) => c.measured > 0 && c.measured < MIN_STUDENTS_FOR_SCORE_FIGURES).length, hide };
}

/** One campus's raw counts: ACTIVE students with a finished Diagnostic, by skill. */
export async function rawSkillGaps(schoolId: string): Promise<RawSkillGaps> {
  const rwLine = SKILL_LINES.READING_WRITING;
  const mathLine = SKILL_LINES.MATH;
  const mathCats = CATEGORY_ORDER.filter((c) => sectionOf(c) === "MATH");
  const rows = await prisma.$queryRaw<{ category: string; measured: number; below: number }[]>`
    SELECT cs."category"::text AS category,
           COUNT(*)::int AS measured,
           COUNT(*) FILTER (
             WHERE cs."ability" < CASE WHEN cs."category"::text IN (${Prisma.join(mathCats)}) THEN ${mathLine}::double precision ELSE ${rwLine}::double precision END
           )::int AS below
      FROM "category_states" cs
      JOIN "diagnostic_sessions" d ON d."studentId" = cs."studentId" AND d."completedAt" IS NOT NULL
     WHERE ${inSchools('cs."studentId"', [schoolId])}
     GROUP BY cs."category"
  `;
  const measured = rows.reduce((m, r) => Math.max(m, Number(r.measured)), 0);
  const below: Partial<Record<QuestionCategory, number>> = {};
  for (const r of rows) below[r.category as QuestionCategory] = Number(r.below);
  return { measured, below };
}

export async function getSkillGaps(schoolId: string): Promise<SkillGaps> {
  return protectSkillGaps(await rawSkillGaps(schoolId));
}

/** `campusIds` must be the administrator's own district's campuses. */
export async function getDistrictSkillGaps(campusIds: string[]): Promise<{ gaps: SkillGaps; left: number }> {
  const { raw, left, hide } = combineSkillGaps(await Promise.all(campusIds.map(rawSkillGaps)));
  return { gaps: protectSkillGaps(raw, hide), left };
}
