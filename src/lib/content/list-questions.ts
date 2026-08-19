import { prisma } from "@/lib/prisma";
import type {
  ContentStatus,
  Prisma,
  QuestionCategory,
  QuestionDifficulty,
  QuestionType,
} from "@/generated/prisma/client";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "./constants";

export type QuestionListSort =
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "CATEGORY"
  | "DIFFICULTY";

export type QuestionListFilters = {
  search?: string;
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  questionType?: QuestionType;
  status?: ContentStatus;
  familyMembership?: "IN_FAMILY" | "NOT_IN_FAMILY";
  videoStatus?: "PRESENT" | "MISSING";
  writtenExplanationStatus?: "PRESENT" | "MISSING";
  reviewStatus?: "NEEDS_REVIEW" | "REVIEWED";
  sort?: QuestionListSort;
  page?: number;
  pageSize?: 25 | 50 | 100;
};

const REVISION_INCLUDE = {
  answerChoices: { orderBy: { order: "asc" as const } },
  explanationSteps: { orderBy: { order: "asc" as const } },
  standaloneVideo: true,
  questionImage: true,
} satisfies Prisma.QuestionRevisionInclude;

const LIST_ROW_INCLUDE = {
  currentDraftRevision: { include: REVISION_INCLUDE },
  currentPublishedRevision: { include: REVISION_INCLUDE },
  family: { include: { sharedVideo: true } },
} satisfies Prisma.QuestionInclude;

export type QuestionListRow = Prisma.QuestionGetPayload<{ include: typeof LIST_ROW_INCLUDE }>;

// Archived questions are excluded from the default view unless explicitly
// filtered for (PRD-015 §4.2) — status:"ARCHIVED" is the only way to see them.
export function buildWhere(filters: QuestionListFilters): Prisma.QuestionWhereInput {
  const clauses: Prisma.QuestionWhereInput[] = [];

  if (filters.status) {
    clauses.push({ status: filters.status });
  } else {
    clauses.push({ status: { not: "ARCHIVED" } });
  }

  if (filters.category) clauses.push({ category: filters.category });
  if (filters.difficulty) clauses.push({ difficulty: filters.difficulty });
  if (filters.questionType) clauses.push({ questionType: filters.questionType });
  if (filters.familyMembership === "IN_FAMILY") clauses.push({ familyId: { not: null } });
  if (filters.familyMembership === "NOT_IN_FAMILY") clauses.push({ familyId: null });

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    clauses.push({
      OR: [
        { currentDraftRevision: { questionText: { contains: q, mode: "insensitive" } } },
        {
          AND: [
            { currentDraftRevisionId: null },
            { currentPublishedRevision: { questionText: { contains: q, mode: "insensitive" } } },
          ],
        },
      ],
    });
  }

  if (filters.videoStatus) {
    // Family members: video readiness comes from the family's shared video.
    // Standalone: from whichever revision is currently editable (draft, else
    // published). "Missing" is just NOT "ready" — that covers both "no video
    // uploaded at all" and "uploaded but still processing/failed" in one negation.
    const readyCondition: Prisma.QuestionWhereInput = {
      OR: [
        { familyId: { not: null }, family: { sharedVideo: { status: "READY" } } },
        { familyId: null, currentDraftRevisionId: { not: null }, currentDraftRevision: { standaloneVideo: { status: "READY" } } },
        {
          familyId: null,
          currentDraftRevisionId: null,
          currentPublishedRevision: { standaloneVideo: { status: "READY" } },
        },
      ],
    };
    clauses.push(filters.videoStatus === "PRESENT" ? readyCondition : { NOT: readyCondition });
  }

  if (filters.writtenExplanationStatus) {
    const present = filters.writtenExplanationStatus === "PRESENT";
    const draftHas: Prisma.QuestionWhereInput = present
      ? { currentDraftRevision: { AND: [{ writtenExplanation: { not: null } }, { writtenExplanation: { not: "" } }] } }
      : {
          OR: [
            { currentDraftRevision: { writtenExplanation: null } },
            { currentDraftRevision: { writtenExplanation: "" } },
          ],
        };
    const publishedHas: Prisma.QuestionWhereInput = present
      ? {
          currentDraftRevisionId: null,
          currentPublishedRevision: {
            AND: [{ writtenExplanation: { not: null } }, { writtenExplanation: { not: "" } }],
          },
        }
      : {
          currentDraftRevisionId: null,
          OR: [
            { currentPublishedRevision: { writtenExplanation: null } },
            { currentPublishedRevision: { writtenExplanation: "" } },
          ],
        };
    clauses.push({
      OR: [{ AND: [{ currentDraftRevisionId: { not: null } }, draftHas] }, publishedHas],
    });
  }

  if (filters.reviewStatus) {
    // Only ever true for bulk-uploaded questions (aiGenerated) — ordinary
    // human-authored questions match neither branch, same as how videoStatus
    // above scopes to whichever revision is currently editable (draft if one
    // exists, else published).
    const needsReview: Prisma.QuestionWhereInput = {
      OR: [
        { currentDraftRevisionId: { not: null }, currentDraftRevision: { aiGenerated: true, aiReviewedAt: null } },
        {
          currentDraftRevisionId: null,
          currentPublishedRevision: { aiGenerated: true, aiReviewedAt: null },
        },
      ],
    };
    const reviewed: Prisma.QuestionWhereInput = {
      OR: [
        { currentDraftRevisionId: { not: null }, currentDraftRevision: { aiGenerated: true, aiReviewedAt: { not: null } } },
        {
          currentDraftRevisionId: null,
          currentPublishedRevision: { aiGenerated: true, aiReviewedAt: { not: null } },
        },
      ],
    };
    clauses.push(filters.reviewStatus === "NEEDS_REVIEW" ? needsReview : reviewed);
  }

  return { AND: clauses };
}

function buildOrderBy(sort: QuestionListSort | undefined): Prisma.QuestionOrderByWithRelationInput[] {
  switch (sort) {
    case "UPDATED_ASC":
      return [{ updatedAt: "asc" }];
    case "CREATED_DESC":
      return [{ createdAt: "desc" }];
    case "CREATED_ASC":
      return [{ createdAt: "asc" }];
    case "CATEGORY":
      // Prisma can't sort by an arbitrary enum order directly — we sort client-side
      // for CATEGORY/DIFFICULTY (see sortByFixedOrder below) and only order by a
      // stable tiebreaker here.
      return [{ updatedAt: "desc" }];
    case "DIFFICULTY":
      return [{ updatedAt: "desc" }];
    case "UPDATED_DESC":
    default:
      return [{ updatedAt: "desc" }];
  }
}

// Generic over the row shape (not just the full QuestionListRow) so
// listQuestionIds below can reuse the exact same ordering on a lighter
// {id, category, difficulty}-only query instead of duplicating this logic.
function sortByFixedOrder<T extends { category: QuestionCategory; difficulty: QuestionDifficulty }>(
  rows: T[],
  sort: QuestionListSort | undefined,
): T[] {
  if (sort === "CATEGORY") {
    return [...rows].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  }
  if (sort === "DIFFICULTY") {
    return [...rows].sort((a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty));
  }
  return rows;
}

export async function listQuestions(
  filters: QuestionListFilters,
): Promise<{ rows: QuestionListRow[]; totalCount: number }> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize ?? 50;
  const where = buildWhere(filters);

  // Fixed-order sorts (category/difficulty use PRD-013's enum order, not
  // alphabetical) are applied in-memory on the page's rows — safe because the
  // DB query already narrowed to exactly one page via skip/take beforehand
  // would break the fixed-order sort, so for those two sorts we instead fetch
  // the matching rows in a stable DB order and re-sort before paginating.
  if (filters.sort === "CATEGORY" || filters.sort === "DIFFICULTY") {
    const all = await prisma.question.findMany({ where, include: LIST_ROW_INCLUDE, orderBy: { updatedAt: "desc" } });
    const sorted = sortByFixedOrder(all, filters.sort);
    const start = (page - 1) * pageSize;
    return { rows: sorted.slice(start, start + pageSize), totalCount: all.length };
  }

  const [rows, totalCount] = await Promise.all([
    prisma.question.findMany({
      where,
      include: LIST_ROW_INCLUDE,
      orderBy: buildOrderBy(filters.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.question.count({ where }),
  ]);
  return { rows, totalCount };
}

// Every matching id, in the exact same order listQuestions would render
// them, but unpaginated and with no revision/family data — powers the
// question editor's Previous/Next navigation (see [id]/page.tsx), which
// needs to find a question's neighbors across the whole filtered set, not
// just whatever page the Owner happened to click in from.
export async function listQuestionIds(filters: QuestionListFilters): Promise<string[]> {
  const where = buildWhere(filters);

  if (filters.sort === "CATEGORY" || filters.sort === "DIFFICULTY") {
    const all = await prisma.question.findMany({
      where,
      select: { id: true, category: true, difficulty: true },
      orderBy: { updatedAt: "desc" },
    });
    return sortByFixedOrder(all, filters.sort).map((r) => r.id);
  }

  const rows = await prisma.question.findMany({ where, select: { id: true }, orderBy: buildOrderBy(filters.sort) });
  return rows.map((r) => r.id);
}

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Shared by the Questions table page and the question editor page (for
// Previous/Next navigation) so both parse the same URL query params into
// filters identically — they must agree on what "the current filtered view"
// means, or Next could jump somewhere the table itself would never show.
export function parseQuestionListFilters(searchParams: SearchParams): QuestionListFilters {
  const page = Number(one(searchParams.page) ?? "1");
  const pageSize = Number(one(searchParams.pageSize) ?? "50");
  return {
    search: one(searchParams.search),
    category: one(searchParams.category) as QuestionListFilters["category"],
    difficulty: one(searchParams.difficulty) as QuestionListFilters["difficulty"],
    questionType: one(searchParams.questionType) as QuestionListFilters["questionType"],
    status: one(searchParams.status) as QuestionListFilters["status"],
    familyMembership: one(searchParams.familyMembership) as QuestionListFilters["familyMembership"],
    videoStatus: one(searchParams.videoStatus) as QuestionListFilters["videoStatus"],
    writtenExplanationStatus: one(searchParams.writtenExplanationStatus) as QuestionListFilters["writtenExplanationStatus"],
    reviewStatus: one(searchParams.reviewStatus) as QuestionListFilters["reviewStatus"],
    sort: (one(searchParams.sort) as QuestionListSort | undefined) ?? "UPDATED_DESC",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: [25, 50, 100].includes(pageSize) ? (pageSize as 25 | 50 | 100) : 50,
  };
}
