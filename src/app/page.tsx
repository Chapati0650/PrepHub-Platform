import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { LandingVideoCard } from "./landing-videos";
import { getLandingVideos } from "@/lib/youtube/landing-videos";
import { Logo } from "@/components/logo";
import { DiagnosticVisual, MasteryVisual } from "./landing-visuals";

// The public marketing page — shown only to signed-out visitors; anyone with
// a session is routed straight past it into the product.
//
// Rebuilt away from the previous version, which read as machine-generated for
// four specific and fixable reasons, all of which this layout inverts:
//
//  1. A pastel rounded-square icon tile sat above every section heading. That
//     tile is the single most recognizable component-library default in
//     circulation. There is now no decorative icon anywhere on this page.
//  2. Every section had identical weight — alternating text/visual rows at one
//     size, one rhythm, one spacing. Sections here deliberately differ in
//     background, width, alignment and scale so the page has pacing.
//  3. The whole page sat at one flat value: white cards, thin gray borders,
//     near-white ground, top to bottom. It now blocks into white →
//     deep teal → white → tinted → white.
//  4. There was no repeated motif. The <Marker> underline now recurs on every
//     section headline, which is what makes a page feel authored.
//
// Content rule: every claim here is one PrepHub can actually back. The view
// count and the Brilliant.org sponsorship are the Owner's real figures. There
// are deliberately no testimonials, no student names, no university logos and
// no score-improvement statistics — the reference site leans on all four, and
// inventing any of them would be fabricated social proof.
export default async function RootPage() {
  const session = await auth();
  // `session.user.id` (not the bare `session.user` object) is the real
  // "authenticated" signal: a just-deleted account's jwt callback returns an
  // empty token (see src/auth.ts), which Auth.js still surfaces as a truthy
  // — but id-less — session.user for that one stale request.
  if (session?.user?.id) redirect("/home");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PageViewBeacon />
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Logo size="lg" />
          <div className="flex items-center gap-2">
            <LinkButton variant="ghost" className="rounded-full px-5" href="/login" hardNavigation>
              Log in
            </LinkButton>
            <LinkButton className="rounded-full px-5" href="/signup" hardNavigation>
              Sign up
            </LinkButton>
          </div>
        </div>
      </header>

      <Hero />
      <CredibilityBand />
      <HowItWorks />
      <FeatureSections />
      <ClosingCta />

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <Logo />
            <p>Adaptive SAT preparation that adjusts to you.</p>
          </div>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Left-aligned, asymmetric, product-forward. The previous hero was centered
// with a single italic word in brand color — a centered column of text with
// no object beside it is the default shape of a page nobody laid out, and the
// italic-colored-word trick is its most common ornament.
function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pt-14 pb-20 sm:pt-20 sm:pb-28">
      <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <div>
          <h1 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
            Your <Marker>personalized</Marker> study platform for the 2026 Digital SAT
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
            Crafted by perfect scorers for the new Digital SAT with AI-adaptive practice questions,
            personalized diagnostics, and a handcrafted curriculum to help you achieve your dream score.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <LinkButton size="cta" href="/signup" hardNavigation>
              Start your free Diagnostic
            </LinkButton>
            <LinkButton size="cta" variant="outline" href="/login" hardNavigation>
              I already have an account
            </LinkButton>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            The Diagnostic and your first practice set are free — no card. Premium from $8.25 a month.
          </p>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}

// A layered composition rather than a single flat card: a soft brand-tinted
// shape behind, the live Diagnostic mock as the main object, and a small
// score card breaking its bottom edge. Overlap and depth are most of what
// separates "a screenshot on a page" from a designed hero.
function HeroVisual() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -top-10 -right-6 size-64 rounded-full bg-marker/25 blur-3xl sm:size-80"
      />
      <div
        aria-hidden
        className="absolute -bottom-12 -left-10 size-56 rounded-full bg-primary/12 blur-3xl"
      />
      {/* The padding-bottom is load-bearing: it reserves the score card's own
          height so the card breaks the Diagnostic panel's bottom-left corner
          by ~25px instead of sitting on top of the category list. Positioning
          it with a negative offset alone covered the last two categories. */}
      <div className="relative pb-20">
        <DiagnosticVisual />
        <div className="absolute bottom-0 left-0 w-52 rounded-2xl border border-border bg-card p-4 shadow-lg sm:-left-8 sm:w-60">
          <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
            Predicted SAT Score
          </p>
          <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">1420–1480</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-achievement/15 px-2 py-0.5 text-sm font-medium text-achievement-foreground dark:text-achievement">
            ↑ 80 pts
          </span>
        </div>
      </div>
    </div>
  );
}

// The full-bleed dark band. Structurally this is where the reference site puts
// a wall of university logos; PrepHub has no such relationship, so the band
// instead carries the two credibility facts that are genuinely true. Same
// design job — break the page out of white and hold real proof — without
// implying an endorsement that doesn't exist.
async function CredibilityBand() {
  const videos = await getLandingVideos();
  return (
    <section className="bg-surface-deep text-surface-deep-foreground">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <p className="text-caption font-medium tracking-[0.12em] text-surface-deep-foreground/60 uppercase">
          Built on a following that already trusts the teaching
        </p>
        <div className="mt-10 grid items-end gap-10 sm:grid-cols-2 sm:gap-16">
          <div>
            <p className="font-heading text-hero font-semibold tracking-tight tabular-nums">8M+</p>
            <p className="mt-2 text-lg text-surface-deep-foreground/75">
              Views across the PrepHub channels, from the same person writing every question here.
            </p>
          </div>
          <div>
            <p className="font-heading text-display-sm font-semibold tracking-tight sm:text-display">
              Brilliant.org
            </p>
            <p className="mt-2 text-lg text-surface-deep-foreground/75">
              Official sponsor of the PrepHub channel.
            </p>
          </div>
        </div>

        {/* The proof under the claim: three of the channel's own videos, on
            the same dark band as the number they back up. Thumbnails and
            titles are YouTube's; the view count under each is the Owner's
            figure (dated in lib/youtube/landing-videos.ts), replaced by the
            live Data API count whenever a key is configured. */}
        <div className="mt-16 border-t border-surface-deep-foreground/15 pt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              The same teaching, <Marker>free on YouTube</Marker>.
            </h2>
            <a
              href="https://www.youtube.com/@prephubtp"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-surface-deep-foreground/70 underline-offset-4 hover:text-surface-deep-foreground hover:underline"
            >
              Visit the channel &rarr;
            </a>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
            {videos.map((v) => (
              <LandingVideoCard key={v.id} {...v} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Take the Diagnostic",
    body: "21 questions, one per difficulty across all 7 tested categories. It ends with a Predicted SAT Score range and a per-category read on where you stand.",
    visual: <StepDiagnostic />,
  },
  {
    n: "02",
    title: "Get Personalized Practice",
    body: "Each 21-question set is generated from your own ability scores, weighted toward the categories losing you the most points right now.",
    visual: <StepAllocation />,
  },
  {
    n: "03",
    title: "Watch the prediction move",
    body: "Every completed set updates your category mastery and your Predicted SAT Score, so progress is something you can actually see rather than assume.",
    visual: <StepProgress />,
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        Diagnose, practice, <Marker>improve</Marker>.
      </h2>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.n}
            className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card"
          >
            <div className="border-b border-border bg-surface-tint p-6">{step.visual}</div>
            <div className="flex flex-col gap-2 p-6">
              <p className="font-heading text-lg font-semibold tabular-nums text-muted-foreground/70">
                {step.n}
              </p>
              <h3 className="font-heading text-card-title font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="text-muted-foreground">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StepDiagnostic() {
  const rows = [
    { label: "Reading Comprehension", done: true },
    { label: "Algebra", done: true },
    { label: "Geometry & Trig", done: true },
    { label: "Advanced Math", done: false },
  ];
  return (
    <div className="flex h-44 flex-col justify-center gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2.5 text-sm">
          <span
            className={
              row.done
                ? "size-4 shrink-0 rounded-full bg-primary"
                : "size-4 shrink-0 rounded-full border border-border bg-card"
            }
          />
          <span className={row.done ? "text-foreground" : "text-muted-foreground"}>{row.label}</span>
        </div>
      ))}
      <p className="mt-2 text-caption font-medium tracking-wide text-muted-foreground uppercase">
        21 questions · 7 categories
      </p>
    </div>
  );
}

function StepAllocation() {
  const rows = [
    { label: "Advanced Math", count: 6 },
    { label: "Grammar", count: 5 },
    { label: "Vocabulary", count: 3 },
    { label: "Algebra", count: 2 },
  ];
  return (
    <div className="flex h-44 flex-col justify-center gap-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm">{row.label}</span>
          <span className="flex gap-1">
            {Array.from({ length: row.count }, (_, i) => (
              <span key={i} className="size-2.5 rounded-sm bg-primary/70" />
            ))}
          </span>
        </div>
      ))}
      <p className="mt-1 text-caption font-medium tracking-wide text-muted-foreground uppercase">
        Questions allocated this set
      </p>
    </div>
  );
}

function StepProgress() {
  return (
    <div className="flex h-44 flex-col justify-center">
      <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
        Predicted SAT Score
      </p>
      <p className="mt-1 font-heading text-4xl font-semibold tabular-nums">1420–1480</p>
      {/* Percentage heights inside a fixed-height `items-end` row, not flex-1
          with a pixel height — flex-1 stretched each bar wide enough that the
          set read as a row of squares rather than a chart. */}
      <div className="mt-4 flex h-14 items-end gap-1.5">
        {[38, 46, 52, 58, 67, 74, 88].map((h, i) => (
          <span
            key={i}
            className="w-3 rounded-sm bg-primary/25 last:bg-primary"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <p className="mt-3 text-sm font-medium text-achievement-foreground dark:text-achievement">
        ↑ 80 pts since your Diagnostic
      </p>
    </div>
  );
}

// Two wide feature rows on the tinted ground. Kept to two (the old page had
// four near-identical ones) and given real size contrast against the
// three-up grid above, so the page alternates between dense and open instead
// of scrolling at one constant density.
function FeatureSections() {
  return (
    <section className="border-y border-border bg-surface-tint">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-6 py-24 sm:gap-32 sm:py-32">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
              Practice that <Marker>adapts</Marker> every set.
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Your ability score moves per category after every question you finalize. The next set
              is built from those numbers — not from a fixed syllabus, and not from what you
              answered first.
            </p>
          </div>
          <MasteryVisual />
        </div>

        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="md:order-2">
            <h2 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
              Never stay <Marker>stuck</Marker> on a question.
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Every question carries a written, step-by-step explanation of how the answer is
              reached — so a wrong answer turns into something you learn from instead of a red X.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:order-1 sm:p-8">
            <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
              Why B is correct
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <div className="rounded-xl bg-muted p-4 text-sm">
                <p className="mb-1 text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  Step 1
                </p>
                Isolate x by subtracting 5 from both sides of the equation.
              </div>
              <div className="rounded-xl bg-muted p-4 text-sm">
                <p className="mb-1 text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  Step 2
                </p>
                Divide both sides by 3 — x = 5, which matches answer choice B.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-28 text-center sm:py-36">
      {/* Same scale as the hero so the page's first and last statements
          are the two largest things on it and nothing in between outranks
          either. (The hero stepped down a notch for a longer headline; this
          follows it.) */}
      <h2 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        Take our Diagnostic and get a <Marker>predicted score</Marker>.
      </h2>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        Our Diagnostic can be taken in one sitting and costs nothing. We&apos;ll also give you a free
        test-analysis pointing out the exact categories dragging your score down.
      </p>
      <div className="mt-9 flex justify-center">
        <LinkButton size="cta" href="/signup" hardNavigation>
          Start your free Diagnostic
        </LinkButton>
      </div>
    </section>
  );
}
