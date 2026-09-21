"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Marker } from "@/components/ui/marker";

const WELCOME_ITEMS = [
  { title: "21 questions, about 20 minutes", body: "Three per category, easy to hard. You see the answer and an explanation after each one." },
  { title: "Your predicted SAT score", body: "A score range the moment you finish, plus the categories costing you the most." },
  { title: "Your first practice set — free", body: "Built from your answers, not a generic test. Ready as soon as you're done." },
] as const;

// One screen, then the first question. This used to be a welcome screen,
// six one-sentence "Next" screens and an effort screen (PRD-012 §6-§7's
// product introduction) — sixteen screens from the landing page to
// question 1 once signup and onboarding were counted. Production numbers
// (2026-09-21): 38 of 79 students who started the Diagnostic quit, 29 of
// them within the first four questions and 11 before answering anything.
// Everything those screens said is either on this one or shown by the
// product itself (the explanation after each answer, the prediction on
// the results page). The effort line survives as the closing sentence.
export function IntroScreens({ onBegin }: { onBegin: () => Promise<void> }) {
  const router = useRouter();
  const [beginning, setBeginning] = useState(false);

  async function handleBegin() {
    setBeginning(true);
    await onBegin();
    router.refresh();
  }

  return (
    // Left-aligned in a reading-width column, with no card border around it.
    // This flow already runs in the app shell's focus mode — there is nothing
    // else on screen for a card to separate the content from.
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center gap-10 p-6 sm:p-10">
      <div className="flex flex-col gap-10">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">The Diagnostic · Free</p>
          <h1 className="mt-3 text-display-sm text-balance sm:text-display">
            Let&apos;s find your <Marker>starting point</Marker>.
          </h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            Answer 21 questions and PrepHub will tell you where you stand on the Digital SAT — and exactly what to work
            on first.
          </p>
        </div>

        {/* Numbered rather than bulleted-with-icons: these three are a
            sequence (answer, get a score, get a plan), and saying so is more
            useful than three unrelated glyphs implying they are a menu. */}
        <ol className="flex flex-col divide-y divide-border border-y border-border">
          {WELCOME_ITEMS.map(({ title, body }, i) => (
            <li key={title} className="flex items-baseline gap-5 py-5">
              <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div>
          <Button size="cta" onClick={() => void handleBegin()} disabled={beginning}>
            {beginning ? "Preparing your diagnostic…" : "Begin Diagnostic"}
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            Talent may affect where you begin. Consistent effort determines how far you go.
          </p>
        </div>
      </div>
    </div>
  );
}
