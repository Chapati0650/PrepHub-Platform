"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// PRD-012 §6-§7: a short, skippable-only-by-exploring multi-screen product
// introduction, shown once before the diagnostic begins.
const SCREENS = [
  {
    heading: "PrepHub Learns With You",
    body: "PrepHub continuously updates your learning experience. Every set you complete helps determine which questions you receive next.",
  },
  {
    heading: "Every Answer Matters",
    body: "Try your best on every question. Your answers help PrepHub understand what you know and what you should practice next.",
  },
  {
    heading: "Complete One Set at a Time",
    body: "For the best results, complete one full set whenever you practice. Each completed set gives PrepHub new information about your progress.",
  },
  {
    heading: "Your Prediction Keeps Updating",
    body: "After every completed set, PrepHub updates your predicted SAT score range so you can see how your preparation is progressing.",
  },
  {
    heading: "Learn From Every Question",
    body: "After submitting each answer, you will immediately receive the correct answer, a written explanation, and a video explanation.",
  },
  {
    heading: "Built for Efficient Progress",
    body: "PrepHub is designed to help you find your weaknesses, learn from mistakes, and improve as efficiently as possible.",
  },
] as const;

export function IntroScreens({ onBegin }: { onBegin: () => Promise<void> }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [beginning, setBeginning] = useState(false);
  const isFinalScreen = index === SCREENS.length;

  async function handleBegin() {
    setBeginning(true);
    await onBegin();
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex gap-1.5" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={SCREENS.length + 1}>
        {Array.from({ length: SCREENS.length + 1 }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-6 rounded-full transition-colors ${i <= index ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {isFinalScreen ? (
        <div className="flex flex-col items-center gap-6">
          <p className="text-xl font-semibold text-balance">
            Talent may affect where you begin. Consistent effort determines how far you go.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => void handleBegin()} disabled={beginning}>
              {beginning ? "Preparing your diagnostic…" : "Begin Diagnostic"}
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/home">Explore PrepHub</Link>} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-semibold">{SCREENS[index].heading}</h1>
          <p className="text-muted-foreground text-balance">{SCREENS[index].body}</p>
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
