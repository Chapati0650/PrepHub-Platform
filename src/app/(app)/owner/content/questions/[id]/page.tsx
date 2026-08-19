import { notFound } from "next/navigation";
import { getQuestionOrThrow } from "@/lib/content/questions";
import { ContentError } from "@/lib/content/errors";
import { listQuestionIds, parseQuestionListFilters } from "@/lib/content/list-questions";
import { QuestionEditor } from "./question-editor";

type SearchParams = Record<string, string | string[] | undefined>;

function toQueryString(searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params.toString();
}

export default async function QuestionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const rawSearchParams = await searchParams;

  const question = await getQuestionOrThrow(id).catch((err) => {
    if (err instanceof ContentError && err.code === "QUESTION_NOT_FOUND") return null;
    throw err;
  });
  if (!question) notFound();

  // Previous/Next navigation, scoped to whatever filtered/sorted view the
  // Owner arrived from (see questions-table.tsx's Edit links, which forward
  // the current query string) — falls back to every non-archived question in
  // default order if opened with no filter context (e.g. a bulk-upload
  // "Review question" link). Lets an Owner publishing a large batch move
  // through every question in it without ever returning to the table.
  const filters = parseQuestionListFilters(rawSearchParams);
  const ids = await listQuestionIds(filters);
  const currentIndex = ids.indexOf(id);
  const qs = toQueryString(rawSearchParams);
  const hrefFor = (questionId: string) => `/owner/content/questions/${questionId}${qs ? `?${qs}` : ""}`;

  const navigation =
    currentIndex === -1
      ? null
      : {
          prevHref: currentIndex > 0 ? hrefFor(ids[currentIndex - 1]) : null,
          nextHref: currentIndex < ids.length - 1 ? hrefFor(ids[currentIndex + 1]) : null,
          position: currentIndex + 1,
          total: ids.length,
        };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      {/* Keyed by question id so Previous/Next navigation (which reuses this
          same route component, just with a new [id] param) forces a full
          remount — every piece of local editor state is seeded from
          `question` only on mount, so without this key React would reuse the
          old instance and keep showing the previous question's edits. */}
      <QuestionEditor key={question.id} question={question} navigation={navigation} />
    </div>
  );
}
