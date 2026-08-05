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
  sort?: QuestionListSort;
  page?: number;
  pageSize?: 25 | 50 | 100;
};

const REVISION_INCLUDE = {
  answerChoices: { orderBy: { order: "asc" as const } },
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

function sortByFixedOrder(rows: QuestionListRow[], sort: QuestionListSort | undefined): QuestionListRow[] {
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
