import type { Metadata } from "next";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { PrintGuideButton } from "./print-button";

// The sign-up guide (2026-11-15): the page a teacher puts on the projector in
// homeroom, and the address at the end of the student intro video
// (prephubtp.com/start). Its five steps are the video's five steps, word for
// word, so a student following either gets the same instructions.
//
// For a student whose school provides PrepHub. It names no district: a
// district's own handout adds its email domain. Prerendered like the landing
// page, so no auth()/cookies()/headers() here.
export const revalidate = 86400;

const TITLE = "Get started with PrepHub";
const DESCRIPTION = "Your school gave you PrepHub. Sign up with your school email in about two minutes, then take the 15-minute Diagnostic.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/start" },
  openGraph: { title: `${TITLE} · PrepHub`, description: DESCRIPTION, url: "/start" },
};

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Go to prephubtp.com/start",
    body: (
      <>
        You&apos;re here. Press <span className="font-semibold text-foreground">Create your account</span>.
      </>
    ),
  },
  {
    title: "Sign up with your school email",
    body: (
      <>
        Press <span className="font-semibold text-foreground">Continue with Google</span> and choose your school account, or type your school
        email and make a password. Your school email is what unlocks everything for free.
      </>
    ),
  },
  {
    title: "Used a password? Confirm your email",
    body: (
      <>
        Open the email from PrepHub and press <span className="font-semibold text-foreground">Confirm</span>. It can take a minute, and it
        sometimes lands in junk. Signed up with Google? Skip this step.
      </>
    ),
  },
  {
    title: "Pick your campus and answer three quick questions",
    body: "Your grade, the score you're aiming for, and how much time you have. If your district has more than one high school, choose yours.",
  },
  {
    title: "Take the Diagnostic",
    body: "14 questions, about 15 minutes. You get your predicted SAT score and the skills costing you the most points, and your practice is built around them from there.",
  },
];

const HELP: { q: string; a: React.ReactNode }[] = [
  {
    q: "Google says “Access blocked” or “Error 400”.",
    a: "Your school hasn't switched on Google sign-in for PrepHub yet. Go back and sign up with your school email and a password instead. It works just the same.",
  },
  {
    q: "The confirmation email hasn't arrived.",
    a: (
      <>
        Give it two minutes and check your junk folder. On your PrepHub home page, the bar at the top has a{" "}
        <span className="font-semibold text-foreground">Resend</span> button. Still nothing? Tell your teacher: your school may need to allow
        email from PrepHub.
      </>
    ),
  },
  {
    q: "It's asking me to pay.",
    a: (
      <>
        You probably signed up with a personal email. Open <span className="font-semibold text-foreground">Settings</span> and press{" "}
        <span className="font-semibold text-foreground">Connect school access</span> to add your school email. Your practice so far is kept.
      </>
    ),
  },
  {
    q: "I forgot my password.",
    a: (
      <>
        On the log-in page, press <span className="font-semibold text-foreground">Forgot password?</span> and we&apos;ll email you a link.
      </>
    ),
  },
];

const INSIDE: { name: string; line: string }[] = [
  { name: "The Diagnostic", line: "Where you stand today, as a predicted SAT score." },
  { name: "Practice Sets", line: "Built around your weakest skills. Every one updates your prediction." },
  { name: "Step-by-step explanations", line: "Every question walks you through the answer on the question itself." },
  { name: "1v1 Rush", line: "Race a friend or your whole class on the same questions." },
  { name: "Daily Challenge", line: "One hard question a day. Keep your streak going." },
  { name: "800 Club", line: "Hard questions only, for when you're aiming high." },
];

export default function StartPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PageViewBeacon />
      <div className="print:hidden">
        <SiteHeader />
      </div>

      <main className="flex flex-1 flex-col">
        <section className="bg-surface-tint print:bg-transparent">
          <div className="mx-auto w-full max-w-5xl px-6 pt-14 pb-16 sm:pt-20 sm:pb-20 print:pt-0 print:pb-6">
            <p className="text-base font-medium text-muted-foreground">If your school provides PrepHub</p>
            <h1 className="mt-3 font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
              Get <Marker>started</Marker> in two minutes
            </h1>
            <p className="mt-6 max-w-2xl text-xl text-foreground/80">
              Sign up with your school email and everything is free: the Diagnostic, practice built around you, and 1v1 Rush. You&apos;ll never
              be asked to pay.
            </p>
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center print:hidden">
              <LinkButton size="cta" href="/signup">
                Create your account
              </LinkButton>
              <a href="/login" className="text-base font-medium underline-offset-4 hover:underline">
                Already signed up? Log in
              </a>
            </div>
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="mx-auto w-full max-w-5xl px-6 py-16 print:py-4">
          <h2 id="steps-heading" className="font-heading text-3xl font-semibold tracking-tight">
            Five steps
          </h2>
          <ol className="mt-8 divide-y divide-border border-y border-border">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid gap-2 py-6 sm:grid-cols-[5rem_1fr] sm:gap-6 print:py-3">
                <span className="font-heading text-4xl font-semibold tabular-nums text-primary dark:text-marker" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-2xl font-semibold">{s.title}</h3>
                  <p className="mt-2 max-w-3xl text-lg leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="help-heading" className="bg-surface-tint print:bg-transparent">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 print:py-4">
            <h2 id="help-heading" className="font-heading text-3xl font-semibold tracking-tight">
              Stuck?
            </h2>
            <dl className="mt-8 grid gap-6 sm:grid-cols-2">
              {HELP.map((h) => (
                <div key={h.q} className="rounded-2xl bg-background p-6 print:border print:border-border print:p-4">
                  <dt className="text-xl font-semibold">{h.q}</dt>
                  <dd className="mt-2 text-lg leading-relaxed text-muted-foreground">{h.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="inside-heading" className="mx-auto w-full max-w-5xl px-6 py-16 print:hidden">
          <h2 id="inside-heading" className="font-heading text-3xl font-semibold tracking-tight">
            What&apos;s inside
          </h2>
          <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {INSIDE.map((f) => (
              <div key={f.name} className="border-t border-border pt-4">
                <dt className="text-xl font-semibold">{f.name}</dt>
                <dd className="mt-1 text-lg text-muted-foreground">{f.line}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <LinkButton size="cta" href="/signup">
              Create your account
            </LinkButton>
            <PrintGuideButton />
          </div>
          <p className="mt-6 text-base text-muted-foreground">
            Teachers: put this page on the projector, or print it. Each step here matches the PrepHub intro video.
          </p>
        </section>
      </main>

      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}
