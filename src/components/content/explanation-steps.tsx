import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WalkthroughView } from "@/lib/content/walkthrough";
import { LatexText } from "./latex-text";
import { Walkthrough } from "./walkthrough/walkthrough";

export type ExplanationStepData = { text: string; imageId: string | null };

// Shared between the student-facing session runner/results and the Owner's
// Student Preview drawer (different media route prefixes: /api/media for
// students, /api/owner/media for the Owner), so the two can't drift apart —
// same reasoning as getPublishIssues being shared between preview and publish.
//
// The final step gets a distinct treatment (thin teal border + solid teal
// numbered badge) instead of the same flat gray as every other step — that's
// the payoff/conclusion, and a run of identical boxes gave it no visual
// weight of its own. Deliberately teal (primary), not the achievement gold
// accent: CLAUDE.md reserves achievement for score/mastery-improvement
// moments specifically, never for answer-correctness, and this step is
// squarely about reaching the correct answer. Also deliberately a thin
// border rather than a filled color wash across the card — a full-card tint
// is exactly the "candy-colored SaaS" pattern this app's own design system
// walked back elsewhere; restraint here means color on the border and badge
// only, not the whole surface.
//
// With a walkthrough (a question imported with one, walkthrough.ts) the same
// steps become a step-through with a visual stage, and this list is one press
// away behind "All steps". The list stays the default for everything else.
export function ExplanationSteps({
  steps,
  mediaBasePath,
  walkthrough,
}: {
  steps: ExplanationStepData[];
  mediaBasePath: string;
  walkthrough?: WalkthroughView | null;
}) {
  if (steps.length === 0) return null;
  const list = <StepList steps={steps} mediaBasePath={mediaBasePath} />;
  if (walkthrough && walkthrough.spec.steps.length === steps.length) {
    return <Walkthrough view={walkthrough} steps={steps} mediaBasePath={mediaBasePath} list={list} />;
  }
  return list;
}

function StepList({ steps, mediaBasePath }: { steps: ExplanationStepData[]; mediaBasePath: string }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => {
        const isFinal = i === steps.length - 1;
        return (
          <li
            key={i}
            className={cn(
              "flex gap-3 rounded-md p-3 text-sm",
              isFinal ? "border border-primary/40 bg-card" : "bg-muted",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                isFinal ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground ring-1 ring-border",
              )}
              aria-hidden
            >
              {isFinal ? <Check className="size-3.5" /> : i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "mb-1 text-xs font-medium tracking-wide uppercase",
                  isFinal ? "text-primary" : "text-muted-foreground",
                )}
              >
                Step {i + 1}
              </p>
              <LatexText text={step.text} />
              {step.imageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${mediaBasePath}/${step.imageId}`} alt="" className="mt-2 max-w-full rounded" />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
