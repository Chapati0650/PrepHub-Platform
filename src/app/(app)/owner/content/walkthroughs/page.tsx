import Link from "next/link";
import { getWalkthroughFeedbackReport } from "@/lib/content/walkthrough-feedback";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import { PageHeader } from "@/components/page-header";
import { requireOwnerPage } from "@/lib/owner/guard";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/enums";

// What students said at the end of each walkthrough: "Got it" or "Still
// confused", and which step lost them. The explanations to rewrite first are
// at the top: the most confusing by share, then by count.

export default async function WalkthroughFeedbackPage() {
  await requireOwnerPage();
  const rows = await getWalkthroughFeedbackReport();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <PageHeader
        title="Walkthrough Feedback"
        description="What students said at the end of each explanation. The ones they found most confusing are first."
      />

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No answers yet. Students are asked &ldquo;Did this explanation make sense?&rdquo; on the last step of a walkthrough. Test
          accounts (example.com addresses) aren&apos;t counted.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="p-3 font-medium">Question</th>
                <th className="p-3 font-medium">Still confused</th>
                <th className="p-3 font-medium">Got it</th>
                <th className="p-3 font-medium">Lost them at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const total = row.helpful + row.confused;
                return (
                  <tr key={row.questionId} className="border-b border-border last:border-b-0">
                    <td className="max-w-xl p-3">
                      <Link href={`/owner/content/questions/${row.questionId}`} className="font-medium hover:underline">
                        {row.preview || "(no question text)"}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {CATEGORY_LABELS[row.category as QuestionCategory]} · {DIFFICULTY_LABELS[row.difficulty as QuestionDifficulty]}
                      </p>
                    </td>
                    <td className="p-3 tabular-nums">
                      <span className={row.confused > 0 ? "font-semibold text-destructive" : undefined}>{row.confused}</span>
                      <span className="text-muted-foreground"> of {total}</span>
                    </td>
                    <td className="p-3 tabular-nums">{row.helpful}</td>
                    <td className="p-3">
                      {row.worstStep ? (
                        <>
                          Step {row.worstStep.step} <span className="text-muted-foreground">({row.worstStep.count})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
