import type { ComponentType } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Target, Sparkles, Lightbulb, Flame } from "lucide-react";
import { auth } from "@/auth";
import { LinkButton } from "@/components/ui/link-button";
import { Logo } from "@/components/logo";
import { DiagnosticVisual, MasteryVisual } from "./landing-visuals";

// The public marketing page — shown only to signed-out visitors; anyone with
// a session is routed straight past it into the product. Layout/typographic
// rhythm (huge bold headline, alternating text/visual feature rows, generous
// whitespace) is modeled on brilliant.org per direct request; colors stay on
// PrepHub's own teal/white tokens rather than borrowing Brilliant's palette.
// Every visual below mocks a real product surface (Score Prediction, mastery
// bars, step-by-step explanations, study streak). The trust line under the
// hero CTAs (view count, Brilliant.org sponsorship) cites the Owner's real
// PrepHub YouTube channel figures, per direct request — kept as plain quiet
// text, not a badge/card, matching this page's restraint elsewhere.
export default async function RootPage() {
  const session = await auth();
  // `session.user.id` (not the bare `session.user` object) is the real
  // "authenticated" signal: a just-deleted account's jwt callback returns an
  // empty token (see src/auth.ts), which Auth.js still surfaces as a truthy
  // — but id-less — session.user for that one stale request.
  if (session?.user?.id) redirect("/home");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Logo size="lg" />
          <div className="flex items-center gap-2">
            <LinkButton variant="ghost" className="rounded-xl" href="/login" hardNavigation>
              Log in
            </LinkButton>
            <LinkButton className="rounded-xl" href="/signup" hardNavigation>
              Get started
            </LinkButton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 pt-12 pb-24 text-center sm:pt-20 sm:pb-32">
        <h1 className="max-w-3xl font-heading text-5xl font-semibold tracking-tight text-balance sm:text-6xl md:text-7xl">
          Stop guessing what to <span className="text-primary italic">study</span> next.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground sm:text-xl">
          PrepHub&apos;s Diagnostic finds exactly where you stand, then builds Personalized Practice that adapts
          after every session — so every minute you study actually moves your score.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton size="lg" className="h-12 rounded-xl px-8 text-base" href="/signup" hardNavigation>
            Start your free Diagnostic
          </LinkButton>
          <LinkButton size="lg" variant="outline" className="h-12 rounded-xl px-8 text-base" href="/login" hardNavigation>
            Log in
          </LinkButton>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span>8M+ views across platforms</span>
          <span className="hidden h-1 w-1 rounded-full bg-border sm:block" aria-hidden />
          <span>Sponsored by Brilliant.org</span>
        </div>

        <div className="mt-6 w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-left shadow-sm">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">PrepHub Score Prediction</p>
          <p className="mt-2 font-heading text-6xl font-semibold tabular-nums">1420–1480</p>
          <span className="mt-3 inline-flex items-center gap-1 rounded-md bg-achievement/12 px-2 py-1 text-sm font-medium text-achievement-foreground dark:text-achievement">
            ↑ 80 pts since you started
          </span>
        </div>
      </section>

      {/* Feature rows */}
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-6 py-12 sm:gap-32">
        <FeatureRow
          icon={Target}
          title="One Diagnostic. A real starting point."
          description="21 questions across every SAT category give you an initial Predicted SAT Score range — no guessing where to begin."
          visual={<DiagnosticVisual />}
        />
        <FeatureRow
          reverse
          icon={Sparkles}
          title="Practice that adapts every time."
          description="Every Personalized Practice Set is built from your strengths and weaknesses across all 7 tested categories, and your Predicted Score updates after each one."
          visual={<MasteryVisual />}
        />
        <FeatureRow
          icon={Lightbulb}
          title="Understand every answer, not just the correct one."
          description="Each question comes with a step-by-step explanation, so a wrong answer becomes something you actually learn from — not just a red X."
          visual={<ExplanationVisual />}
        />
        <FeatureRow
          reverse
          icon={Flame}
          title="Consistency beats cramming."
          description="Build a daily study streak as you practice. A steady habit — not a last-minute scramble — is what actually moves scores."
          visual={<StreakVisual />}
        />
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-muted/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to see where you stand?
          </h2>
          <LinkButton size="lg" className="h-12 rounded-xl px-8 text-base" href="/signup" hardNavigation>
            Start your free Diagnostic
          </LinkButton>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <Logo />
        <div className="flex gap-4">
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  description,
  visual,
  reverse,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={reverse ? "md:order-2" : undefined}>
        <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">{description}</p>
      </div>
      <div className={reverse ? "md:order-1" : undefined}>{visual}</div>
    </div>
  );
}

function VisualCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</div>;
}

function ExplanationVisual() {
  return (
    <VisualCard>
      <div className="flex flex-col gap-3">
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 1</p>
          Isolate x by subtracting 5 from both sides of the equation.
        </div>
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 2</p>
          Divide both sides by 3 — x = 5, which matches answer choice B.
        </div>
      </div>
    </VisualCard>
  );
}

function StreakVisual() {
  return (
    <VisualCard>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Study Streak</p>
        <p className="font-heading text-2xl font-semibold tabular-nums text-achievement-foreground dark:text-achievement">
          12<span className="ml-1.5 text-sm font-normal text-muted-foreground">days</span>
        </p>
      </div>
      <div className="mt-4 flex gap-1.5">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="h-6 flex-1 rounded-sm bg-achievement/60" />
        ))}
      </div>
    </VisualCard>
  );
}
