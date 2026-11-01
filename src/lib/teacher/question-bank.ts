import type { Prisma, QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed, shuffle } from "@/lib/adaptive/random";
import {
  getStudentQuestionContent,
  getStudentQuestionFeedback,
  type StudentQuestionContent,
  type StudentQuestionFeedback,
} from "@/lib/session/question-content";
import { QUESTION_BANK_PAGE_SIZE } from "./config";
import { TeacherError } from "./errors";

/**
 * The question bank as a teacher browses it: published questions only, the
 * same pool every student surface draws from. Teachers never see drafts, and
 * nothing here can edit a question — content is the Owner's alone.
 */

export type BankFilters = {
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  questionType?: QuestionType;
  search?: string;
  /** Leave out questions this class has already been given. */
  hideAssigned?: boolean;
};

export type BankItem = {
  id: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  questionType: QuestionType;
  /** The question text, cut to a readable length. May contain LaTeX. */
  snippet: string;
  hasPassage: boolean;
  /**
   * The opening of the passage, for a question that has one. Reading and
   * Writing stems repeat ("Which choice most logically completes the
   * text?"), so without this a page of them is twenty identical rows.
   */
  passageSnippet: string | null;
  /** Titles of this class's homework the question was already on. */
  assignedIn: string[];
};

const SNIPPET_LENGTH = 220;
const PASSAGE_SNIPPET_LENGTH = 150;

/**
 * The filters as a query. `classroomId` is the class the homework is for, and
 * only matters to `hideAssigned`; the caller has already checked the
 * teacher owns it.
 */
function whereFor(filters: BankFilters, classroomId?: string): Prisma.QuestionWhereInput {
  const search = filters.search?.trim();
  return {
    status: "PUBLISHED",
    currentPublishedRevisionId: { not: null },
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.questionType ? { questionType: filters.questionType } : {}),
    ...(filters.hideAssigned && classroomId ? { assignmentQuestions: { none: { assignment: { classroomId } } } } : {}),
    ...(search
      ? {
          currentPublishedRevision: {
            OR: [
              { questionText: { contains: search, mode: "insensitive" } },
              { passageText: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
}

export function snippetOf(text: string, length: number = SNIPPET_LENGTH): string {
  // Underline markers ([[…]]) are for the full question; in a one-line
  // preview they'd show as brackets.
  const flat = text.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  // Never cut inside a $...$ pair, or the preview renders half an equation
  // as raw LaTeX: back up to before the last unclosed dollar sign. An
  // escaped \$ is a dollar sign, not a delimiter.
  let cut = flat.slice(0, length);
  const delimiters = [...cut.matchAll(/(?<!\\)\$/g)];
  if (delimiters.length % 2 === 1) cut = cut.slice(0, delimiters[delimiters.length - 1].index);
  return `${cut.trimEnd()}…`;
}

/** Which of these questions this class has already had, as homework titles. */
export async function assignedTitles(classroomId: string, questionIds: string[]): Promise<Map<string, string[]>> {
  if (questionIds.length === 0) return new Map();
  const rows = await prisma.assignmentQuestion.findMany({
    where: { questionId: { in: questionIds }, assignment: { classroomId } },
    orderBy: { assignment: { createdAt: "asc" } },
    select: { questionId: true, assignment: { select: { title: true } } },
  });
  const byQuestion = new Map<string, string[]>();
  for (const r of rows) byQuestion.set(r.questionId, [...(byQuestion.get(r.questionId) ?? []), r.assignment.title]);
  return byQuestion;
}

export async function searchQuestionBank(
  filters: BankFilters,
  page: number = 1,
  classroomId?: string,
): Promise<{ items: BankItem[]; total: number; page: number; pageCount: number }> {
  const where = whereFor(filters, classroomId);
  const safePage = Math.max(1, Math.floor(page));
  const [total, rows] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      // Category then difficulty, so a page of results reads like a unit;
      // id last for a stable order across pages.
      orderBy: [{ category: "asc" }, { difficulty: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * QUESTION_BANK_PAGE_SIZE,
      take: QUESTION_BANK_PAGE_SIZE,
      select: {
        id: true,
        category: true,
        difficulty: true,
        questionType: true,
        currentPublishedRevision: { select: { questionText: true, passageText: true } },
      },
    }),
  ]);
  const assigned = classroomId ? await assignedTitles(classroomId, rows.map((q) => q.id)) : new Map<string, string[]>();
  return {
    items: rows.map((q) => {
      const passage = q.currentPublishedRevision?.passageText?.trim() ?? "";
      return {
        id: q.id,
        category: q.category,
        difficulty: q.difficulty,
        questionType: q.questionType,
        snippet: snippetOf(q.currentPublishedRevision?.questionText ?? ""),
        hasPassage: passage.length > 0,
        passageSnippet: passage ? snippetOf(passage, PASSAGE_SNIPPET_LENGTH) : null,
        assignedIn: assigned.get(q.id) ?? [],
      };
    }),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / QUESTION_BANK_PAGE_SIZE)),
  };
}

/**
 * "Add 10 at random" from the current filters: ids only, never already
 * picked ones. Seeded per call; no attempt at being clever — a teacher who
 * wants a particular mix picks it by hand.
 */
export async function pickRandomQuestions(
  filters: BankFilters,
  count: number,
  excludeIds: string[],
  classroomId?: string,
): Promise<string[]> {
  const candidates = await prisma.question.findMany({
    where: { ...whereFor(filters, classroomId), id: { notIn: excludeIds } },
    select: { id: true },
  });
  return shuffle(
    candidates.map((c) => c.id),
    createRandom(generateSeed()),
  ).slice(0, Math.max(0, count));
}

export type BankItemSummary = Pick<
  BankItem,
  "id" | "category" | "difficulty" | "questionType" | "snippet" | "passageSnippet"
>;

/** The chosen list, in the order given, for the builder's right-hand column. */
export async function describeQuestions(ids: string[]): Promise<BankItemSummary[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.question.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    select: {
      id: true,
      category: true,
      difficulty: true,
      questionType: true,
      currentPublishedRevision: { select: { questionText: true, passageText: true } },
    },
  });
  const byId = new Map(rows.map((q) => [q.id, q]));
  return ids.flatMap((id) => {
    const q = byId.get(id);
    if (!q) return [];
    const passage = q.currentPublishedRevision?.passageText?.trim() ?? "";
    return [
      {
        id: q.id,
        category: q.category,
        difficulty: q.difficulty,
        questionType: q.questionType,
        snippet: snippetOf(q.currentPublishedRevision?.questionText ?? ""),
        passageSnippet: passage ? snippetOf(passage, PASSAGE_SNIPPET_LENGTH) : null,
      },
    ];
  });
}

/**
 * A question with its answer key, for a teacher deciding whether to assign it
 * or reviewing one they did. Published revisions only; an assigned question
 * is shown at the revision the class was given.
 */
export async function getQuestionWithKey(
  questionRevisionId: string,
): Promise<{ content: StudentQuestionContent; feedback: StudentQuestionFeedback }> {
  const [content, feedback] = await Promise.all([
    getStudentQuestionContent(questionRevisionId),
    getStudentQuestionFeedback(questionRevisionId),
  ]);
  return { content, feedback };
}

export async function publishedRevisionOf(questionId: string): Promise<string> {
  const q = await prisma.question.findUnique({
    where: { id: questionId },
    select: { status: true, currentPublishedRevisionId: true },
  });
  if (!q || q.status !== "PUBLISHED" || !q.currentPublishedRevisionId) {
    throw new TeacherError("NOT_FOUND", "That question isn't available.");
  }
  return q.currentPublishedRevisionId;
}
