"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Marker } from "@/components/ui/marker";
import { GRADES } from "@/lib/college-apps/cycle";
import { PLATFORM_LABEL, PLATFORM_ORDER, PLATFORM_PROMPTS } from "@/lib/college-apps/platform-prompts";
import { completeCollegeOnboardingAction } from "../actions";

const STEP_COUNT = 3; // Welcome, Grade, Platforms

// The same roulette as the SAT onboarding (src/app/(app)/onboarding), by the
// Owner's direction: one question per screen, not a survey. Two questions —
// grade decides the whole view, platforms decide which shared essays are
// seeded. Colleges are added afterwards from the tracker, not here.
export function CollegeOnboardingWizard({ initialGrade }: { initialGrade: number | null }) {
  const [step, setStep] = useState(0);
  const [grade, setGrade] = useState<number | null>(initialGrade);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const canContinue = step === 0 || (step === 1 && grade !== null) || step === 2;

  function finish() {
    if (grade === null) return;
    startTransition(async () => {
      await completeCollegeOnboardingAction({ grade, platforms });
    });
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center gap-10 p-6 sm:p-10">
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEP_COUNT}>
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-foreground/10"}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-10">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">College Apps</p>
            <h1 className="mt-3 text-display-sm text-balance sm:text-display">
              Every application, every prompt, <Marker>one list</Marker>.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">
              Two quick questions and PrepHub sets up your tracker — the essays your platforms ask for, and a place for
              every college on your list.
            </p>
          </div>
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {[
              ["Your grade", "So the tracker shows what this year is actually for."],
              ["Your platforms", "Common App, UC, Coalition, ApplyTexas — each one's shared essays get added for you."],
              ["Your colleges", "Add them next; each brings its own prompts, and a score fit against your prediction."],
            ].map(([title, body], i) => (
              <li key={title} className="flex items-baseline gap-5 py-5">
                <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-8">
          <StepHeading step={1} title="What grade are you in?" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GRADES.map((g) => (
              <OptionCard key={g.value} selected={grade === g.value} onClick={() => setGrade(g.value)}>
                <p className="font-heading text-display-sm font-semibold tabular-nums">{g.value}</p>
                <p className="mt-1 text-sm font-medium">{g.label}</p>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-8">
          <StepHeading step={2} title="Which applications will you be filling out?">
            Pick every one that applies. Leave them all blank if you&apos;re not sure yet &mdash; you can change this
            later.
          </StepHeading>
          <div className="flex flex-col gap-2.5">
            {PLATFORM_ORDER.filter((p) => p !== "OTHER").map((p) => {
              const selected = platforms.includes(p);
              return (
                <OptionCard
                  key={p}
                  selected={selected}
                  onClick={() => setPlatforms((prev) => (selected ? prev.filter((x) => x !== p) : [...prev, p]))}
                >
                  <p className="font-medium">{PLATFORM_LABEL[p]}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{PLATFORM_PROMPTS[p].intro}</p>
                </OptionCard>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {step < STEP_COUNT - 1 ? (
          <Button size="cta" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continue
          </Button>
        ) : (
          <Button size="cta" onClick={finish} disabled={!canContinue || pending}>
            {pending ? "Setting up…" : "Set up my tracker"}
          </Button>
        )}
        {step > 0 && (
          <Button size="cta" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            Back
          </Button>
        )}
      </div>
    </div>
  );
}

function StepHeading({ step, title, children }: { step: number; title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <p className="font-heading text-caption font-semibold tracking-[0.12em] text-muted-foreground tabular-nums uppercase">
        Step {String(step).padStart(2, "0")} / {String(STEP_COUNT - 1).padStart(2, "0")}
      </p>
      <h1 className="mt-3 text-display-sm text-balance">{title}</h1>
      {children && <p className="mt-4 max-w-prose text-lg text-muted-foreground">{children}</p>}
    </div>
  );
}

function OptionCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected ? "border-primary bg-accent text-accent-foreground" : "border-border hover:border-foreground/30 hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}
