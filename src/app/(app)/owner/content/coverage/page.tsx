import Link from "next/link";
import { getContentCoverage } from "@/lib/content/coverage";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "@/lib/content/constants";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";

// PRD-015 §11: Category × Difficulty matrix.
export default async function ContentCoveragePage() {
  const cells = await getContentCoverage();
  const cellFor = (category: (typeof CATEGORY_ORDER)[number], difficulty: (typeof DIFFICULTY_ORDER)[number]) =>
    cells.find((c) => c.category === category && c.difficulty === difficulty)!;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Content Coverage</h1>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left font-medium">Category</th>
              {DIFFICULTY_ORDER.map((d) => (
                <th key={d} className="p-3 text-left font-medium">
                  {DIFFICULTY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((category) => (
              <tr key={category} className="border-b border-border">
                <td className="p-3 font-medium">{CATEGORY_LABELS[category]}</td>
                {DIFFICULTY_ORDER.map((difficulty) => {
                  const cell = cellFor(category, difficulty);
                  const params = new URLSearchParams({ category, difficulty });
                  const hasNoPublished = cell.publishedCount === 0;
                  return (
                    <td key={difficulty} className="p-3 align-top">
                      <Link
                        href={`/owner/content/questions?${params.toString()}`}
                        className={`flex flex-col gap-0.5 rounded-md p-2 hover:bg-muted ${hasNoPublished ? "bg-destructive/5" : ""}`}
                      >
                        <span className={hasNoPublished ? "font-medium text-destructive" : "font-medium"}>
                          {cell.publishedCount} published
                        </span>
                        <span className="text-xs text-muted-foreground">{cell.draftCount} draft/revision</span>
                        <span className="text-xs text-muted-foreground">{cell.missingVideoCount} missing video</span>
                        <span className="text-xs text-muted-foreground">
                          {cell.missingWrittenExplanationCount} missing explanation
                        </span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
