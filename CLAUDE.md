@AGENTS.md

# PrepHub

Adaptive SAT prep platform. A student takes a 21-question Diagnostic, then gets
endless personalized 21-question adaptive Practice Sets. Each set updates a
per-category Ability Score (7 fixed categories) and a Predicted SAT Score range.
Three roles: **Owner** (single account, authors all question content),
**School Administrator** (one shared account per school; gets the full
Student product for evaluation, plus an aggregate-only admin area — never
individual student performance), **Student**.

Full requirements live in `docs/` (PRD-000 through PRD-017 + the Global
Engineering Requirements PDF). This file distills the parts that should shape
every change; read the relevant PRD before implementing its feature area.

## Stack

Next.js (App Router, TS, single app — no separate backend service) · PostgreSQL
via Prisma 7 (driver adapters, not the old `url`-in-schema config — see
`prisma.config.ts` and `src/lib/prisma.ts`) · Auth.js v5 (Google + Credentials,
JWT sessions — Credentials provider can't use DB sessions) · Stripe · Tailwind +
shadcn/ui · Vitest (unit) + Playwright (e2e).

One owner is building this, so it's deliberately a monolith: server actions and
route handlers instead of a separate API service, Postgres transactions instead
of distributed-transaction machinery.

Uploaded question media (images/videos) lives behind one swappable interface
in `src/lib/content/storage.ts` — local disk (gitignored `.content-storage/`)
by default, or Cloudflare R2 (S3-compatible, free up to 10GB with no egress
fees) once its four `R2_*` env vars are all set (see `.env.example`). Local
disk was the only backend until the first real deploy (prephubtp.com,
Netlify) needed a serverless-compatible option — a serverless function has no
persistent filesystem, so local disk alone would have required a
persistent-disk PaaS (Railway/Render-style) instead. The R2 swap is what
makes either kind of host workable now: local dev still defaults to disk with
zero setup (the choice is made by "are the R2 vars present," not by
`NODE_ENV`), while a serverless deploy sets the R2 vars. ffmpeg's video-
duration probe (`media.ts`) writes to `os.tmpdir()` for the probe itself
regardless of which backend holds the durable copy, since ffmpeg needs a real
file path either way and `/tmp` is writable even on hosts with no other
persistent filesystem.

## Visual design

The brand color (deep pine teal, plus a warm gold reserved for achievement
moments) and logomark (a house containing an open book) come from the
PrepHub YouTube channel, not a generic pick — see `src/app/globals.css`'s
`:root`/`.dark` blocks for the oklch palette and `src/components/logo.tsx`
for the mark. Every neutral token (`--background`, `--card`, `--muted`,
`--border`, `--sidebar`, etc.) is true grayscale (zero chroma) on a white
base in light mode — an earlier version tinted these warm/cream to match the
YouTube channel's banner, but real user feedback called that "cardboard,"
so neutrals are now plain white/gray and teal alone carries the brand
identity. Don't reintroduce a warm hue on the neutral scale.

**The reference is oneprep.xyz**, at the Owner's direction, replacing the
earlier Linear/Stripe/Brilliant/Bluebook hybrid. The brief was specific: the
app "looked vibecoded" — made by an AI. That diagnosis came down to five
concrete tells, and the rules below exist to keep each one from coming back:

1. A pastel rounded-square icon tile above every heading, every empty state,
   and every wizard step.
2. A single italic/colored word as the only typographic device in a hero.
3. Every section on a page at identical weight and rhythm, so nothing leads.
4. One flat surface value top to bottom, with no bands or blocks.
5. No repeated motif — nothing a visitor could recognize twice.

Intentional choices worth preserving when touching `globals.css` or any
surface file:

- **Fredoka is brand-mark-only.** `--font-brand` (Fredoka, the channel's
  wordmark font) is used in exactly one place — the "PrepHub" text in
  `src/components/logo.tsx` — via the dedicated `font-brand` utility, never
  through `font-heading`. `--font-heading` resolves to Geist Sans (the same
  face as body/UI text); every semantic `h1`-`h6` gets `font-heading
  font-semibold tracking-tight` automatically via a `@layer base` rule in
  `globals.css`, so heading hierarchy comes from weight/size/spacing, not a
  separate display face. Do not repoint `--font-heading` at Fredoka again —
  that's the exact change that read as childish.
- **The marker stroke is the one repeated motif.**
  `src/components/ui/marker.tsx` draws a hand-made underline under the
  load-bearing word of a headline (landing hero, auth panels, diagnostic
  intro, practice paywall, progress empty state). It is a filled SVG path
  with two differently-curved edges, not a `border-bottom` — a uniform rule
  reads as a browser default, which is the machine-made quality it exists to
  break. It paints *before* the text and relies on paint order, deliberately
  not a negative z-index: `relative` with no z-index creates no stacking
  context, so `-z-10` escapes to the root and hides the stroke behind the
  section background. At most one per screen.
- **Radius is tight for controls and open for blocks.** `--radius` is still
  `0.375rem`, and `--radius-sm/md/lg` are unchanged, so dense app UI
  (inputs, badges, small buttons) keeps the tight Linear-style corner. The
  scale was opened only at the large end (`--radius-2xl` through
  `--radius-4xl`) for full section blocks — `rounded-2xl`/`rounded-3xl` on a
  page-scale panel, never on a control.
- **Three surface tokens carry the page rhythm**, and are the fix for tell 4:
  `--surface-tint` (a near-white teal wash — hero blocks, empty states,
  alternating landing sections), `--surface-deep` (the deep-teal block used
  full-bleed on the landing credibility band, the auth brand panel, and the
  signup left column) with `--surface-deep-foreground` for text on it, and
  `--marker` (the brighter cyan accent, used by the marker stroke and by
  `border-marker` rules). A page should alternate ground values, not sit at
  one value from top to bottom.
- **`--text-display-sm/display/display-lg/display-xl` are public-surface
  sizes** (landing, auth, diagnostic intro, session/practice status screens).
  The app interior tops out at `--text-page-title`, which is correct for a
  dense product — don't reach for a display size inside a dashboard.
  `--text-hero`/`--text-hero-lg` remain reserved for a single *number* (a
  score), not a sentence.
- **`size="cta"` is the pill.** One named button size (`h-12 rounded-full
  px-6 text-base`, `src/components/ui/button.tsx`) rather than that class
  string repeated at each call site, which is how the landing page, auth
  funnel and app interior would drift apart. At most one per screen: if two
  are visible at once, neither is the primary action.
- **No decorative icon tiles.** `src/components/icon-badge.tsx` is deleted,
  not deprecated — the pastel-tile treatment was removed from `PageHeader`
  (whose `icon` prop is gone entirely, along with all 16 call sites),
  `EmptyState`, the diagnostic intro screens, the onboarding wizard, the
  Owner landing cards, and the practice status screens, which left it with
  zero call sites. Where one of those needed a visual anchor, it got a two-digit
  ordinal (`01`, `02`, `03`) instead: that is information a glyph was only
  pretending to carry, and it differs per item, which six abstract icons did
  not. Don't reintroduce a badge tile on a new surface.
- **Prefer a rule to a box.** A row of stats is `divide-x`/`divide-y`, not N
  bordered cards; a long list (question review, prediction history, weakest
  skills) is one `divide-y` list with a `border-y`, not one border per row.
  Individually boxed rows turn a 21-item review into a wall of outlines.
  Settings (`src/app/(app)/settings/page.tsx`) follows the oneprep.xyz
  settings reference: a sticky left index (`settings-nav.tsx`, anchor links
  whose highlight follows scroll position — position-based, not
  IntersectionObserver, because the last section of a page never reaches a
  reading line and a wheel-scroll to the bottom is indistinguishable from an
  anchor click without the URL hash; the comments there record the cases)
  and, per section, a heading + one-line description + bordered cards. The
  profile card's stat tiles are `getDashboardData` — the same source as the
  dashboard, so the two can't disagree — and "Strongest category" is simply
  the max current mastery, not a new metric.
- **Status screens are left-aligned, not centered.** A centered column of a
  glyph, a heading, a line of grey text and a button is the default shape of
  every generated confirmation/error/empty screen. The practice gateway
  (`PracticeShell`), the diagnostic intro, and the session results hero all
  use a left-aligned block on `surface-tint` instead.
- **Color is applied precisely, not as soft full-card washes.** Score/stat
  cards are plain cards with a small compact indicator (e.g.
  `bg-achievement/12` on a small `rounded-md` badge, or bare colored text),
  not a large `bg-primary/[0.06]` tint across the whole card. This is *not*
  in tension with `surface-tint` above: a tint is a deliberate page-level
  band that groups a hero, not a decorative wash on an individual card.
- **`achievement` is a fourth accent**, deliberately separate from
  `primary`/`secondary`/`accent`, reserved for score/mastery *improvement*
  moments (dashboard's "+N points since you started," the results screen's
  celebration pill and mastery deltas, a positive study streak) — never for
  answer-correctness, which stays on ordinary green/destructive so it reads
  as the universal right/wrong convention instead of a brand flourish. The
  session-results "Correct" badge was on brand teal (`variant="default"`)
  in violation of that rule and is now green.
  **Gotcha, confirmed by screenshot**: `--achievement-foreground` is tuned as
  the text color for a *solid* `bg-achievement` fill, not for text sitting on
  the translucent `bg-achievement/15` wash this app actually uses for pills —
  paired that way it's unreadable in dark mode (near-black text on a
  near-black tinted surface). The fix everywhere it's used is
  `text-achievement-foreground dark:text-achievement`, not
  `text-achievement-foreground` alone.
- **Never fabricate social proof.** The landing page and auth panels carry
  only facts that are actually true (8M+ views across the PrepHub channels;
  Brilliant.org as a real sponsor). No invented testimonials, student names,
  university logo walls, or score-improvement statistics — not even as
  placeholder copy. The three channel videos under the credibility band
  (`src/lib/youtube/landing-videos.ts`, `src/app/landing-videos.tsx`) follow
  the same rule: thumbnails and titles come from YouTube (oEmbed, cached a
  day, with the real titles as a fallback), and the per-video view count is
  the Owner's own figure (`views` in `LANDING_VIDEOS`, dated in the comment
  there — the Owner chose this over a Data API key on 2026-09-19), replaced
  by the live count whenever `YOUTUBE_API_KEY` is set (cached 6h). Those
  typed-in figures only ever drift *low* as the videos accumulate views;
  refresh them and the date together. Every fetch swallows failure: a
  YouTube outage must not fail the landing page.
  Cards are lite embeds (thumbnail until clicked) so three players don't
  load on first paint.

**Gotcha, confirmed by DOM inspection**: the `Card` component draws its edge
with `ring-1 ring-foreground/10`, *not* a border. Zeroing only `border-0`
leaves the outline fully visible — `(auth)/layout.tsx` strips card chrome
with `[&>div]:border-0 [&>div]:ring-0 …`. When a style refuses to take,
inspect computed styles before guessing at another selector.

**Gotcha, confirmed by screenshot**: `ScorePrediction`'s miniature number
line is a range on the real 400–1600 SAT scale, so a typical 60–80 point
prediction fills only ~5% of the track and read as a stray dash. It has a 4%
minimum width, and its track is `bg-foreground/10` rather than `bg-muted`
because it renders on a teal-tinted panel as often as on plain white, where a
neutral-gray track disappears.

**Gotcha, also confirmed by screenshot**: light Tailwind status tints
(`bg-green-50`, `bg-amber-50`) read faint against *any* light background,
cream or white — the "correct answer" highlight in the session runner was
less visible than the "wrong answer" one until caught and bumped to
`bg-green-100`/`border-2`. (This was originally diagnosed as a cream-specific
contrast problem before `--background` moved to white — the fix stands
either way, so don't assume moving to white alone restores enough contrast
for a `-50` tint.) Any new light-mode status wash should be checked directly
against the rendered page, not assumed; the existing green/amber instances
across `session-runner.tsx`, `session-results.tsx`, `session-nav-grid.tsx`,
`timer-badge.tsx`, `student-preview-sheet.tsx`, and `question-editor.tsx` are
the reference pattern (`dark:` variants included — plain `bg-green-50` with
no dark override is a light-mode-only bug, not just a missed enhancement).

**Navigation shell**: `src/components/app-shell.tsx` (a client component,
used from the server-component `src/app/(app)/layout.tsx`) is a persistent
left sidebar on desktop (`sm:flex`, `w-64`) and a slide-out `Sheet` behind a
hamburger button on mobile — replacing an earlier top horizontal header.
**The sidebar is the deep-teal block in light mode too**, per the oneprep.xyz
dashboard reference: every `--sidebar-*` token in `globals.css` aliases
`--surface-deep`/`--marker` rather than defining a separate palette, so the
sidebar can't drift from the landing band and auth panel. Its bottom holds
an account block (initials, name, email, a Settings gear) and, for a student
without paid access, an "Upgrade · 50% off" row. That same `showUpgrade`
flag drives a one-line launch-pricing bar across the top of the content
column — it is computed in the layout from `hasPaidAccess` (the one
entitlement service), never inferred client-side, and it has **no
countdown**: the discount has no announced end date, and a fake timer is the
one kind of urgency this product must never show. `children` renders exactly once in a single
shared content column; only the surrounding chrome (sidebar vs. mobile
header+sheet) toggles by viewport — don't reintroduce a second `<main>` for
mobile, which would double-run page-level data fetching and client state.
Nav sections (student/admin/owner) are plain arrays of `{href, label, icon}`
keyed off `session.user.role`. Log out lives at the bottom of the sidebar
(`mt-auto`), not in a top corner — on a narrow viewport it's inside the
hamburger sheet, not visible until opened.

**Density**: `html`'s base `font-size` is `15px` (down from the 16px
browser default) in `globals.css` — since nearly everything in the app is
sized in `rem`, this one change proportionally tightens type/spacing/radius
app-wide without per-component overrides, which is most of how Linear/Stripe
read as denser. The deliberate exception is question/answer text in the
session runner (`session-runner.tsx`), sized up a step
(`text-lg`/`p-4 text-base`) so it stays "large, comfortable" (the Brilliant
reference) rather than shrinking along with everything else.

**Dashboard** (`src/app/(app)/home/page.tsx`): built from bordered
`rounded-2xl` modules (`Panel`) on the oneprep.xyz dashboard reference —
greeting + the day's two actions, one bordered row of four stats, a numbered
Strengths & Weaknesses list, a Score panel (prediction over target), and a
Premium panel for unpaid students. This is the one interior surface where
"prefer a rule to a box" yields to the reference: the border is each
module's *only* chrome (no tint, no shadow, no icon), and the stat row is
still rules inside one box, not four boxes. The greeting is time-of-day
("Good evening, Ada.") and must be decided on the client — the server's
clock is UTC — via the same `useSyncExternalStore` idiom as
`theme-toggle.tsx` (see `home/greeting.tsx`); e2e asserts on `/, Ada\.$/`,
not the salutation. Every number on it is real data from
`getDashboardData`; a derived stat like "sets since diagnostic" was
deliberately rejected because it would silently miscount an in-progress set.

**Hero numbers**: the few numbers that matter most (dashboard's Score
Prediction, the session-results Score Prediction) are set large and bold
(`text-6xl sm:text-7xl font-heading tabular-nums`) against otherwise quiet
surrounding UI — small uppercase labels, plain bordered stat tiles — so they
read as the obvious focal point rather than competing with everything else
on the page. Keep any new "headline number" (a stat tile, a streak count) on
this same `tabular-nums` + size-contrast pattern rather than a same-size
label+value pair.

## Core invariants (violate these and something in the PRDs breaks)

- **One account identity, multiple access methods.** A student's login (email/password
  or Google), their access method (individual subscription or district), and their
  learning history are three separate concerns. Changing one must never fragment or
  delete another. This is restated in nearly every PRD — treat it as load-bearing.
- **All authorization is server-side.** Hiding a button in the UI is not access
  control. Every mutation and every data read must independently check role +
  scope on the server.
- **One centralized entitlement service.** `src/lib/entitlements.ts` (`hasPaidAccess`)
  is the *only* place that decides paid-feature access:
  `hasActiveIndividualSubscription OR hasActiveSchoolEntitlement`. No feature may
  implement its own subscription or school-access check (PRD-017 §12).
- **Consequential operations are atomic and idempotent.** Answer finalization,
  Stripe webhook processing, membership activation/removal/graduation, contract
  transitions. Retried requests and duplicate webhook deliveries must not create
  duplicate state. Optional side effects (email, logging) must never block or
  fail the core operation.
- **A student has at most one active school membership.** Enforced at the DB level
  today via `StudentMembership.studentId` being `@unique`.
- **Deletion is anonymizing, not row-deletion.** Account deletion (PRD-001),
  membership removal (PRD-017) — data is preserved for historical reporting /
  legal reasons and marked inactive, never hard-deleted.
- **Fixed terminology.** "Diagnostic," "Personalized Practice," "Practice Session,"
  "Question Family" are user-facing terms and must appear exactly as written.
  Internal implementation names (adaptive set, recommendation engine, plan ID)
  must never leak into UI copy.
- **The 7 skill categories are fixed:** Reading Comprehension, Grammar, Vocabulary,
  Algebra, Geometry & Trig, Advanced Math, Problem Solving & Data Analysis. Don't
  add, remove, or rename without checking every PRD that enumerates them (004,
  006, 007, 008, 013, 014, 016).

## Engineering conventions

- Every page/component needs loading, empty, success, recoverable-error, and
  unrecoverable-error states. No blank screens. Error messages are actionable
  and never leak internals (no stack traces, no raw DB errors).
- Destructive or access-changing actions require an explicit confirmation that
  states the effect, timing, and reversibility.
- Config that can change behavior over time (feature flags, rate limits, adaptive
  engine constants, scoring thresholds) is centralized and versioned. Changing a
  config value must never retroactively alter historical results (e.g. past
  Predicted Score entries).
- Unit tests are required for anything algorithmic or state-machine-like:
  the adaptive engine, scoring, entitlements, billing transitions. See
  `src/lib/entitlements.test.ts` for the expected shape (mock Prisma, cover
  every branch of the business rule, not just the happy path).
- Migrations are tested against a disposable/local/preview DB, never first
  applied to production.
- Stripe subscription state always flows through `syncSubscriptionFromStripe`
  (`src/lib/billing/index.ts`) — one function, called from both the webhook
  handler and `src/app/(app)/billing/success/page.tsx`. The success-page path
  exists because this dev sandbox has no public URL for Stripe to call back to;
  in a real deployment the webhook is authoritative, but the success-page
  reconciliation is a legitimate defensive pattern on its own (immediate UI
  feedback without waiting on async webhook delivery), not a hack to remove.
- WCAG 2.1 AA on core student-facing workflows: full keyboard nav, color is
  never the sole state indicator.

## Rate limiting & structured logging (Global Engineering Requirements §3/§16)

`docs/PrepHub Global Engineering Requirements.pdf` sets standards that apply
across every PRD; these two are cross-cutting infrastructure rather than a
single feature, so they're documented here instead of in the build order.

- **Rate limiting** — `src/lib/rate-limit.ts`'s `RATE_LIMITS` centralizes the
  limit/window for every endpoint GER §3 names: login, account creation,
  password-reset requests, school-email verification requests. Call sites use
  `checkRateLimitEnforced` (not the pure `checkRateLimit`, which stays
  side-effect-free so its counting logic is directly unit-testable) — the
  `Enforced` wrapper is a no-op outside `NODE_ENV === "production"`. This
  isn't a shortcut: local dev has no reverse proxy setting a real client IP,
  so every request shares one `"unknown"` bucket, and e2e suites legitimately
  create dozens of accounts and log in dozens of times per run — confirmed
  by an actual e2e run tripping the login/account-creation limits before this
  guard existed. Login and password-reset requests key on *both* IP and the
  targeted email (either exceeding its limit blocks the request), so a single
  attacker hammering one account and an attacker spraying many accounts from
  one IP are both slowed down without blocking a student re-typing their own
  password a few times. Password-reset's rate-limit check runs before any
  database lookup, so a throttled response can't be used to distinguish a
  registered email from an unregistered one — preserving PRD-001's "identical
  response either way" rule even under rate limiting.
- **Structured logging** — `src/lib/logger.ts`'s `logEvent` (plus typed
  wrappers like `logAuthFailure`, `logUnauthorizedAccess`,
  `logGenerationFailure`) writes one JSON line per event via `console.error`;
  GER §16 explicitly says a dedicated Owner status page isn't required in V1
  ("Backend logs are sufficient"), so this needs no external log aggregator.
  Every context value is redacted if its key name matches
  `password|token|secret|cookie|cardnumber|cvc|authorization`, a backstop on
  top of call sites never passing those in the first place (GER §5). Wired
  into: every rate-limit rejection; login failures; Owner-only and
  Administrator-only route/action guards (logs the *attempt*, not normal
  student routing — GER's "Unauthorized-access attempts" category is about
  privilege-boundary violations, not routine `redirect("/home")` traffic);
  cross-student and cross-school resource-ownership violations
  (`requireOwnedSlot`/`requireOwnedAttempt`/`updateStudentInfo` — GER §2's
  "students own the requested student resource" and §6's Administrator
  school-scoping); Stripe webhook/payment failures; email delivery failures;
  best-effort practice-set pre-generation failures; media processing
  failures. `src/instrumentation.ts`'s `onRequestError` is a backstop for
  everything else — Next's own centralized capture point for uncaught errors
  across Server Components/Route Handlers/Server Actions, satisfying GER's
  "Unexpected server errors" category with no per-callsite try/catch needed.
  `src/lib/prisma.ts` logs "Database connectivity failures" via Prisma's
  event-based `log: [{level: "error", emit: "event"}]` + `$on("error", ...)`
  — deliberately *not* a `$extends` client extension: an extension changes
  `prisma`'s exported type in a way that broke `$transaction(async (tx) =>
  ...)` callbacks typed against the base `Prisma.TransactionClient` elsewhere
  in the codebase (confirmed via a real `tsc` failure while building this).

## Data model (`prisma/schema.prisma`)

Currently covers the identity/access spine only (Phase 1 below):
`User`/`Account`/`Session` (Auth.js), `LegalAcceptance`, `PasswordResetToken`,
`Subscription` (Stripe-backed), `Organization` (SCHOOL/DISTRICT, self-referencing
for district→school, `directoryVisible` for the search directory), `OrganizationDomain`
(`isActive`), `AdministratorAssignment`, `StudentMembership` (`schoolId` and
`organizationId` are separate FKs — a district student's `organizationId` is the
district, `schoolId` always resolves to the specific school),
`SchoolVerificationToken`, `MembershipHistoryEvent`.

Phase 2 (below) adds the content pipeline: `Question` (the primary
content-management object — denormalized `category`/`difficulty`/`questionType`/
`familyId` for the Questions table's filters), `QuestionRevision` (one immutable
snapshot per draft/published version — editing a Published question clones into
a new revision rather than mutating the live one; old revisions are never
deleted so a future Active Practice Set can keep referencing whatever was live
when it was generated), `QuestionAnswerChoice`, `QuestionFamily`
(optional grouping of up to 3 math questions sharing one video), `MediaAsset`
(uploaded images/videos, local-disk backed — see `src/lib/content/storage.ts`).

Phase 3 (below) adds the adaptive/diagnostic/scoring spine: `CategoryState`
(one row per student per category — `ability`/`initialAbility` floats,
`adaptiveQuestionsAnswered`, `consecutiveSetsWithoutExtraAllocation`, created
only after diagnostic completion), `PracticeSet` (`setNumber` sequential per
student, `randomSeed` for reproducible generation, at most one `ACTIVE` per
student — enforced in application code, not a DB constraint, same pattern as
`StudentMembership`), `CategoryGenerationSnapshot` (per-category audit trail
of the priority-allocation math at generation time — `abilityAtGeneration` is
also the "before" side of the Session Review mastery-delta display),
`BlueprintSlot` (`questionRevisionId`, not just `questionId` — this is what
makes Active-Set Content Stability free: an already-generated slot keeps
pointing at the exact immutable revision shown to the student even if the
Owner later edits/unpublishes the question), `FinalizedAttempt` (one per
slot, created exactly once — idempotency backstopped by a DB unique
constraint on `blueprintSlotId`, not just an app-level check),
`DiagnosticSession`/`DiagnosticAttempt` (`DiagnosticSession.studentId` is
`@unique` — no retake, per PRD-012 §25), `PredictionHistoryEntry`
(`DIAGNOSTIC` vs `ADAPTIVE_SET` source, immutable, never recalculated after
config changes).

Phase 5 additions: `Organization.communityGoalMetric`/`communityGoalTarget`
(PRD-009 §7 — Owner-configured, SCHOOL-type orgs only; null metric means no
active goal), `User.dailyReminderEnabled` (PRD-010 §7 — the only
independently-toggleable notification preference; real persisted storage,
though no scheduled delivery job exists yet to act on it).

Phase 6 additions: `Organization.totalEnrollment` (PRD-011 §9 — Owner-set
eligible student population, SCHOOL-type orgs only; null until the Owner sets
it, in which case Registration Percentage just isn't shown rather than
dividing by a missing denominator), `Announcement` (PRD-011 §16-§18 — one per
school, `removedAt` a soft delete so it still surfaces under "View previous
announcements," `expiresAt` a separate natural-expiration field; delivered by
email exactly once at publish time, no send-again action).

## Build order

The PRDs form these dependency layers — build top to bottom:

1. **Identity/access spine**: Auth (001, **built**: signup/login/logout, password
   reset, self-service account deletion — see `src/app/(auth)/`, `src/app/(app)/`,
   `src/lib/auth/account.ts`) → District Verification (002, **built**:
   access-selection page, school/district directory search, school-email
   verification with single- and multi-school flows — see `src/app/(app)/access/`,
   `src/lib/school-verification/`, `src/lib/organizations.ts`; sample orgs via
   `npm run db:local` + `npx prisma db seed`) → Billing (003, **built**: Stripe
   Checkout, webhook handler, plan switch/cancel/reactivate/promo codes — see
   `src/lib/billing/`, `src/app/(app)/pricing/`, `src/app/(app)/billing/`,
   `src/app/api/stripe/webhook/`) → Organizations/Contracts (017, **built**:
   schema + verification + billing-transition rule, plus §18 Owner-facing
   Schools Management UI — organization CRUD and SETUP/ACTIVE/SUSPENDED/ARCHIVED
   status transitions, administrator creation + assignment, student membership
   management (manual activation, remove/restore, graduation, school transfer)
   — see `src/lib/owner/`, `src/app/(app)/owner/schools/`; contract-date
   boundaries are enforced directly in `src/lib/entitlements.ts` as defense in
   depth — no cron job walks expired contracts yet, so a stale ACTIVE org with a
   lapsed `contractEndDate` still correctly loses entitlement on next check, but
   its displayed `status` field won't auto-flip to EXPIRED until an Owner acts
   on it or one is built).
2. **Content pipeline** (Owner-only, no student surface, **built**): Question
   Content System (013) + Internal CMS Dashboard (015) — Questions table
   (search/filter/sort/pagination/bulk actions), question editor (autosave,
   media upload, mandatory-preview-before-publish, Draft → Published →
   Draft Revision → Republish lifecycle), Question Families (create empty /
   group existing questions, atomic publish/unpublish across all 3 versions),
   Content Coverage (Category × Difficulty matrix) — see `src/lib/content/`,
   `src/app/(app)/owner/content/`. LaTeX renders via KaTeX
   (`src/components/content/latex-text.tsx`), and only inside `$...$`
   (inline) or `$$...$$` (block) delimiters — bare LaTeX syntax like `x^2`
   typed without `$` renders as literal text, by design (PRD-013 §12).
   Confirmed via user report that this wasn't discoverable: the field's only
   hint was placeholder text, which disappears the moment the field has
   content, so the requirement silently vanished right when it mattered.
   Fixed by adding a persistent (non-placeholder) caption — `LatexHint` in
   `question-editor.tsx` — under every LaTeX-enabled field (question text,
   answer choices, written explanation); keep any new LaTeX-capable field on
   this same pattern rather than a placeholder-only hint. Publish-readiness is computed by
   one shared pure function (`src/lib/content/validation.ts`'s
   `getPublishIssues`) used by both the editor's checklist panel and the
   Student Preview drawer, so they can't drift apart. `ffmpeg-static` is listed
   in `next.config.ts`'s `serverExternalPackages` — without that, Next's server
   bundler rewrites the package's `__dirname`-based binary path and video
   uploads fail with `spawn ENOENT` (only surfaces in a real build/dev-compile,
   not in `tsc`/`vitest`).
3. **Adaptive core** (**built**): Adaptive Recommendation Engine (014) —
   `src/lib/adaptive/`: pure math modules (`ability.ts` Elo-style update,
   `priority.ts`, `allocation.ts` largest-remainder category allocation,
   `difficulty.ts` weighted-random sampling, `random.ts` seeded mulberry32
   PRNG) plus Prisma-touching orchestration (`generate-practice-set.ts`
   implementing the §11-§15 Tier-1/Tier-2 selection-with-fallback pseudocode,
   `finalize-answer.ts`, `complete-practice-set.ts`). Predicted Score Engine
   (016) — `src/lib/score/`: `config.ts` centralizes the 15 SAT ranges +
   nonlinear Ability→range thresholds + representative midpoints;
   `generate-diagnostic-prediction.ts` / `generate-adaptive-prediction.ts` are
   deliberately separate functions using separate tables (same E/M/H
   diagnostic pattern intentionally produces a different Ability-init value
   in PRD-014's table vs. a different SAT-score value in PRD-016's table —
   this is correct, not a bug). Diagnostic (012) —
   `src/lib/diagnostic/` + `src/app/(app)/diagnostic/`: product intro (6
   informational screens + effort-message/CTA screen), 21-question runner
   (exactly one Easy/Medium/Hard per category, no difficulty fallback —
   missing content is a hard `GENERATION_FAILED`, unlike adaptive sets),
   completion wiring (`complete-diagnostic.ts`'s `finalizeDiagnosticCompletion`
   creates all 7 `CategoryState` rows, generates the initial prediction, then
   best-effort pre-generates the first practice set — a pre-generation
   failure must not block diagnostic completion, same pattern used after
   every completed practice set).
4. **Student practice loop** (**built**): Practice entry point (005) —
   `src/app/(app)/practice/page.tsx`: thin gateway showing set
   number/progress/Start-or-Continue, gated on `hasPaidAccess` (the
   generated-but-locked-behind-paywall state from §26) → Practice Session
   (006) + Session Review (007) — both diagnostic and practice reuse one
   shared UI pair: `src/components/session/session-runner.tsx` (question flow
   — MC/numeric answering, calculator, suggested-time notice, skip/resume nav)
   and `src/components/session/session-results.tsx` (celebration, prediction
   animation, goal progress, mastery bars, compact-then-detailed question
   review), matching PRD-012 §23's "diagnostic gets the standard
   completed-set results experience." **Deliberate PRD-005/PRD-014
   reconciliation**: PRD-014 §13 describes an engine-level "confirm
   submission with blanks treated as incorrect" capability, and
   `completePracticeSet`'s `confirmBlanks` option still implements it
   literally — but PRD-005 §21 (more specific, product-level) says a set
   "cannot be completed with blanks," full stop. The product surface
   (`allowBlankConfirmation` on `SessionRunner`) never exercises that bypass
   for students; it's engine capability, not exposed UI, for both diagnostic
   and practice alike.
5. **Aggregation/display**: Dashboard (004, **built**) — `src/app/(app)/home/`:
   greeting, score prediction (non-interactive), Continue Practice, weekly
   stats, study streak (`src/lib/dashboard/study-streak.ts`'s pure
   date-math — today-not-yet-studied never breaks an existing streak), recent
   improvements, mastery bars. Progress (008, **built**) —
   `src/app/(app)/progress/page.tsx` + `src/lib/progress/`: target-score
   progress, "Your Journey" narrative (`journey-narrative.ts`, pure/tested),
   milestones (`milestones.ts`), study statistics, weakest skills. **Known
   simplification**: the SAT Prediction History is rendered as an ordered
   list, not an interactive plotted graph — no charting library is in the
   stack yet; every required data point (session label, date, range) is
   still shown per PRD-008 §5/§12. **Known simplification**: neither page
   tracks true per-question elapsed time (PRD-012 §15 explicitly says
   response time must never affect scoring/adaptivity, so it was never
   modeled as more than a display nicety) — "Average Time Per Question" /
   "Study Time" are derived from session-level `createdAt`/`completedAt`
   divided evenly across 21 questions, in both `session-results-data.ts` and
   `dashboard-data.ts`. School Community (009, **built**) —
   `src/app/(app)/community/` + `src/lib/community/`: school-wide aggregate
   stats, one Owner-configured community goal (`communityGoalMetric`/`Target`
   on `Organization`, edited from `src/app/(app)/owner/schools/[id]`'s
   Community Goal card), auto-generated updates, school-scale milestones.
   Privacy is enforced by the data shape itself, not a filtering step —
   `getSchoolCommunityData`'s return type has no field that could carry a
   single student's identity or individual performance, so there's nothing
   to accidentally leak. Reachable via an `ACTIVE` `StudentMembership` (for
   students) or a SCHOOL-scoped `AdministratorAssignment` (for a School
   Administrator, added in Phase 6/PRD-011 below); anyone without either sees
   a "not applicable" state instead of a dead end. Profile & Settings (010, **built**) —
   `src/app/(app)/settings/`: Profile (first-name edit; graduation
   year/verified school shown read-only from `StudentMembership` when one
   exists), Academic Goal (target score), Notifications (Daily Practice
   Reminder toggle — see the `dailyReminderEnabled` note above), Appearance
   (Light/Dark/System via `next-themes`), Subscription (uses
   `src/lib/entitlements.ts`'s `getAccessSummary` — added alongside
   `hasPaidAccess` specifically so this page didn't need its own
   subscription/school-access re-derivation, per the entitlement-service
   invariant), Legal (`/terms`, `/privacy` — real pages; these were
   previously dead links from the signup consent checkboxes). The PRD-001
   account-security pieces (session revocation, self-service deletion) stay
   on this page below the PRD-010 sections rather than being removed.
6. **School Administrator** (011, **built**) — layered on top of everything
   above; this closes out the PRD build order. Core tension: an Administrator
   needs "the full PrepHub student experience" (§7 — diagnostic, practice,
   dashboard, progress, community, settings) exactly like a Student, while
   being structurally excluded from every school-wide aggregate. Resolved two
   ways: `src/lib/access.ts`'s `canUseStudentExperience(role)` (STUDENT or
   SCHOOL_ADMINISTRATOR) replaced every previously STUDENT-only gate across
   the student surface, and `src/lib/entitlements.ts`'s `hasPaidAccess` grants
   an Administrator unconditional access (they have neither a subscription
   nor a `StudentMembership` of their own to check). The aggregate-exclusion
   itself is "free," architecturally: every school-wide aggregate query scopes
   its student set via `StudentMembership`, and an Administrator only ever has
   an `AdministratorAssignment` — never a `StudentMembership` — so their own
   learning activity is never pulled into any total. The admin-only area
   (`src/app/(app)/admin/`, gated by `src/lib/admin/school-context.ts`'s
   `requireAdminSchoolContext` — role check + resolving the Administrator's
   one SCHOOL-scoped `AdministratorAssignment`; a DISTRICT-scoped assignment
   gets a not-applicable state, since PRD-011 §5 scopes one administrator
   account to one school):
   - **Admin Overview** (`/admin`, §10) — enrollment/registration numbers plus
     the same all-time activity totals School Community shows. Both pages
     call one shared `src/lib/school/aggregate-stats.ts`'s
     `getSchoolAggregateStats` (extracted from `getSchoolCommunityData` during
     this build) so they can never quietly disagree about what "Total
     Questions Answered" means for a school. Registered PrepHub Students
     (`src/lib/admin/overview.ts`) deliberately counts *every*
     `StudentMembership` status, not just ACTIVE — it's a historical
     association count ("was this student ever registered here"), not a live
     entitlement count, which is why it uses a different scope than the
     ACTIVE-only aggregate stats sitting right next to it on the same page.
   - **Student Directory** (`/admin/students`, §12-§14) —
     `src/lib/admin/student-directory.ts`: search/filter/edit, scoped to the
     Administrator's own school server-side on every read *and* write (an
     `updateStudentInfo` call for a membership at another school throws,
     regardless of what the UI would ever construct). "Last Active Date" has
     no dedicated column — it's derived as the max across
     `FinalizedAttempt.finalizedAt`, `PracticeSet.completedAt`, and
     `DiagnosticSession.completedAt`. First name and graduation year are the
     only editable fields, matching §14's explicit allow-list.
   - **Announcements** (`/admin/announcements`, §16-§18) —
     `src/lib/announcements.ts`: publish creates the row and emails every
     currently-ACTIVE registered student at their `verifiedSchoolEmail`
     (via the shared `src/lib/email.ts`, so dev runs/e2e read the same
     `.dev-emails.jsonl` outbox every other transactional email uses) in one
     atomic action; removal is a soft delete (`removedAt`) so the item
     survives under "previous" rather than disappearing. Displayed to
     students as a small banner on the Dashboard (`src/app/(app)/home/`'s
     `AnnouncementsBanner`) — the one surface decision this PRD left open.
   - **School Access & Support** (`/admin/access`, §19-§20) — intentionally
     thin: status + contract-date period + a support contact, no contract
     amount/invoices/payment detail (§19 non-goals).
   - Total School Enrollment is Owner-set only (§9 — "School administrators
     cannot edit the enrollment figure directly"), from the same
     `src/app/(app)/owner/schools/[id]` detail page as the Community Goal
     card, via `src/lib/owner/organizations.ts`'s `updateTotalEnrollment`
     (same SCHOOL-type-only restriction as `updateCommunityGoal`).
   - `useCloseDialogOnSuccess` (the "adjust state during render instead of a
     useEffect" close-on-success helper, previously local to
     `owner/schools/`) moved to `src/hooks/` during this build since the
     Student Directory's inline edit row and the Announcements create form
     both needed the identical pattern.

## 800 Club and The Curriculum (2026-09-19, modeled on oneprep.xyz)

Two Premium surfaces added after the PRD build order, at the Owner's
direction, on oneprep.xyz's "Challenge Questions" and "Masterclass".

**800 Club** (`src/lib/club/`, `src/app/(app)/800-club/`) — hard-question
sessions by section (Reading & Writing / Math). The pool is *published HARD
questions in the section's categories* — no separate tag, by Owner decision;
the Owner's own difficulty classification is what puts a question here.
**Sessions live in their own tables (`ClubSession`/`ClubSlot`), never in
`PracticeSet`.** Two reasons, both load-bearing: the app enforces "at most
one ACTIVE PracticeSet per student" and `/practice` finds the active set by
status alone, so a club session stored there would hijack the practice
loop; and PRD-014's ability update / PRD-016's prediction must never see a
hard-only sample. Nothing in `src/lib/adaptive` reads or writes club rows —
the isolation is by data shape, not by a flag, and was verified in a real
browser (dashboard prediction identical before and after a 10-question
session). `select-questions.ts` is pure (unseen-first, never pads, seeded)
and unit-tested. Sessions are `CLUB_SESSION_SIZE` (10) — shorter than a
Practice Set on purpose. The runner is the shared `SessionRunner`; the
results page is its own component because `SessionResults` is built around
a prediction update that doesn't exist here, but it reuses the exported
`QuestionDetail`. Gated on `hasPaidAccess` in both the page and the server
action. `/800-club/session/<id>` is the one focus-mode route matched by
prefix (`FOCUS_MODE_PREFIXES` in `app-shell.tsx`).

**The Curriculum** (`src/lib/curriculum/`, `src/app/(app)/curriculum/`,
`src/app/(app)/owner/content/curriculum/`) — the Owner's video course.
`CurriculumModule` → ordered `Lesson`s; a lesson's video is a YouTube id
(only the parsed 11-char id is stored — `youtube.ts`, unit-tested — and
embedded from `youtube-nocookie.com` with `rel=0`) or an uploaded
`MediaAsset` through the same `uploadVideoAction` the question editor uses.
Students see published lessons only; playing a non-free lesson needs
`hasPaidAccess`, decided in `getLessonForStudent`, and the gate is the data
(`LessonView.video` is null) — the player is never rendered for a locked
lesson, not hidden with CSS. `LessonProgress` is one row per (student,
lesson), recorded once. Reordering is pure list math (`ordering.ts`,
unit-tested) written as a whole renumbered set in one transaction so
positions never gap or collide. A lesson can't be published without a
playable video (`setLessonPublished`). The teacher card
(`teacher-card.tsx`) is the Owner's own bio as given; its view count is the
same 8M+ the landing page states so the site never makes two claims about
one channel. The Owner CMS lesson editor is fully controlled — Base UI warns
when an uncontrolled field's `defaultValue` changes after a save re-render.

**Deploying either one needs a migration applied to Neon first**
(`20260919165633_add_club_and_curriculum`) — the build is just `next build`,
so migrations do not run on deploy. Push code only after
`prisma migrate deploy` has succeeded against production.

## College Apps (2026-09-19, modeled on oneprep.xyz's College tab)

Premium (included in the single rate), gated on `hasPaidAccess` in the page
and in every action. `src/lib/college-apps/`, `src/lib/colleges/`,
`src/app/(app)/college-apps/`, Owner CMS at `owner/content/supplements`.

- **The college directory is a committed JSON, not a table**
  (`src/lib/colleges/data/colleges.json`, ~1,900 bachelor's-granting U.S.
  institutions from the Dept. of Education's College Scorecard: SAT 25th/75th
  per section summed to a composite, admission rate, size, test policy).
  Refreshed yearly by `node scripts/pull-colleges.mjs`, which downloads the
  bulk CSV (the API's DEMO_KEY allows ten requests an hour) with a built-in
  zip reader (shelling out to `tar` picked up Git Bash's on Windows). Searched
  in memory server-side; the client gets results via a server action. Tracker
  rows store the Scorecard id and denormalize the name.
- **Score fit** (`score-fit.ts`, pure, tested) is the reason this lives in
  PrepHub: the student's *live* Predicted SAT Score range against the
  college's middle 50%. likely / target / reach by range position; "aim for"
  is the 75th percentile, never below the student's own max. Drawn on the
  same 400–1600 number line as the dashboard (`ScoreFitBar`).
- **Prompts are copied, never referenced.** Platform essays (Common App,
  UC PIQs, Coalition, ApplyTexas — `platform-prompts.ts`, VERIFY EVERY
  AUGUST) are seeded as student-level items at onboarding; the Owner's
  curated `CollegeSupplement` rows for the current `admissionsCycle()` are
  copied into a student's checklist when they add the college. Editing the
  curation never rewrites an existing student's list, and each student's
  "done" is their own. One table (`ApplicationItem`) holds every checkable
  thing; `applicationId` null = student-level (shared essays, FAFSA/CSS).
- **Essay prompts are never student-entered** (Owner decision, 2026-09-19).
  Two sources only: platform prompts from code, and the Owner's curation
  each August (`/owner/content/supplements`, with "copy from last cycle"
  and a paste-and-extract tool — `parse-prompts.ts`, Anthropic, extraction
  only, hidden when the key is absent, results reviewed before saving). A
  student's "Add an item" offers recommendations, scores, fees, other — not
  essays; `addItemAction` rejects PROMPT server-side too. An uncurated
  college shows "PrepHub hasn't added … yet", not a form.
- **The grade decides the view.** Freshman/sophomore: `YEAR_CHECKLIST`
  leads and the list is secondary. Junior/senior: the list leads,
  deadline-first, with a countdown to the nearest one. Onboarding is the
  same roulette as SAT onboarding (grade → platforms), focus-mode route.
- **Gotcha, confirmed in a real browser: React 19 resets a form after a
  `<form action>` completes**, and a reset puts a controlled `<select>` back
  on its first `<option>` while React state still holds the saved value
  (text inputs survive because React syncs their value attribute; selects
  don't). Forms with selects submit through `onSubmit` + `startTransition(()
  => action(fd))` instead — see `application-forms.tsx`.
- Deploying needs migration `20260919221904_add_college_apps` on Neon first.

## 1v1 Rush (2026-09-20, modeled on oneprep.xyz's Question Rush)

Ten questions, a hard clock on each, points for right-and-fast, played solo
or head-to-head. `src/lib/rush/`, `src/app/(app)/rush/`; own tables
(`RushSet`/`RushSlot`/`RushChallenge`/`RushRun`/`RushAnswer`, migration
`20260920082506_add_rush` — apply on Neon before deploying). Never touches
the adaptive engine: a 60-second answer says nothing about ability.

- **The Owner's three decisions**: challenges are *asynchronous* (nobody
  has to be online at the same time — the second player races the first's
  recorded times, shown as a ghost line per question); an opponent is a
  *random match* or a *friend by link or code*; and *accepting is the free
  hook*. Starting anything (solo, random, friend) is Premium, checked in
  `startRushAction` as well as on the hub. `joinRushAction` and
  `/rush/join/[code]` deliberately have no paid check.
- **Random matching is a queue, not a lobby**: `startRandomRush` joins the
  oldest waiting RANDOM challenge in the same section/difficulty whose
  creator has *finished* (an abandoned run never becomes someone's
  opponent); otherwise it opens one and the player becomes the next
  student's match. A same-instant double-join yields a three-run challenge,
  which the results page simply ranks — not worth a row lock at this scale.
- **Time is measured on the server.** A `RushAnswer` row is created when
  the question is *served* (`servedAt`), and `submitRushAnswer` computes
  elapsed from that — the client never reports a duration. Serving is an
  upsert, so a reload mid-question resumes the same countdown rather than
  restarting it (confirmed: 57s left after a reload at 3s). The client
  counts down from `remainingMs` on its own clock, so device clock skew
  can't lengthen a question. `RUSH_GRACE_MS` (2s) covers the round trip
  for an answer sent at the buzzer; blank at 0 is a `timedOut` submit.
- **Scoring is one pure function** (`scoring.ts`, tested): 100 for a
  correct answer plus up to 100 scaled by clock remaining; wrong, blank, or
  past grace is 0 — never negative. Ties break on total time. Selection
  reuses the 800 Club's unseen-first/never-pad selector, and a MIXED set is
  dealt round-robin across the three difficulties.
- **The page never serves the first question.** `/rush/play/[runId]` renders
  a Ready screen; the runner's Start button is what calls
  `serveRushQuestionAction`, so page load and hydration don't eat into the
  clock. `RushRunner` is deliberately not `SessionRunner` (no skip, no
  revisit, no drafts — a choice click submits); it shares
  `QuestionStatement`/`LatexText`/the A-B-C-D choice markup by import.
- **A friend's link is the one URL a person without an account opens.**
  Signed out, middleware sends them to `/signup` and parks the code in the
  `prephub_rush_join` cookie; both `/home` (returning student who logged
  in) and onboarding's completion action (brand-new account, which never
  passes through `/home` first) redirect to the challenge from it, ahead of
  the access chooser. Middleware clears the cookie on the first signed-in
  request to the join page. Only FRIEND challenges are joinable by code.
- Question review on results goes through `getReviewableSlot`, which returns
  nothing until the viewer's own run is COMPLETED — so a second player can't
  read the set before playing it.
- Playwright gotcha: `screenshot()` injects `caret-color: transparent` on
  inputs by default, and a screenshot taken mid-hydration then shows up as
  a hydration-mismatch warning that isn't real. Pass `caret: "initial"`.

## Cross-phase fix: diagnostic must be reachable before access selection

PRD-002 §5.1 sends every student with no subscription/membership to `/access`
before anything else — but PRD-012 §5/§26 requires the diagnostic (and its
results) to be reachable by *any* student, paid or not, before they've chosen
school-vs-individual access. These were in real conflict: a brand-new
student had no path off `/access` to reach the free diagnostic. Fixed two
ways, both still passing every PRD-002 e2e assertion: (1) `/access` has a
"Take the free diagnostic first" link; (2) `/home`'s `needsAccessSelection`
redirect only fires while `diagnosticStatus === "NOT_STARTED"` — once a
student has started or completed it, `/home` never bounces them back to
`/access` again (they can still reach it via that same link, or the Practice
paywall's "View Plans").

## Gotcha: next-themes hydration mismatch

`next-themes`' `useTheme()` reads the persisted theme from `localStorage`
*synchronously on the client's first render* (by design, to avoid a flash of
the wrong theme) — so `theme` genuinely differs between the server render and
the client's very first render. Comparing it directly during render (e.g. to
decide a toggle's selected state) throws a real React hydration-mismatch
warning, confirmed while building `src/app/(app)/settings/theme-toggle.tsx`.
The fix is **not** the common `useState(false)` + `useEffect(() =>
setMounted(true), [])` pattern — this repo's `react-hooks/set-state-in-effect`
lint rule flags that (it flags *any* synchronous `setState` in an effect body,
not just prop-derived state). Use `useSyncExternalStore` instead: a
`getServerSnapshot` returning `false` and `getSnapshot` returning `true` gives
the same "false during SSR/hydration, true immediately after" result without
calling `setState` inside an effect at all. See `theme-toggle.tsx`'s
`useHasMounted` for the working pattern.

## E2E test content

`prisma/seed.ts`'s `seedQuestionBank()` publishes 6 questions per
(category, difficulty) — 126 total — directly via Prisma rather than through
the Owner CMS UI, because publishing through the UI requires a real uploaded
video per question (PRD-013's publish checklist) and E2E needs enough content
across all 21 category/difficulty combinations to reliably generate a full
diagnostic and practice set. `e2e/diagnostic-practice.spec.ts` deliberately
does not assume any particular answer-choice text when answering questions
(`button[aria-pressed]` is the one thing every MC choice button carries,
regardless of content) — the published question pool is shared with every
other e2e spec's own test-created content in the same dev DB, so seeded and
ad-hoc content end up mixed in the same category/difficulty pools.
