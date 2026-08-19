import { LatexText } from "./latex-text";
import { cn } from "@/lib/utils";

// Shared across every surface that renders a question's stem (session
// runner, session results' question review, the Owner's inline editor
// preview, and the Student Preview drawer) — same reasoning as
// ExplanationSteps being shared: these can't be allowed to drift apart.
// A quiet background tint (not a border — this already usually sits inside
// an outer bordered card, and a nested border-in-border reads as visual
// clutter) is what gives the question its own "zone," distinct from both the
// plain page/card background above it and the filled-gray explanation step
// cards below it, so the eye has a consistent cue for "this is the question"
// vs. "this is the walkthrough" even though both live in the same card.
export function QuestionStatement({
  text,
  imageId,
  mediaBasePath,
  textClassName,
  className,
}: {
  text: string;
  imageId: string | null;
  mediaBasePath: string;
  textClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md bg-muted/50 p-4", className)}>
      <LatexText text={text} className={textClassName ?? "text-base"} />
      {imageId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${mediaBasePath}/${imageId}`} alt="" className="mt-3 max-w-full rounded" />
      )}
    </div>
  );
}
