"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Flame, Gauge, Layers, ListChecks, RefreshCw, Target, TrendingUp, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { IconBadge } from "@/components/icon-badge";

const WELCOME_ITEMS = [
  { icon: ListChecks, title: "21 Questions", body: "A balanced diagnostic across SAT categories and difficulty levels." },
  { icon: TrendingUp, title: "Your First Prediction", body: "Receive your initial predicted SAT score range when you finish." },
  { icon: Wand2, title: "Personalized Practice", body: "Your results will be used to create your first adaptive practice set." },
] as const;

// PRD-012 §6-§7: a short, skippable-only-by-exploring multi-screen product
// introduction, shown once before the diagnostic begins. Each screen carries
// its own icon so the flow reads as a series of distinct ideas rather than
// six visually-identical text cards.
const SCREENS = [
  {
    icon: RefreshCw,
    heading: "PrepHub Learns With You",
    body: "PrepHub continuously updates your learning experience. Every set you complete helps determine which questions you receive next.",
  },
  {
    icon: Target,
    heading: "Every Answer Matters",
    body: "Try your best on every question. Your answers help PrepHub understand what you know and what you should practice next.",
  },
  {
    icon: Layers,
    heading: "Complete One Set at a Time",
    body: "For the best results, complete one full set whenever you practice. Each completed set gives PrepHub new information about your progress.",
  },
  {
    icon: TrendingUp,
    heading: "Your Prediction Keeps Updating",
    body: "After every completed set, PrepHub updates your predicted SAT score range so you can see how your preparation is progressing.",
  },
  {
    icon: BookOpenCheck,
    heading: "Learn From Every Question",
    body: "After submitting each answer, you will immediately receive the correct answer, a written explanation, and a video explanation.",
  },
  {
    icon: Gauge,
    heading: "Built for Efficient Progress",
    body: "PrepHub is designed to help you find your weaknesses, learn from mistakes, and improve as efficiently as possible.",
  },
] as const;

export function IntroScreens({ onBegin }: { onBegin: () => Promise<void> }) {
  const router = useRouter();
  const [index, setIndex] = useState(-1);
  const [beginning, setBeginning] = useState(false);
  const isWelcomeScreen = index === -1;
  const isFinalScreen = index === SCREENS.length;

  async function handleBegin() {
    setBeginning(true);
    await onBegin();
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
      {!isWelcomeScreen && (
        <div className="flex gap-1.5" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={SCREENS.length + 1}>
          {Array.from({ length: SCREENS.length + 1 }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full transition-colors ${i <= index ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      )}

      {isWelcomeScreen ? (
        <div className="flex w-full flex-col items-center gap-8 rounded-xl border border-border bg-card p-10">
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-2xl font-semibold">Let&apos;s find your starting point.</h1>
            <p className="text-muted-foreground text-balance">
              This 21-question diagnostic will help PrepHub understand your current strengths and weaknesses across
              the SAT.
            </p>
          </div>
          <div className="flex flex-col gap-4 text-left">
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
          <Button size="lg" onClick={() => setIndex(0)}>
            Start Diagnostic
          </Button>
        </div>
      ) : isFinalScreen ? (
        <div className="flex w-full flex-col items-center gap-8 rounded-xl border border-border bg-card p-10 sm:p-14">
          <IconBadge icon={Flame} size="xl" />
          <p className="text-xl font-semibold text-balance">
            Talent may affect where you begin. Consistent effort determines how far you go.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => void handleBegin()} disabled={beginning}>
              {beginning ? "Preparing your diagnostic…" : "Begin Diagnostic"}
            </Button>
            <LinkButton size="lg" variant="outline" href="/home">
              Explore PrepHub
            </LinkButton>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-6 rounded-xl border border-border bg-card p-10 sm:p-14">
          <IconBadge icon={SCREENS[index].icon} size="xl" />
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-3xl font-semibold">{SCREENS[index].heading}</h1>
            <p className="max-w-sm text-lg text-muted-foreground text-balance">{SCREENS[index].body}</p>
          </div>
          <div className="mt-4 flex gap-3">
            {index > 0 && (
              <Button variant="ghost" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            <Button onClick={() => setIndex((i) => i + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
