import { listQuestions, type QuestionListFilters, type QuestionListSort } from "@/lib/content/list-questions";
import { QuestionsTable } from "./questions-table";

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(searchParams: SearchParams): QuestionListFilters {
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
    sort: (one(searchParams.sort) as QuestionListSort | undefined) ?? "UPDATED_DESC",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: [25, 50, 100].includes(pageSize) ? (pageSize as 25 | 50 | 100) : 50,
  };
}

// PRD-015 §4: the Questions page — the default landing page for the content
// dashboard. Filters/search/sort/page all live in the URL so they survive
// opening/closing Student Preview and are directly shareable/bookmarkable.
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseFilters(await searchParams);
  const { rows, totalCount } = await listQuestions(filters);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <QuestionsTable rows={rows} totalCount={totalCount} filters={filters} />
    </div>
  );
}
