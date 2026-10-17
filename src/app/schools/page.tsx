import type { Metadata } from "next";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";
import {
  SCHOOLS_CONTACT_EMAIL,
  SCHOOLS_MAILTO,
  SiteFooter,
  SiteHeader,
} from "@/components/marketing/site-chrome";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";

// The district-facing page, reached from the "For Schools" tab in the public
// header. It answers the questions a school administrator actually asks, in
// the order they ask them: will students use it, how do we get set up, what
// do I see, what do you do with student data, what does it cost.
//
// Content rules this page is held to, same as the landing page:
//
//  * Every claim is one PrepHub can back. There are no testimonials, no
//    named students or districts, no logo wall, and above all no
//    score-improvement statistics — the reference site (oneprep.xyz/schools)
//    leans on all four, and inventing any of them would be fabricated social
//    proof. The two credibility facts here (8M+ channel views, the
//    Brilliant.org sponsorship) are the Owner's real figures.
//  * Illustrative numbers appear only inside the Campus Overview mock, and
//    only as activity *counts* (students registered, questions answered).
//    A mocked "average score gain" would be exactly the fabricated outcome
//    statistic that rule forbids, so the mock deliberately has no such field.
//  * No price, and no free trial or pilot offer. The Owner's standing rule
//    keeps a number off the public marketing surface, and a free pilot is
//    something they negotiate per district rather than offer to everyone
//    who loads the page — so the FAQ says pricing is quoted per district
//    and every CTA asks for a conversation, not a trial.
//
// The CCMR section is Texas-specific and scoped as such in its own heading.
// Every figure in it is from TEA's own 28 August 2025 "CCMR Outcomes Bonus"
// letter to administrators (amounts, thresholds, readiness criteria) — this
// is the one part of the page where a wrong number would be spotted
// immediately by the reader, so it is quoted rather than paraphrased.
//
// Prerendered: there is no per-visitor content, and like the landing page it
// must stay free of auth()/cookies()/headers() to remain so.
export const revalidate = 86400;

const TITLE = "PrepHub for Schools and Districts";
const DESCRIPTION =
  "Adaptive Digital SAT preparation students actually open. Roster or domain enrollment, and campus-level reporting with no individual student performance.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/schools" },
  openGraph: { title: `${TITLE} · PrepHub`, description: DESCRIPTION, url: "/schools" },
};

export default function SchoolsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PageViewBeacon />
      <SiteHeader active="schools" />

      <Hero />
      <WhyBand />
      <Setup />
      <ForStudents />
      <ForAdministrators />
      <Ccmr />
      <Privacy />
      <Faq />
      <ClosingCta />

      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pt-14 pb-20 sm:pt-20 sm:pb-28">
      <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <p className="text-caption font-medium tracking-[0.12em] text-muted-foreground uppercase">
            For schools and districts
          </p>
          <h1 className="mt-4 font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
            SAT prep your students will actually <Marker>use</Marker>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
            Most licensed test prep is expensive, forgettable, and quietly unused. PrepHub is
            adaptive underneath and built like something a teenager would choose to open. Daily
            questions, streaks, and 1v1 games against classmates are what keep students coming
            back.
          </p>
          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <LinkButton size="cta" href={SCHOOLS_MAILTO}>
              Request a demo
            </LinkButton>
            <a href="/signup" className="text-sm font-medium underline-offset-4 hover:underline">
              Or try the student product yourself &rarr;
            </a>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            We will show you the whole product and quote it against your own enrollment. Nothing
            for your IT department to install.
          </p>
        </div>

        <MeasurementPanel />
      </div>
    </section>
  );
}

/**
 * What a district will be able to measure, as metric names with no numbers.
 *
 * This replaced a mocked "campus overview" showing a fictional school's
 * registration rate and activity totals. Two problems with that, both raised
 * by the Owner: no pilot is running, so a dashboard full of numbers implied
 * a deployment that does not exist, and a real school's analytics are not
 * ours to put on a public page even in mocked form. Naming the metrics
 * communicates the same value and claims nothing untrue.
 */
function MeasurementPanel() {
  const metrics = [
    { n: "01", label: "Registration rate", note: "How many of your eligible students have an account." },
    { n: "02", label: "Average score gain", note: "First predicted score against latest, per student." },
    { n: "03", label: "College readiness crossings", note: "Students who were below a benchmark and now meet both." },
    { n: "04", label: "Questions answered and study time", note: "Campus totals, plus how the top of the cohort compares." },
    { n: "05", label: "Weakest categories", note: "Which of the seven tested areas is costing your campus most." },
  ];
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
      <div className="relative rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
        <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          Your campus report
        </p>
        <p className="mt-1 font-heading text-card-title font-semibold tracking-tight">
          What you will be able to measure
        </p>

        <dl className="mt-6 divide-y divide-border border-y border-border">
          {metrics.map((m) => (
            <div key={m.n} className="flex gap-4 py-3">
              <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground/70">
                {m.n}
              </span>
              <span className="min-w-0">
                <dt className="font-medium">{m.label}</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">{m.note}</dd>
              </span>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-sm text-muted-foreground">
          Campus totals only. No screen in PrepHub shows an administrator an individual
          student&apos;s performance.
        </p>
      </div>
    </div>
  );
}

// The dark band. Structurally this is where the reference site puts a wall of
// testimonials and score gains; PrepHub has no district results to quote yet,
// so it carries the argument plus the two facts that are genuinely true.
function WhyBand() {
  return (
    <section className="bg-surface-deep text-surface-deep-foreground">
      <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
          Three things decide whether a license moves a score.
        </h2>
        <div className="mt-12 grid gap-10 border-t border-surface-deep-foreground/15 pt-12 md:grid-cols-3 md:gap-10">
          <div>
            <p className="font-heading text-lg font-semibold tabular-nums text-surface-deep-foreground/50">
              01
            </p>
            <h3 className="mt-2 font-heading text-card-title font-semibold tracking-tight">
              Does the student open it?
            </h3>
            <p className="mt-3 text-surface-deep-foreground/75">
              The first screen has to earn a second one. PrepHub looks and moves like something a
              student would open on their own rather than a worksheet in a browser, and that is
              what gets a skeptical teenager past the login screen in a homeroom period instead of
              quietly closing the tab.
            </p>
          </div>
          <div>
            <p className="font-heading text-lg font-semibold tabular-nums text-surface-deep-foreground/50">
              02
            </p>
            <h3 className="mt-2 font-heading text-card-title font-semibold tracking-tight">
              Does the practice help?
            </h3>
            <p className="mt-3 text-surface-deep-foreground/75">
              Every set is generated from that student&apos;s own per category ability scores and
              weighted toward whatever is costing them the most points right now. Nobody gets a
              fixed syllabus and nobody gets the worksheet the whole class gets. The questions move
              as the student does, and their predicted score moves with them.
            </p>
          </div>
          <div>
            <p className="font-heading text-lg font-semibold tabular-nums text-surface-deep-foreground/50">
              03
            </p>
            <h3 className="mt-2 font-heading text-card-title font-semibold tracking-tight">
              Do students come back?
            </h3>
            <p className="mt-3 text-surface-deep-foreground/75">
              This is where most licenses quietly die, so we work the launch with you. A homeroom
              session where every student logs in for the first time, with us there in person to
              help. A weekly slot where the platform actually gets used. Follow up emails to
              everyone who has not registered a week in. Campus wide challenges with a reward when
              enough students hit their weekly goal, and team competitions we fund and hand over
              ourselves.
            </p>
          </div>
        </div>

        <div className="mt-16 grid items-end gap-10 border-t border-surface-deep-foreground/15 pt-12 sm:grid-cols-2 sm:gap-16">
          <div>
            <p className="font-heading text-hero font-semibold tracking-tight tabular-nums">8M+</p>
            <p className="mt-2 text-lg text-surface-deep-foreground/75">
              Views across the PrepHub channels. The same person who teaches there writes every
              question and every explanation in here.
            </p>
          </div>
          <div>
            <p className="font-heading text-display-sm font-semibold tracking-tight sm:text-display">
              Sponsored by Brilliant.org
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const SETUP_STEPS = [
  {
    n: "01",
    title: "Send a roster, or just your domain",
    body: "Upload a CSV of student emails, with campus and graduation year optional and any column order. Or simply tell us your email domain and every address on it is recognized. Both are built, and most districts start with one and add the other later.",
  },
  {
    n: "02",
    title: "Students sign in and are enrolled",
    body: "A student signs in with Google Workspace or an email and password. If they match your roster or your domain, they are placed on your campus automatically with full access. No codes to distribute and no second account to create.",
  },
  {
    n: "03",
    title: "You watch the campus, not the child",
    body: "Your administrator account sees campus totals, a student directory, and an announcement tool that emails every registered student at once. It also carries the full student product, so you can evaluate exactly what they see.",
  },
];

function Setup() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        Set up in an afternoon, not a <Marker>semester</Marker>.
      </h2>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        There is no software to install, no integration to schedule, and nothing to stand up on your
        network. PrepHub runs in a browser on whatever devices your students already have.
      </p>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {SETUP_STEPS.map((step) => (
          <div
            key={step.n}
            className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-6 sm:p-7"
          >
            <p className="font-heading text-lg font-semibold tabular-nums text-muted-foreground/70">
              {step.n}
            </p>
            <h3 className="font-heading text-card-title font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const STUDENT_FEATURES = [
  {
    name: "Diagnostic",
    body: "21 questions in one sitting, one per difficulty across all seven tested categories. It ends with a Predicted SAT Score range and names the two categories costing them the most.",
  },
  {
    name: "Personalized Practice",
    body: "Endless 21-question sets, each generated from that student's current ability scores. Finish a set and both the category mastery and the predicted score move.",
  },
  {
    name: "1v1 Rush",
    body: "Ten questions, a clock on each, points for right-and-fast. Played live against a classmate on a shared link, against a recorded run, or solo. This is the part students open without being told to.",
  },
  {
    name: "Daily Challenge",
    body: "One hard question per day, the same one for every student, with a streak that only breaks when a day is actually missed.",
  },
  {
    name: "800 Club",
    body: "Hard-only sessions by section, for the students chasing the top of the scale rather than the benchmark.",
  },
  {
    name: "The Curriculum",
    body: "The channel's video course, module by module, inside the product next to the practice it belongs to.",
  },
];

function ForStudents() {
  return (
    <section className="border-y border-border bg-surface-tint">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
          What the <Marker>student</Marker> gets.
        </h2>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Every student on your roster gets all of it. There is no tier held back from a district
          license, and no feature that costs extra per student.
        </p>

        {/* One divide-y list, not six bordered cards. Full width rather than
            squeezed beside the heading: in a half-width column the body text
            wrapped to six lines against an empty left half. */}
        <dl className="mt-12 divide-y divide-border border-y border-border">
          {STUDENT_FEATURES.map((f) => (
            <div key={f.name} className="grid gap-1 py-6 md:grid-cols-[260px_1fr] md:gap-10">
              <dt className="font-heading font-semibold tracking-tight">{f.name}</dt>
              <dd className="max-w-3xl text-muted-foreground">{f.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const ADMIN_FEATURES = [
  {
    name: "Campus overview",
    body: "Eligible enrollment, how many of those students have registered, and all-time activity totals for the campus including questions answered, Diagnostics completed and Practice Sets finished.",
  },
  {
    name: "Student directory",
    body: "Search and filter the students registered at your campus, with their graduation year and last active date. First name and graduation year are the only fields an administrator can edit.",
  },
  {
    name: "Announcements",
    body: "Write once and it emails every currently registered student at your campus and shows as a banner on their dashboard. Removing one keeps it in the record rather than erasing it.",
  },
  {
    name: "Access and support",
    body: "Your license status, the contract period it covers, and a direct line to us. No invoices or payment detail live in the administrator area.",
  },
];

function ForAdministrators() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        What the <Marker>administrator</Marker> gets.
      </h2>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
        One shared account per campus, and the full student product alongside it so you can sit the
        Diagnostic yourself before you ask a student to.
      </p>
      <dl className="mt-12 divide-y divide-border border-y border-border">
        {ADMIN_FEATURES.map((f) => (
          <div key={f.name} className="grid gap-1 py-6 md:grid-cols-[260px_1fr] md:gap-10">
            <dt className="font-heading font-semibold tracking-tight">{f.name}</dt>
            <dd className="max-w-3xl text-muted-foreground">{f.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const CCMR_GROUPS = [
  {
    tag: "Already above both benchmarks",
    title: "Protect the credit you already have",
    body: "These students count today. Keeping them sharp through to test day is the cheapest CCMR you own.",
    money: false,
  },
  {
    tag: "Above one benchmark only",
    title: "The closest group to a new credit",
    body: "Almost always the mathematics criterion that is missing while the reading one is already met. One subject, one benchmark, one student at a time.",
    money: false,
  },
  {
    tag: "Below both, heading to college",
    title: "The group that pays for the program",
    body: "A graduate who enrolls at a postsecondary institution but never met TSI criteria earns the district nothing. Move the score and that same student becomes an Outcomes Bonus.",
    money: true,
  },
  {
    tag: "Below both, heading to work or the military",
    title: "Career-ready still needs the score",
    body: "A CTE student with an industry-based certification is career-ready only if they also meet TSI criteria, with no college enrollment required. The certification is already yours. The score is the gate.",
    money: false,
  },
];

const CCMR_BONUS = [
  {
    amount: "$5,000",
    who: "Economically disadvantaged",
    threshold: "Paid above a threshold of 11% of that group's annual graduates",
  },
  {
    amount: "$4,000",
    who: "Served in special education",
    threshold: "No threshold, and it stacks on top of the student's economic group",
  },
  {
    amount: "$3,000",
    who: "All other graduates",
    threshold: "Paid above a threshold of 24% of that group's annual graduates",
  },
];

function Ccmr() {
  return (
    <section className="border-y border-border bg-surface-tint">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <p className="text-caption font-medium tracking-[0.12em] text-muted-foreground uppercase">
          If you are a Texas district
        </p>
        <h2 className="mt-4 max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
          An SAT score is also a <Marker>CCMR</Marker> credit.
        </h2>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Meeting Texas Success Initiative criteria is one of the ways a graduate demonstrates
          readiness, and TSI criteria can be met with SAT section scores. For the College, Career,
          or Military Readiness Outcomes Bonus, that means the same work that raises a score can
          raise a payment.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {CCMR_GROUPS.map((g) => (
            <div
              key={g.tag}
              className={
                g.money
                  ? "rounded-2xl border-2 border-primary bg-card p-6"
                  : "rounded-2xl border border-border bg-card p-6"
              }
            >
              <p className="text-caption font-medium tracking-[0.1em] text-muted-foreground uppercase">
                {g.tag}
              </p>
              <h3 className="mt-2 font-heading text-card-title font-semibold tracking-tight">
                {g.title}
              </h3>
              <p className="mt-2 text-muted-foreground">{g.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-border pt-12">
          <h3 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            What a readiness credit is worth, per qualifying graduate
          </h3>
          <div className="mt-8 grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {CCMR_BONUS.map((b) => (
              <div key={b.amount} className="py-6 sm:px-6 sm:first:pl-0 sm:last:pr-0">
                <p className="font-heading text-4xl font-semibold tracking-tight text-primary tabular-nums">
                  {b.amount}
                </p>
                <p className="mt-1 font-medium">{b.who}</p>
                <p className="mt-1 text-sm text-muted-foreground">{b.threshold}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-sm text-muted-foreground">
            Amounts, thresholds and readiness criteria are the Texas Education Agency&apos;s, from
            its 28 August 2025 letter to administrators on the CCMR Outcomes Bonus; the
            special-education amount rose from $2,000 under House Bill 2 (89th Legislature, 2025).
            College-ready requires TSI criteria plus immediate postsecondary enrollment;
            career-ready requires TSI criteria plus an industry-based certification. PrepHub is SAT
            preparation and not a guarantee of a bonus. We are glad to go through your own TAPR
            numbers with you before you commit to anything.
          </p>
        </div>
      </div>
    </section>
  );
}

const PRIVACY_POINTS = [
  {
    name: "Administrators never see an individual student's performance",
    body: "This is enforced by the shape of the data rather than by a filter someone could switch off. The queries behind every campus figure return totals with no field that could carry one student's score.",
  },
  {
    name: "A student's account is theirs",
    body: "Their login, their district access and their learning history are three separate things. Graduating or leaving the district ends the access without touching the account or the history.",
  },
  {
    name: "Nothing a student writes goes to an AI model",
    body: "There is no AI tutor, no essay feedback and no student work sent to a third-party model. The adaptive engine is ordinary arithmetic over answer correctness, and every question and explanation is written by a person.",
  },
  {
    name: "Deletion anonymizes rather than erases",
    body: "A removed student or a deleted account is marked inactive and anonymized, so historical campus reporting stays correct and nobody's record is silently rewritten.",
  },
  {
    name: "We will sign your agreement",
    body: "Send us the data privacy agreement your district already uses and we will work through it with you. We would rather fit your existing process than ask you to make an exception for us.",
  },
];

function Privacy() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="max-w-3xl font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        Student data, and what we <Marker>don&apos;t</Marker> do with it.
      </h2>
      <dl className="mt-12 divide-y divide-border border-y border-border">
        {PRIVACY_POINTS.map((p) => (
          <div key={p.name} className="grid gap-2 py-6 sm:grid-cols-[1fr_1.4fr] sm:gap-10">
            <dt className="font-heading font-semibold tracking-tight">{p.name}</dt>
            <dd className="text-muted-foreground">{p.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const FAQ = [
  {
    q: "What does it cost?",
    a: "A flat price per student per year, quoted for your district. Write to us and we will put a number in writing against your enrollment, with no setup fee and no per-feature upsell.",
  },
  {
    q: "Can we purchase through a cooperative?",
    a: "Tell us which purchasing cooperative your district buys instructional software through and we will go through the process to be available on it. We would rather fit your procurement route than ask you to work around it.",
  },
  {
    q: "Do students need a school email address?",
    a: "No. Domain enrollment is the easiest route if your students have Workspace accounts, but a roster of any email addresses works too, and a student can sign in with an email and password instead of Google.",
  },
  {
    q: "What if a student's Google account is locked down?",
    a: "Some districts block third-party Google sign-in. Those students create an email-and-password account instead and are still matched to your campus by the roster or the domain, so nothing about their access changes.",
  },
  {
    q: "What devices does it need?",
    a: "A browser. It works on Chromebooks, school desktops and phones, and nothing needs installing or allow-listing beyond normal web access.",
  },
  {
    q: "Does this replace the platform we already have?",
    a: "It does not have to. Running PrepHub alongside your current license for a term is the honest way to find out whether students open this one more, and that comparison is worth having before anyone switches.",
  },
  {
    q: "Is it accessible?",
    a: "Keyboard navigation works throughout, color is never the only indicator of state, and light and dark themes are both supported. We are working toward WCAG 2.1 AA across the student workflows and will tell you plainly where we are not there yet rather than claim a conformance we have not verified.",
  },
  {
    q: "How long does setup take?",
    a: "An afternoon. Send a roster or a domain, we create the campus, and students can sign in the same day.",
  },
];

function Faq() {
  return (
    <section className="border-y border-border bg-surface-tint">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <h2 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
          Questions districts ask.
        </h2>
        <dl className="mt-12 grid gap-x-16 gap-y-8 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="font-heading font-semibold tracking-tight">{item.q}</dt>
              <dd className="mt-2 text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-28 text-center sm:py-36">
      <h2 className="font-heading text-display-sm font-semibold tracking-tight text-balance sm:text-display">
        Start with one <Marker>campus</Marker>.
      </h2>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
        Tell us the district, the campus and roughly how many students, and we will walk your team
        through the product and what it would cost.
      </p>
      <div className="mt-9 flex justify-center">
        <LinkButton size="cta" href={SCHOOLS_MAILTO}>
          Request a demo
        </LinkButton>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Or write to{" "}
        <a href={`mailto:${SCHOOLS_CONTACT_EMAIL}`} className="underline underline-offset-4">
          {SCHOOLS_CONTACT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
