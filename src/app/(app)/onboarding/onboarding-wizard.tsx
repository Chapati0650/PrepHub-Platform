"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Marker } from "@/components/ui/marker";
import { STUDY_COMMITMENT_OPTIONS, getRecommendedPace } from "@/lib/onboarding/study-commitment";
import { GoalScorePicker } from "./goal-score-picker";
import { completeOnboardingAction } from "./actions";
import type { StudyCommitment } from "@/generated/prisma/client";

const GRADES = [
  { value: 9, label: "9th Grade", caption: "Freshman year" },
  { value: 10, label: "10th Grade", caption: "Sophomore year" },
  { value: 11, label: "11th Grade", caption: "Junior year" },
  { value: 12, label: "12th Grade", caption: "Senior year" },
] as const;
const STEP_COUNT = 4; // (Welcome — no longer shown), Grade, Target Score, Study Commitment
const FIRST_STEP = 1;

// Mirrors the three upcoming questions 1:1, so the welcome screen doubles as
// a real preview instead of generic filler copy. Each one used to carry the
// same Lucide glyph that reappeared as its step's heading badge; the ordinal
// does that job now (see CLAUDE.md — decorative icon tiles were the loudest
// element in every wizard step and told the student nothing).
const WELCOME_ITEMS = [
  { title: "Your grade", body: "So PrepHub can pace your plan around your timeline." },
  { title: "Your target score", body: "So your progress is measured against a real goal." },
  { title: "Your study commitment", body: "So PrepHub can recommend a pace that fits your schedule." },
] as const;

// A small filled/unfilled bar meter standing in for a commitment "intensity"
// — it reuses the same fill/track treatment as everywhere else color carries
// one signal, and it's the same height-encodes-magnitude idea the goal-score
// chart uses one step earlier.
function IntensityMeter({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="flex h-5 shrink-0 items-end gap-0.5" aria-hidden>
      {([1, 2, 3] as const).map((bar) => (
        <span
          key={bar}
          style={{ height: `${40 + bar * 20}%` }}
          className={`w-1.5 rounded-full ${bar <= level ? "bg-primary" : "bg-foreground/15"}`}
        />
      ))}
    </div>
  );
}

const STUDY_COMMITMENT_LEVELS: Partial<Record<StudyCommitment, 1 | 2 | 3>> = {
  LIGHT: 1,
  MODERATE: 2,
  INTENSIVE: 3,
};

function OptionCard({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      // rounded-xl and a two-tone selected state rather than a bordered card
      // with a check-circle stuck in the corner — the corner check was a
      // second indicator saying what the fill already said.
      className={`relative rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-accent text-accent-foreground"
          : "border-border hover:border-foreground/30 hover:bg-muted/50"
      } ${className}`}
    >
      {children}
    </button>
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

export function OnboardingWizard() {
  // Starts on Grade: this wizard now runs after the Diagnostic results, so
  // the welcome screen's "answer three quick questions" preamble is one
  // more screen between a student and their free practice set.
  const [step, setStep] = useState(FIRST_STEP);
  const [grade, setGrade] = useState<number | null>(null);
  const [targetScoreMidpoint, setTargetScoreMidpoint] = useState<number | null | undefined>(undefined);
  const [studyCommitment, setStudyCommitment] = useState<StudyCommitment | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFinish() {
    if (grade === null || targetScoreMidpoint === undefined || studyCommitment === null) return;
    startTransition(async () => {
      await completeOnboardingAction({ grade, targetScoreMidpoint, studyCommitment });
    });
  }

  const canContinue =
    step === 0 ||
    (step === 1 && grade !== null) ||
    (step === 2 && targetScoreMidpoint !== undefined) ||
    (step === 3 && studyCommitment !== null);

  return (
    // Left-aligned in a reading-width column with no card around it, matching
    // the diagnostic intro flow this leads into — both run in the app shell's
    // focus mode, where a bordered card is a frame around the whole viewport.
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center gap-10 p-6 sm:p-10">
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT - FIRST_STEP}
      >
        {Array.from({ length: STEP_COUNT - FIRST_STEP }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i + FIRST_STEP <= step ? "bg-primary" : "bg-foreground/10"}`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-10">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Welcome</p>
            <h1 className="mt-3 text-display-sm text-balance sm:text-display">
              Let&apos;s build your <Marker>SAT plan</Marker>.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">
              Answer three quick questions so PrepHub can personalize your experience.
            </p>
          </div>
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {WELCOME_ITEMS.map(({ title, body }, i) => (
              <li key={title} className="flex items-baseline gap-5 py-5">
                <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
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
          <StepHeading step={1} title="What grade are you in?">
            You have your score. Three quick questions and your free practice set opens.
          </StepHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GRADES.map((g) => (
              <OptionCard key={g.value} selected={grade === g.value} onClick={() => setGrade(g.value)}>
                <p className="font-heading text-display-sm font-semibold tabular-nums">{g.value}</p>
                <p className="mt-1 text-sm font-medium">{g.label}</p>
                <p className="text-xs text-muted-foreground">{g.caption}</p>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-8">
          <StepHeading step={2} title="What's your target SAT score?">
            Pick the band you&apos;re aiming for. You can change it any time in Settings.
          </StepHeading>
          <GoalScorePicker value={targetScoreMidpoint} onChange={setTargetScoreMidpoint} />
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-8">
          <StepHeading step={3} title="How much time can you dedicate to SAT prep?" />
          <div className="flex flex-col gap-2.5">
            {STUDY_COMMITMENT_OPTIONS.map((option) => {
              const level = STUDY_COMMITMENT_LEVELS[option.value];
              return (
                <OptionCard
                  key={option.value}
                  selected={studyCommitment === option.value}
                  onClick={() => setStudyCommitment(option.value)}
                >
                  <div className="flex items-center gap-4">
                    {level ? <IntensityMeter level={level} /> : <span className="w-[1.375rem] shrink-0" aria-hidden />}
                    <div>
                      <p className="font-medium">{option.label}</p>
                      {option.description && <p className="text-sm text-muted-foreground">{option.description}</p>}
                    </div>
                  </div>
                </OptionCard>
              );
            })}
          </div>

          {studyCommitment && (
            <div className="rounded-2xl bg-surface-tint p-5">
              <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Your recommended pace
              </p>
              <p className="mt-2 text-lg">
                <span className="font-medium">{getRecommendedPace(studyCommitment).label}</span>{" "}
                <span className="text-muted-foreground">{getRecommendedPace(studyCommitment).description}</span>
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {step < STEP_COUNT - 1 ? (
          <Button size="cta" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continue
          </Button>
        ) : (
          <Button size="cta" onClick={handleFinish} disabled={!canContinue || pending}>
            {pending ? "Saving…" : "Open my free practice set"}
          </Button>
        )}
        {step > FIRST_STEP && (
          <Button size="cta" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            Back
          </Button>
        )}
      </div>
    </div>
  );
}
