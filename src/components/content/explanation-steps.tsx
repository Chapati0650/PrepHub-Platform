import { LatexText } from "./latex-text";

export type ExplanationStepData = { text: string; imageId: string | null };

// Shared between the student-facing session runner/results and the Owner's
// Student Preview drawer (different media route prefixes: /api/media for
// students, /api/owner/media for the Owner), so the two can't drift apart —
// same reasoning as getPublishIssues being shared between preview and publish.
export function ExplanationSteps({
  steps,
  mediaBasePath,
}: {
  steps: ExplanationStepData[];
  mediaBasePath: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => (
        <li key={i} className="rounded-md bg-muted p-3 text-sm">
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Step {i + 1}</p>
          <LatexText text={step.text} />
          {step.imageId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${mediaBasePath}/${step.imageId}`} alt="" className="mt-2 max-w-full rounded" />
          )}
        </li>
      ))}
    </ol>
  );
}
