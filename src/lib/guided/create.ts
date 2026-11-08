import { randomBytes } from "node:crypto";
import { Prisma, type GuidedSessionMode, type QuestionCategory, type QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { generateJoinCode } from "@/lib/teacher/join-code";
import { requireOwnedClassroom, type TeacherContext } from "@/lib/teacher/access";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { CATEGORY_ORDER } from "@/lib/content/constants";
import { INDIVIDUAL_PRACTICE, SESSION_LENGTHS, WARMUP_MAX_DAYS, WARMUP_MIN_DAYS, sectionOf, type Section, type SessionLength } from "./config";
import { GuidedError } from "./errors";
import { median, pickSkill, type SkillPick, type SkillRank, type StudentSkillLevels } from "./pick-skill";
import { discussTier, planClassQuestions, startTier } from "./plan";
import { chooseQuestion, type Candidate } from "./select";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The current students of a class: enrolled and not removed. */
export async function classStudentIds(classroomId: string): Promise<string[]> {
  const rows = await prisma.classroomEnrollment.findMany({
    where: { classroomId, removedAt: null, student: { deletedAt: null } },
    select: { studentId: true },
  });
  return rows.map((r) => r.studentId);
}

/** Each student's skill levels (empty for a student without a Diagnostic). Server-side only. */
export async function skillLevels(studentIds: string[]): Promise<Map<string, StudentSkillLevels>> {
  const levels = new Map<string, StudentSkillLevels>(studentIds.map((id) => [id, {}]));
  if (studentIds.length === 0) return levels;
  const rows = await prisma.categoryState.findMany({
    where: { studentId: { in: studentIds } },
    select: { studentId: true, category: true, ability: true },
  });
  for (const row of rows) {
    const entry = levels.get(row.studentId);
    if (entry) entry[row.category] = row.ability;
  }
  return levels;
}

/**
 * Which questions in a skill each of these students has already answered, in
 * any mode. One round trip.
 */
export async function seenPairs(studentIds: string[], category: QuestionCategory): Promise<Map<string, Set<string>>> {
  const seen = new Map<string, Set<string>>();
  if (studentIds.length === 0) return seen;
  const ids = Prisma.join(studentIds);
  const rows = await prisma.$queryRaw<{ question_id: string; student_id: string }[]>`
    SELECT DISTINCT seen.question_id, seen.student_id FROM (
      SELECT fa."questionId" AS question_id, fa."studentId" AS student_id FROM "finalized_attempts" fa WHERE fa."studentId" IN (${ids})
      UNION ALL
      SELECT da."questionId", ds."studentId" FROM "diagnostic_attempts" da
        JOIN "diagnostic_sessions" ds ON ds."id" = da."diagnosticSessionId"
       WHERE ds."studentId" IN (${ids}) AND da."submittedAt" IS NOT NULL
      UNION ALL
      SELECT hsl."questionId", hs."studentId" FROM "homework_slots" hsl
        JOIN "homework_sessions" hs ON hs."id" = hsl."sessionId"
       WHERE hs."studentId" IN (${ids}) AND hsl."finalizedAt" IS NOT NULL
      UNION ALL
      SELECT csl."questionId", cs."studentId" FROM "club_slots" csl
        JOIN "club_sessions" cs ON cs."id" = csl."sessionId"
       WHERE cs."studentId" IN (${ids}) AND csl."finalizedAt" IS NOT NULL
      UNION ALL
      SELECT fsl."questionId", fs."studentId" FROM "focused_slots" fsl
        JOIN "focused_sessions" fs ON fs."id" = fsl."sessionId"
       WHERE fs."studentId" IN (${ids}) AND fsl."finalizedAt" IS NOT NULL
      UNION ALL
      SELECT gi."questionId", gr."studentId" FROM "guided_responses" gr
        JOIN "guided_items" gi ON gi."id" = gr."itemId"
       WHERE gr."studentId" IN (${ids}) AND gr."firstAt" IS NOT NULL
      UNION ALL
      SELECT gos."questionId", gos."studentId" FROM "guided_own_slots" gos
       WHERE gos."studentId" IN (${ids}) AND gos."answeredAt" IS NOT NULL
    ) seen
    JOIN "questions" q ON q."id" = seen.question_id
    WHERE q."category" = ${category}::"QuestionCategory"
  `;
  for (const row of rows) {
    const set = seen.get(row.student_id) ?? new Set<string>();
    set.add(row.question_id);
    seen.set(row.student_id, set);
  }
  return seen;
}

/** How many of these students have already answered each question in a skill. */
export async function seenCounts(studentIds: string[], category: QuestionCategory): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const questions of (await seenPairs(studentIds, category)).values()) {
    for (const id of questions) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Every published question in a skill, as a selection candidate. */
export async function publishedCandidates(category: QuestionCategory): Promise<Candidate[]> {
  const rows = await prisma.question.findMany({
    where: { category, status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    select: {
      id: true,
      difficulty: true,
      currentPublishedRevisionId: true,
      currentPublishedRevision: { select: { _count: { select: { explanationSteps: true } } } },
    },
  });
  return rows.map((r) => ({
    questionId: r.id,
    questionRevisionId: r.currentPublishedRevisionId!,
    difficulty: r.difficulty,
    stepCount: r.currentPublishedRevision?._count.explanationSteps ?? 0,
  }));
}

export type SkillPickSummary = Omit<SkillPick, "ranked"> & {
  ranked: (Omit<SkillRank, "median"> & { label: string; questions: number })[];
};

export type SessionSetup = {
  classroom: { id: string; name: string };
  rosterSize: number;
  /** One pick per section filter, computed here so no student's level leaves the server. */
  picks: Record<"ALL" | Section, SkillPickSummary>;
  /** What the class worked on last time. */
  lastCategory: QuestionCategory | null;
  openSessionId: string | null;
};

/** What the teacher sees before starting: the suggested skill, why, and the alternatives. */
export async function getSessionSetup(context: TeacherContext, classroomId: string): Promise<SessionSetup> {
  const classroom = await requireOwnedClassroom(context, classroomId);
  if (classroom.archivedAt) throw new GuidedError("CLASS_CLOSED", "This class is archived.");
  const studentIds = await classStudentIds(classroomId);
  const [levels, last, open, counts] = await Promise.all([
    skillLevels(studentIds),
    prisma.guidedSession.findFirst({
      where: { classroomId, status: "ENDED" },
      orderBy: { createdAt: "desc" },
      select: { category: true },
    }),
    prisma.guidedSession.findFirst({ where: { classroomId, status: "OPEN" }, select: { id: true } }),
    prisma.question.groupBy({
      by: ["category"],
      where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const questionCount = new Map(counts.map((c) => [c.category, c._count._all]));
  const students = [...levels.values()];
  const recent = last ? [last.category] : [];
  const summarize = (pick: SkillPick): SkillPickSummary => ({
    ...pick,
    ranked: pick.ranked.map((r) => ({
      category: r.category,
      section: r.section,
      measured: r.measured,
      below: r.below,
      average: r.average,
      line: r.line,
      weight: r.weight,
      recent: r.recent,
      priority: r.priority,
      label: CATEGORY_LABELS[r.category],
      questions: questionCount.get(r.category) ?? 0,
    })),
  });
  return {
    classroom: { id: classroom.id, name: classroom.name },
    rosterSize: studentIds.length,
    picks: {
      ALL: summarize(pickSkill({ students, recentCategories: recent })),
      MATH: summarize(pickSkill({ students, recentCategories: recent, section: "MATH" })),
      READING_WRITING: summarize(pickSkill({ students, recentCategories: recent, section: "READING_WRITING" })),
    },
    lastCategory: last?.category ?? null,
    openSessionId: open?.id ?? null,
  };
}

/**
 * The warm-up's skill: one the class worked on one to three weeks ago (the
 * spacing that holds material longest), else its last session's, else today's.
 */
async function warmupCategory(classroomId: string, today: QuestionCategory, now: Date): Promise<QuestionCategory> {
  const spaced = await prisma.guidedSession.findFirst({
    where: {
      classroomId,
      status: "ENDED",
      createdAt: { gte: new Date(now.getTime() - WARMUP_MAX_DAYS * DAY_MS), lte: new Date(now.getTime() - WARMUP_MIN_DAYS * DAY_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { category: true },
  });
  if (spaced) return spaced.category;
  const last = await prisma.guidedSession.findFirst({
    where: { classroomId, status: "ENDED" },
    orderBy: { createdAt: "desc" },
    select: { category: true },
  });
  return last?.category ?? today;
}

function stateKey(): string {
  return randomBytes(18).toString("base64url");
}

type PlannedItem = {
  kind: "WARMUP" | "EXAMPLE" | "CLASS";
  candidate: Candidate;
  plannedChance: number | null;
};

/**
 * Individual practice: no warm-up, example or class questions. The session
 * opens already in its own-questions phase and each student is dealt their
 * run when they join (`createPracticeSlots`). With `category: null` every
 * student's questions come from their own weakest skills; `category` is then
 * only a placeholder (the column is required) and is never shown.
 */
async function createIndividualSession(
  context: TeacherContext,
  classroomId: string,
  input: { category: QuestionCategory | null },
  now: Date,
): Promise<{ id: string }> {
  const perStudentSkills = input.category === null;
  const category = input.category ?? CATEGORY_ORDER[0];
  const available = await prisma.question.count({
    where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null }, ...(perStudentSkills ? {} : { category }) },
  });
  if (available === 0) {
    throw new GuidedError(
      "NO_CONTENT",
      `There aren't enough published ${CATEGORY_LABELS[category]} questions for a session yet. Choose another skill.`,
    );
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.guidedSession.create({
        data: {
          classroomId,
          teacherId: context.userId,
          category,
          mode: "INDIVIDUAL",
          perStudentSkills,
          pickSnapshot: { mode: "INDIVIDUAL", chosen: perStudentSkills ? null : category },
          joinCode: generateJoinCode(),
          stateKey: stateKey(),
          phase: "OWN",
          startedAt: now,
          phaseStartedAt: now,
          ownQuestionCount: INDIVIDUAL_PRACTICE.questions,
          ownSeconds: 0,
        },
        select: { id: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Couldn't open a session. Please try again.");
}

/**
 * Opens a session for a class. Teacher-led (the default): picks the warm-up,
 * the worked example and the class questions, and puts the room in the lobby.
 * Individual practice: opens straight into each student's own run. A class
 * has at most one open session; asking again returns it.
 */
export async function createGuidedSession(
  context: TeacherContext,
  classroomId: string,
  input: { category: QuestionCategory | null; length: SessionLength; mode?: GuidedSessionMode },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const classroom = await requireOwnedClassroom(context, classroomId);
  if (classroom.archivedAt) throw new GuidedError("CLASS_CLOSED", "This class is archived.");
  const open = await prisma.guidedSession.findFirst({ where: { classroomId, status: "OPEN" }, select: { id: true } });
  if (open) return open;
  if (input.mode === "INDIVIDUAL") return createIndividualSession(context, classroomId, { category: input.category }, now);
  if (input.category === null) throw new GuidedError("INVALID_INPUT", "Choose a skill.");
  const category: QuestionCategory = input.category;

  const length = SESSION_LENGTHS[input.length];
  const studentIds = await classStudentIds(classroomId);
  const levels = await skillLevels(studentIds);
  const levelsIn = (category: QuestionCategory) =>
    [...levels.values()].map((l) => l[category]).filter((v): v is number => typeof v === "number");
  const todayMedian = median(levelsIn(category));

  const random = createRandom(generateSeed());
  const [candidates, seen] = await Promise.all([publishedCandidates(category), seenCounts(studentIds, category)]);
  const used = new Set<string>();
  const planned: PlannedItem[] = [];
  const take = (kind: PlannedItem["kind"], pool: Candidate[], seenBy: Map<string, number>, difficulty: QuestionDifficulty, chance: number | null, needsSteps = false) => {
    const candidate = chooseQuestion({ candidates: pool, difficulty, used, seenBy, random, needsSteps });
    if (!candidate) return false;
    used.add(candidate.questionId);
    planned.push({ kind, candidate, plannedChance: chance });
    return true;
  };

  // Warm-up first, from a skill worked on a week or more ago where there is one.
  const warmCat = await warmupCategory(classroomId, category, now);
  if (warmCat === category) {
    take("WARMUP", candidates, seen, startTier(category, todayMedian), null);
  } else {
    const [warmPool, warmSeen] = await Promise.all([publishedCandidates(warmCat), seenCounts(studentIds, warmCat)]);
    if (!take("WARMUP", warmPool, warmSeen, startTier(warmCat, median(levelsIn(warmCat))), null)) {
      take("WARMUP", candidates, seen, startTier(category, todayMedian), null);
    }
  }

  const plan = planClassQuestions(category, todayMedian, length.classQuestions);
  take("EXAMPLE", candidates, seen, discussTier(category, todayMedian), null, true);
  for (const slot of plan) take("CLASS", candidates, seen, slot.difficulty, slot.chance);

  const classCount = planned.filter((p) => p.kind === "CLASS").length;
  if (classCount === 0) {
    throw new GuidedError(
      "NO_CONTENT",
      `There aren't enough published ${CATEGORY_LABELS[category]} questions for a session yet. Choose another skill.`,
    );
  }

  const pick = pickSkill({ students: [...levels.values()] });
  const snapshot = {
    measured: pick.measured,
    ranked: pick.ranked.map((r) => ({ category: r.category, below: r.below, measured: r.measured, priority: r.priority })),
    chosen: category,
    suggested: pick.pick,
    length: input.length,
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const session = await prisma.guidedSession.create({
        data: {
          classroomId,
          teacherId: context.userId,
          category,
          pickSnapshot: snapshot,
          joinCode: generateJoinCode(),
          stateKey: stateKey(),
          ownQuestionCount: length.ownQuestions,
          ownSeconds: length.ownSeconds,
          items: {
            create: planned.map((p, position) => ({
              position,
              kind: p.kind,
              questionId: p.candidate.questionId,
              questionRevisionId: p.candidate.questionRevisionId,
              difficulty: p.candidate.difficulty,
              plannedChance: p.plannedChance,
            })),
          },
        },
        select: { id: true },
      });
      return session;
    } catch (err) {
      // A join-code or key collision on the unique index: try fresh ones.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Couldn't open a session. Please try again.");
}

/** For the section a skill belongs to, in words. */
export function sectionLabel(category: QuestionCategory): string {
  return sectionOf(category) === "MATH" ? "Math" : "Reading & Writing";
}
