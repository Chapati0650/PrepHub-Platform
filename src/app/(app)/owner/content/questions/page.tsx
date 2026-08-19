import { listQuestions, parseQuestionListFilters } from "@/lib/content/list-questions";
import { QuestionsTable } from "./questions-table";

type SearchParams = Record<string, string | string[] | undefined>;

// PRD-015 §4: the Questions page — the default landing page for the content
// dashboard. Filters/search/sort/page all live in the URL so they survive
// opening/closing Student Preview and are directly shareable/bookmarkable.
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseQuestionListFilters(await searchParams);
  const { rows, totalCount } = await listQuestions(filters);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <QuestionsTable rows={rows} totalCount={totalCount} filters={filters} />
    </div>
  );
}
