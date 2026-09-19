"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";

const WELCOME_ITEMS = [
  { title: "21 Questions", body: "A balanced diagnostic across SAT categories and difficulty levels." },
  { title: "Your First Prediction", body: "Receive your initial predicted SAT score range when you finish." },
  { title: "Personalized Practice", body: "Your results will be used to create your first adaptive practice set." },
] as const;

// PRD-012 §6-§7: a short, skippable-only-by-exploring multi-screen product
// introduction, shown once before the diagnostic begins.
//
// Each screen used to carry its own Lucide glyph in a teal badge — the idea
// being that the icons would keep six text screens from reading as identical.
// They didn't: an 80px pastel tile above a heading on every screen is itself
// the repetition, and it was the single loudest element in a flow whose whole
// job is to be read. The step ordinal now does that work. It's information
// (how far through am I?) rather than decoration, and it gives each screen a
// different number at the top, which is a real difference where six different
// abstract glyphs were not.
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
    // Left-aligned in a reading-width column, with no card border around it.
    // This flow already runs in the app shell's focus mode — there is nothing
    // else on screen for a card to separate the content from, so the border
    // was a frame around the entire viewport's only object.
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center gap-10 p-6 sm:p-10">
      {!isWelcomeScreen && (
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={SCREENS.length + 1}
        >
          {Array.from({ length: SCREENS.length + 1 }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i <= index ? "bg-primary" : "bg-foreground/10"}`}
            />
          ))}
        </div>
      )}

      {isWelcomeScreen ? (
        <div className="flex flex-col gap-10">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              The Diagnostic
            </p>
            <h1 className="mt-3 text-display-sm text-balance sm:text-display">
              Let&apos;s find your <Marker>starting point</Marker>.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">
              This 21-question diagnostic will help PrepHub understand your current strengths and weaknesses across
              the SAT.
            </p>
          </div>

          {/* Numbered rather than bulleted-with-icons: these three are a
              sequence (answer, get a score, get a plan), and saying so is more
              useful than three unrelated glyphs implying they are a menu. */}
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

          <Button size="cta" className="w-fit" onClick={() => setIndex(0)}>
            Start Diagnostic
          </Button>
        </div>
      ) : isFinalScreen ? (
        <div className="flex flex-col gap-10">
          {/* The one screen with a single idea on it, so it gets the largest
              type in the flow and nothing else — the size contrast is what
              makes it land, which is what the flame badge was reaching for. */}
          <p className="text-display-sm text-balance sm:text-display">
            Talent may affect where you begin. <Marker>Consistent effort</Marker> determines how far you go.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="cta" onClick={() => void handleBegin()} disabled={beginning}>
              {beginning ? "Preparing your diagnostic…" : "Begin Diagnostic"}
            </Button>
            <LinkButton size="cta" variant="outline" href="/home">
              Explore PrepHub
            </LinkButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          <div>
            <p className="font-heading text-caption font-semibold tracking-[0.12em] text-muted-foreground tabular-nums uppercase">
              {String(index + 1).padStart(2, "0")} / {String(SCREENS.length).padStart(2, "0")}
            </p>
            <h1 className="mt-3 text-display-sm text-balance">{SCREENS[index].heading}</h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">{SCREENS[index].body}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="cta" onClick={() => setIndex((i) => i + 1)}>
              Next
            </Button>
            {index > 0 && (
              <Button size="cta" variant="ghost" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
