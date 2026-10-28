"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WalkthroughView } from "@/lib/content/walkthrough";
import { useOptionalWalkthrough, WalkthroughProvider, type StepText } from "./context";
import { formulasOf } from "@/lib/content/walkthrough";
import { FormulasUsed, WalkthroughDock, WalkthroughTakeaway } from "./dock";
import { WalkthroughStage } from "./stage";

// A question's explanation as a step-through. On a question page the
// provider is the page's (see context.tsx) and this draws only the stage,
// with the dock pinned at the end of the question. Anywhere else — the
// question editor's preview — it brings its own provider and draws the
// passage and choices itself, with the dock as an ordinary block below.

export type { StepText };

/** "All steps": the plain list, a way back to stepping, and the takeaway at the end. */
function AllSteps({ list }: { list: React.ReactNode }) {
  const wt = useOptionalWalkthrough();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => wt?.setMode("walkthrough")}>
          <ArrowRight data-icon="inline-start" />
          Step through it instead
        </Button>
      </div>
      {list}
      {wt?.view.spec.takeaway && <WalkthroughTakeaway text={wt.view.spec.takeaway} />}
      {wt && <FormulasUsed formulas={formulasOf(wt.view.spec)} />}
    </div>
  );
}

/** The walkthrough inside a question page's provider: the stage, or the list. The dock is the page's. */
export function HostedWalkthrough({ list }: { list: React.ReactNode }) {
  const wt = useOptionalWalkthrough();
  if (!wt) return <>{list}</>;
  if (wt.mode === "list") return <AllSteps list={list} />;
  return <WalkthroughStage />;
}

function SelfContained({ list }: { list: React.ReactNode }) {
  const wt = useOptionalWalkthrough();
  if (wt?.mode === "list") return <AllSteps list={list} />;
  return (
    <div className="flex flex-col gap-3">
      <WalkthroughStage />
      <WalkthroughDock pinned={false} />
    </div>
  );
}

export function Walkthrough({
  view,
  steps,
  mediaBasePath,
  list,
}: {
  view: WalkthroughView;
  steps: StepText[];
  mediaBasePath: string;
  /** The plain step list, for "All steps". */
  list: React.ReactNode;
}) {
  return (
    <WalkthroughProvider view={view} steps={steps} mediaBasePath={mediaBasePath} onQuestion={false}>
      <SelfContained list={list} />
    </WalkthroughProvider>
  );
}
