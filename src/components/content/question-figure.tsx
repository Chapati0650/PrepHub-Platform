"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useOnQuestion } from "./walkthrough/context";

// A question's figure. While a walkthrough runs on the question and draws
// the figure again in its stage (a graph, a diagram, a chart or a table),
// the original folds to a thumbnail with a button, rather than the same
// chart appearing twice, one above the other, with the explanation's bar
// covering half of the first.

const REDRAWN = new Set(["plane", "diagram", "bars", "table"]);

export function QuestionFigure({ src }: { src: string }) {
  const wt = useOnQuestion();
  const [open, setOpen] = useState(false);
  const redrawn = !!wt && wt.view.spec.panels.some((p) => REDRAWN.has(p.type));
  // eslint-disable-next-line @next/next/no-img-element
  if (!redrawn) return <img src={src} alt="" className="mt-3 max-w-full rounded" />;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-3 rounded-lg border border-border px-2 py-1.5 text-left text-sm hover:bg-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className={cn("h-12 w-auto rounded-sm border border-border bg-white object-contain", open && "hidden")} />
        <span>
          <span className="font-medium">{open ? "Hide the original figure" : "Original figure"}</span>
          {!open && <span className="block text-xs text-muted-foreground">Redrawn below for the explanation · Show</span>}
        </span>
      </button>
      {open && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="mt-2 max-w-full rounded" />
      )}
    </div>
  );
}
