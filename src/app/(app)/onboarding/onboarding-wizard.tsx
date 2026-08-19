"use client";

import { useState, useTransition } from "react";
import type { ComponentType } from "react";
import { CalendarDays, Check, Flag, GraduationCap, HelpCircle, Rocket, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/icon-badge";
import { ONBOARDING_SCORE_RANGES } from "@/lib/onboarding/target-score-options";
import { STUDY_COMMITMENT_OPTIONS, getRecommendedPace } from "@/lib/onboarding/study-commitment";
import { completeOnboardingAction } from "./actions";
import type { StudyCommitment } from "@/generated/prisma/client";

const GRADES = [
  { value: 9, label: "9th Grade", caption: "Freshman year" },
  { value: 10, label: "10th Grade", caption: "Sophomore year" },
  { value: 11, label: "11th Grade", caption: "Junior year" },
  { value: 12, label: "12th Grade", caption: "Senior year" },
] as const;
const STEP_COUNT = 4; // Welcome, Grade, Target Score, Study Commitment

// Mirrors the three upcoming questions 1:1 — the same icon reappears as each
// step's own heading badge below, so the welcome screen doubles as a real
// preview instead of generic filler copy.
const WELCOME_ITEMS = [
  { icon: GraduationCap, title: "Your grade", body: "So PrepHub can pace your plan around your timeline." },
  { icon: Flag, title: "Your target score", body: "So your progress is measured against a real goal." },
  { icon: Timer, title: "Your study commitment", body: "So PrepHub can recommend a pace that fits your schedule." },
] as const;

// A small filled/unfilled bar meter standing in for a commitment "intensity"
// — a genuinely new visual rather than another stock icon, and it reuses the
// same fill/track colors as everywhere else color is used for one signal.
function IntensityMeter({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" aria-hidden>
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={`h-4 w-1.5 rounded-full ${bar <= level ? "bg-primary" : "bg-muted"}`} />
      ))}
    </div>
  );
}

const STUDY_COMMITMENT_VISUALS: Record<StudyCommitment, { kind: "meter"; level: 1 | 2 | 3 } | { kind: "icon"; icon: ComponentType<{ className?: string }> }> = {
  LIGHT: { kind: "meter", level: 1 },
  MODERATE: { kind: "meter", level: 2 },
  INTENSIVE: { kind: "meter", level: 3 },
  FEW_TIMES_WEEK: { kind: "icon", icon: CalendarDays },
  UNSURE: { kind: "icon", icon: HelpCircle },
};

function OptionCard({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative rounded-lg border p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-accent"
          : "border-border bg-card hover:border-primary/50 hover:bg-muted"
      } ${className}`}
    >
      {children}
      {selected && (
        <span className="absolute top-2 right-2 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" aria-hidden />
        </span>
      )}
    </button>
  );
}

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
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
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl flex-col items-center justify-center gap-6 p-8">
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEP_COUNT}>
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <span key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="flex w-full flex-col items-center gap-8 rounded-xl border border-border bg-card p-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <IconBadge icon={Rocket} />
            <h1 className="text-2xl font-semibold">Let&apos;s build your SAT plan.</h1>
            <p className="text-muted-foreground text-balance">
              Answer three quick questions so PrepHub can personalize your experience.
            </p>
          </div>
          <div className="flex w-full flex-col gap-4 text-left">
            {WELCOME_ITEMS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-3">
                <IconBadge icon={Icon} size="sm" className="mt-0.5" />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <IconBadge icon={GraduationCap} />
            <h1 className="text-2xl font-semibold">What grade are you in?</h1>
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            {GRADES.map((g) => (
              <OptionCard key={g.value} selected={grade === g.value} onClick={() => setGrade(g.value)} className="text-center">
                <p className="text-2xl font-heading font-semibold tabular-nums">{g.value}</p>
                <p className="text-sm font-medium">{g.label}</p>
                <p className="text-xs text-muted-foreground">{g.caption}</p>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <IconBadge icon={Flag} />
            <h1 className="text-2xl font-semibold">What&apos;s your target SAT score?</h1>
            <p className="text-sm text-muted-foreground text-balance">
              Showing competitive goal ranges of {ONBOARDING_SCORE_RANGES[0].scoreMin}+.
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
            {[...ONBOARDING_SCORE_RANGES].reverse().map((range) => (
              <OptionCard
                key={range.index}
                selected={targetScoreMidpoint === range.midpoint}
                onClick={() => setTargetScoreMidpoint(range.midpoint)}
                className="text-center text-sm font-medium tabular-nums"
              >
                {range.scoreMin}–{range.scoreMax}
              </OptionCard>
            ))}
            <OptionCard
              selected={targetScoreMidpoint === null}
              onClick={() => setTargetScoreMidpoint(null)}
              className="col-span-3 text-center text-sm font-medium sm:col-span-4"
            >
              I&apos;m not sure yet
            </OptionCard>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <IconBadge icon={Timer} />
            <h1 className="text-2xl font-semibold">How much time can you dedicate to SAT prep?</h1>
          </div>
          <div className="flex w-full flex-col gap-2">
            {STUDY_COMMITMENT_OPTIONS.map((option) => {
              const visual = STUDY_COMMITMENT_VISUALS[option.value];
              return (
                <OptionCard key={option.value} selected={studyCommitment === option.value} onClick={() => setStudyCommitment(option.value)}>
                  <div className="flex items-center gap-3">
                    {visual.kind === "meter" ? (
                      <IntensityMeter level={visual.level} />
                    ) : (
                      <visual.icon className="size-5 shrink-0 text-muted-foreground" />
                    )}
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
            <div className="w-full rounded-lg border border-border bg-accent p-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your recommended pace</p>
              <p className="mt-1 font-medium">
                {getRecommendedPace(studyCommitment).label} {getRecommendedPace(studyCommitment).description}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            Back
          </Button>
        )}
        {step < STEP_COUNT - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continue
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={!canContinue || pending}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        )}
      </div>
    </div>
  );
}
