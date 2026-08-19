import { Lightbulb } from "lucide-react";
import { LatexText } from "./latex-text";

// Shared between the session runner (live) and session results (review) —
// same "can't drift apart" reasoning as ExplanationSteps/QuestionStatement.
// Deliberately quiet/neutral styling, not the destructive red used for the
// "Incorrect" message right above it — this is constructive ("here's likely
// what happened"), not another alarm, so it reads as a helpful aside rather
// than a second scolding.
export function DistractorNote({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Why this happened</p>
        <LatexText text={text} />
      </div>
    </div>
  );
}
