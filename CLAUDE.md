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
(`text-lg`/`p-4 text-base`, and a further step to `lg:text-xl`/`lg:text-lg`
on large screens since 2026-10-24) so it stays "large, comfortable" (the
Brilliant reference) rather than shrinking along with everything else.

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
   — since 2026-10-24 served as fourteen core questions plus a bonus round,
   see "The staged Diagnostic" below; the selection rule is unchanged
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
(`RushSet`/`RushSlot`/`RushChallenge`/`RushRun`/`RushAnswer`, migrations
`20260920082506_add_rush` and `20260920194117_add_rush_live` — apply on
Neon before deploying). Never touches the adaptive engine: a 60-second
answer says nothing about ability.

- **Every rush is Mixed.** The Owner dropped the difficulty picker
  (2026-09-20); `RUSH_DIFFICULTY` is the one value the product uses and
  `selectRushQuestions` deals it round-robin across easy/medium/hard. The
  enum stays on the row for old data; don't re-expose it.
- **Live is the headline mode** (Owner, 2026-09-20: "both online at the
  same time is more intense"). `src/lib/rush/live.ts` +
  `/rush/live/[challengeId]`: a WAITING lobby → COUNTDOWN (5s once the
  second player joins) → PLAYING on one server-side clock
  (`livePositionStartedAt`) → FINISHED. **No WebSockets on this host**, so
  both clients poll `getLiveState` once a second, and *every poll runs
  `tickLive`*, which is what advances the room — to PLAYING when the
  countdown ends, and to the next question once both have answered or the
  limit (+ grace) has passed. Either player's poll may do the advancing, so
  it is one `updateMany` guarded on the position it expects to leave; the
  loser of the race just reads the new state. Timeouts are written only to
  answer rows still blank (`updateMany … answeredAt: null`) so an answer
  that lands mid-tick is kept. The client fetches the next question at the
  instant the shared clock opens (a timer set from `nextStartsInMs`), never
  earlier — content is not sent during the 2.5s gap, so nobody reads ahead.
  Presence is `RushRun.lastSeenAt`, bumped by every poll: the random queue
  skips lobbies stale by `LIVE_LOBBY_STALE_MS`, the join page refuses a room
  whose host has gone, and an opponent quiet for `LIVE_PRESENCE_MS` shows as
  "away" while their questions time out. Leaving an empty lobby deletes its
  set (cascade); a random lobby offers "race a recorded run" after
  `LIVE_RANDOM_FALLBACK_MS`. The Leave/fallback forms set a `leaving` ref so
  the poll loop's "no room → /rush" doesn't race the action's redirect —
  found in a real two-browser run.
- **The hub's four options** (`RUSH_PLAY_OPTIONS`): Random opponent (live
  queue), Friend · live (room + link/code), Friend · anytime (the recorded
  challenge below), Solo. Starting any of them is Premium, checked in
  `startRushAction` as well as on the hub. `joinRushAction` and
  `/rush/join/[code]` deliberately have no paid check — accepting is the
  free hook — and route to the room or the runner by `challenge.live`.
- **The recorded (async) path stays** for a friend who isn't online and as
  the random fallback: the second player races the first's recorded times,
  shown as a ghost line per question. `startRandomRush` (async, `live:
  false`) joins the oldest waiting RANDOM challenge whose creator has
  *finished* (an abandoned run never becomes someone's opponent); otherwise
  it opens one. A same-instant double-join yields a three-run challenge,
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
  past grace is 0 — never negative. Ties break on total time. Since
  2026-10-24 a challenge also carries a `scoringVersion`; version 2 adds an
  answer-streak bonus (see "1v1 Rush, game feel" below). Selection
  reuses the 800 Club's unseen-first/never-pad selector, and a MIXED set is
  dealt round-robin across the three difficulties.
- **The page never serves the first question.** `/rush/play/[runId]` renders
  a Ready screen; the runner's Start button is what calls
  `serveRushQuestionAction`, so page load and hydration don't eat into the
  clock. `RushRunner` (recorded) and `LiveRush` (rooms) are deliberately not
  `SessionRunner` (no skip, no revisit; since 2026-10-24 a choice is a draft
  until Submit, Enter, or the buzzer);
  both render the question through the shared `rush-question.tsx`
  (`RushQuestion`, `TimeBar`) so the two modes can't drift apart.
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

## The new-student path and the free tier (2026-09-21, from production data)

Production numbers on 2026-09-21 (104 real students): 79 started the
Diagnostic, 41 finished — 29 of the 38 who quit did so within four
questions, 11 before answering anything — and it was 16 screens from the
landing page to question 1. 38 students had a generated Set 1 sitting
locked and never answered a practice question; 3 paid. The Owner approved
the following, several of which deliberately override PRD text:

- **Signup → `/onboarding` (three questions, no welcome step) → `/home`
  → the Begin Diagnostic card → one intro screen → question 1.** The
  Owner reversed two things the same day they shipped (2026-09-21): a
  version that skipped the questions and sent a new account straight to
  `/diagnostic`, and a `/home` that force-redirected a `NOT_STARTED`
  student there. **A new student must be asked grade/target/commitment
  first, and `/home` must never force the Diagnostic** — the card sits
  inside the app shell so they can start it or look around. `/home`'s only
  forced redirect is an unfinished onboarding. `signUpAction` still honors
  the 1v1 Rush join cookie before anything else. The Diagnostic intro is
  **one screen** (`intro-screens.tsx`): PRD-012 §6-§7's six informational
  screens and the effort screen are gone, their content folded into the
  three-item list and a closing sentence.
- **No price on the landing page** (Owner, 2026-09-21). "$8.25 a month"
  is the annual plan's per-month figure and lives on `/pricing` only;
  never put a number on `/`.
- **`/access` is out of the path.** PRD-002 §5.1's chooser still exists for
  the school flow, but with school access hidden it was a "$25/month" card
  shown before any value. `needsAccessSelection` is no longer called from
  `/home`.
- **Set 1 is free** (`src/lib/practice/free-tier.ts`, `FREE_PRACTICE_SETS`,
  tested). `canOpenPracticeSet` composes `hasPaidAccess` rather than
  replacing it — the entitlement service still decides "paid"; this only
  says which sets are free. Applied on the practice gateway, the session
  page, *and* `submitPracticeAnswerAction`. The Set-2 paywall quotes how far
  Set 1 moved the prediction (last two `PredictionHistoryEntry` rows). The
  dashboard's one big button reads "Unlock Practice Set N" for a free
  student whose free set is done, and the pace line is hidden then.
- **The results page's CTA is "Start your free practice set"** (with a
  fallback to `/onboarding` for an account that somehow skipped it).
- **The results page says what the numbers mean** — `diagnosticVerdict`
  (`src/lib/session/verdict.ts`, pure, tested) names the two weakest
  categories, the analysis the landing page promises — and offers a
  copyable parent summary (`ParentSummary`). Parents pay.
- **The runner**: both question types take an explicit Submit (a tapped
  choice is only a saved draft — tap-to-submit graded a student who was just
  comparing options; numeric also submits on Enter); Finish appears only once every question is answered, and on the
  last question with blanks it jumps to the first blank; on phones the
  21-cell navigator is one scrolling row (`session-nav-grid.tsx`).
- **Signup has one checkbox** (age, COPPA). Terms/Privacy are accepted by
  creating the account, stated under the button; the same `LegalAcceptance`
  rows are recorded (hidden `tosAccepted`/`privacyAccepted` inputs).
- **Share/SEO**: `layout.tsx` metadata (title template, description,
  Open Graph, Twitter), `opengraph-image.tsx` (next/og, inline SVG mark —
  logo.tsx's SVG needs CSS variables the renderer lacks), `sitemap.ts` and
  `robots.ts` (public pages only). Before this every shared link had no
  preview and the title was "PrepHub".
- e2e: `signUpNewStudent` drives the three questions and lands on `/home`.
  The suite is timing-flaky against the dev server with parallel workers (a
  signup redirect can exceed the 5s URL assertion); `--workers=1` passes.
- **Gotcha**: `redirect()` from `/home` arrives as a 200 with a streamed
  client-side redirect (the app shell streams before the page body runs),
  so a Playwright `goto("/home")` reports `/home` until `waitForURL`
  settles on the target. Not a bug; don't chase it.

## Funnel analytics and the Daily Challenge (2026-09-21)

- **First-party analytics** (`src/lib/analytics/`): no third-party script.
  `track()` writes an `AnalyticsEvent` row, fire-and-forget (a failed write
  never fails the operation), at the moments no table records — a paywall
  view (locked practice gateway, pricing page), a checkout start, a daily
  answer — plus `signed_up`/`diagnostic_started`/`diagnostic_completed`
  as a timeline. `getFunnelReport` counts the funnel from the *source
  tables* (User, DiagnosticSession, PracticeSet, Subscription) so the
  numbers are right for months before events existed, and from events only
  for paywall/checkout. Public pages (landing, auth, signup) and `/pricing`
  mount `PageViewBeacon`, a `navigator.sendBeacon` to `/api/beacon`, which
  accepts exactly two event names and stores the referrer's *host* only.
  The Owner reads it at `/owner/funnel` (7/30/90 days, per-day signups,
  referrers). Test accounts (`example.com`) are excluded everywhere.
- **Daily Challenge** (`src/lib/daily/challenge.ts`, `/daily`): one
  published HARD question per UTC day, the same for everyone, free for
  every account — the free tier's reason to come back (5 of 105 students
  had returned after day one). Picked on the day's first request, seeded
  by the date, preferring questions no earlier day used, pinned in
  `DailyChallenge` (unique on `day`; a lost insert race re-reads). One
  attempt per student per day (`@@unique([challengeId, studentId])`); the
  correct answer and explanation render only after this student's answer.
  Streak = consecutive UTC days answered, not broken until a day is
  actually missed (`streakFromDays`, pure, tested). Outside the adaptive
  engine like the 800 Club and Rush. The dashboard shows a one-row door
  to it; the answered state nudges free students toward the 800 Club.
- Migration `20260921202200_add_daily_challenge_and_analytics`.

## Lifecycle email (2026-09-21)

`src/lib/email.ts` sends through Resend when `RESEND_API_KEY` is set and
writes `.dev-emails.jsonl` otherwise; the sender is `EMAIL_FROM` (default
`PrepHub <no-reply@prephubtp.com>` — the old hard-coded `prephub.app`
address was on a domain that was never verified, so the first real key
would have been rejected). Three lifecycle emails in
`src/lib/lifecycle/emails.ts`, all plain text in the Owner's voice next to
the existing welcome email, all recorded in `EmailSend` (unique on
user/kind/day) *before* sending so a re-run can't double-send, all
best-effort:

- **Results** — immediately after the Diagnostic (from
  `finalizeDiagnosticCompletion`, `void`, never awaited): the prediction,
  the two weakest categories, the free-set link.
- **Finish your Diagnostic** — once per account, 20h–7d after signup
  without a completed Diagnostic; the subject carries how many of 21 are
  answered.
- **Daily reminder** — the Settings toggle, finally wired: once a day to
  students with it on who haven't answered anything today; paid → their
  set, free → the Daily Challenge.

The last two run from `POST /api/cron/daily` (bearer `CRON_SECRET`; 404
without it), triggered by the Netlify scheduled function
`netlify/functions/daily-cron.mts` at 22:00 UTC — a plain `fetch`, so the
app and Prisma are never bundled twice. `netlify/functions` is Netlify's
default functions directory, so no `netlify.toml` is needed. Production
needs `RESEND_API_KEY`, `CRON_SECRET` (and optionally `EMAIL_FROM`) in
Netlify, and `prephubtp.com` verified in Resend. Test accounts
(`example.com`) never receive lifecycle mail. Migration
`20260921204113_add_email_sends`.

## Page performance (2026-09-30, measured on production)

Production TTFB was 0.42s warm but **1.59s cold**, and with only a few
signups a day nearly every real visitor got the cold path.

- **The landing page is prerendered** (`export const revalidate = 86400`)
  and its "already signed in → /home" redirect lives in `src/middleware.ts`.
  `auth()` in a Server Component makes the whole route dynamic, so that one
  call forced a Node function to boot and server-render the marketing page
  for every visitor, including first-timers with no session. The build now
  shows `○ /` rather than `ƒ /`; locally it serves in 18–33ms against
  ~600ms for a dynamic page. **Don't reintroduce `auth()`, `cookies()` or
  `headers()` into `src/app/page.tsx`** — one call silently un-prerenders
  it. Middleware only decodes the JWT cookie (no database) and checks
  `token.userId`, matching what the page used to check: a deleted account's
  cookie still decodes until it expires, so the bare token isn't enough.
  Verified: signed out, signed in, after logout, and with a garbage session
  cookie — all correct, no redirect loop.
- **`hasPaidAccess` and `getAccessSummary` are wrapped in React `cache()`**,
  memoized per request. The app shell calls `hasPaidAccess` on every
  authenticated render to decide the Upgrade row, and most pages call it
  again to gate themselves — `curriculum/queries.ts` alone called it three
  times in one render, at three queries each. Outside a React request scope
  (vitest, a cron route) `cache` degrades to a plain call rather than
  throwing; the entitlements unit tests exercise exactly that and pass.
- **`decidePaidAccess(role, subscription, membership)`** is the pure verdict;
  `hasPaidAccess` is the fetching wrapper around it. `/home` calls the pure
  one with rows it already loads, which is why its membership query now uses
  `include: { organization: true }`. The entitlement rule still lives in one
  place (PRD-017 §12) — only the fetching is skipped.
- **The two study-streak scans are bounded** to `STREAK_HORIZON_MS` (two
  years). They previously fetched a student's entire answer history on every
  dashboard render to compute a number that only depends on the unbroken run
  of days ending today.
- Measured queries per render, before → after (student with a completed
  Diagnostic): `/home` 29 → 26, `/daily` 17 → 14, `/curriculum` 11 → 8,
  `/800-club` 13 → 10, `/rush` 15 → 12.
- **Connection and region**: since 2026-10-25 the production `DATABASE_URL`
  is Neon's `-pooler` endpoint (confirmed: only `pgbouncer` connections in
  `pg_stat_activity`); `.env.neon` deliberately stays on the *direct* string,
  because `prisma migrate` takes an advisory lock the transaction-mode pooler
  can't hold. Neon is in `us-east-2`; whether Netlify's functions are too is
  unverified — Netlify's docs say sites created after October 2023 default to
  Ohio (us-east-2), so the earlier "functions default to us-east-1" note was
  probably wrong. `/owner/status`'s Function region line settles it.

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

## District readiness (2026-10-21)

A pass over everything that works at a 40-student pilot campus and breaks at a
2,000-student district, done before signing a paid partnership. The theme of
almost every finding was the same: a query whose cost grows with how much
students have *done* rather than with how many *rows the page shows*.

- **One definition of "answered a question"** —
  `src/lib/school/student-activity.ts`. Answering is recorded in six tables
  (seven since homework, 2026-10-24),
  because every study mode added after the adaptive core deliberately kept its
  own rows (800 Club, 1v1 Rush, Focused Practice, Daily Challenge — the
  isolation is what keeps a hard-only or speed-only sample out of PRD-014's
  engine). The cost of that isolation is that anything counting "questions
  answered" has to know all six places, and every school aggregate knew two:
  a campus that had taken to the Daily Challenge was reported as having
  answered nothing. `answerActivity`/`sessionActivity` are composed
  `Prisma.sql` fragments, so a seventh mode is added in exactly one place.
  `totalAdaptiveSessionsCompleted` is the one figure still restricted to
  `PracticeSet`, deliberately — it is labelled "Practice Sets" on both pages
  (it said "Adaptive Sessions" until 2026-10-25, an internal name that had
  leaked into copy) and a Rush run is not one.
- **Every school-wide figure is counted in the database.**
  `getSchoolAggregateStats` used to load every `FinalizedAttempt` row for
  every student and call `.length`; `getCampusImpact` loaded every prediction
  and every completed session to produce six integers. Both now return
  row counts that depend on the number of *students*, not their history —
  `getCampusImpact`'s prediction query uses `ROW_NUMBER()`/`COUNT(*) OVER` to
  return one row per student with both ends of their journey in it, and its
  study-time query aggregates all the way down to a single row.
  `getSchoolAggregateStats`'s score-improvement figures come from one
  `LAG`/`FIRST_VALUE`/`LAST_VALUE` pass. Tests for all of this go through
  `src/lib/school/test-fixtures.ts`, which derives from one readable fixture
  what each raw query would have returned, routing on which table the SQL
  names — a test still reads as a list of answers and sessions.
- **Indexes.** Postgres does not index a foreign key automatically and nothing
  had done it by hand, so `FinalizedAttempt` — the fastest-growing table in
  the product — was scanned end to end for every dashboard, Progress page,
  Student Directory and campus aggregate, and `PredictionHistoryEntry` had no
  index at all beyond its primary key. Migration
  `20261022031507_add_hot_path_indexes` adds the ten that are on a hot path;
  `(studentId, finalizedAt)` and `(studentId, createdAt)` are composites
  because every caller filters by student and then by a time range.
  `StudentMembership` gained `(schoolId, status)` and
  `(organizationId, status)`, which is the shape of every school-scoped query
  in the admin area.
- **Pagination.** The Student Directory pages at 50
  (`STUDENT_DIRECTORY_PAGE_SIZE`, URL-based so a page is bookmarkable), and
  the Owner's membership list at 50 (`MEMBERSHIP_PAGE_SIZE`) with the total
  stated beside it. The roster list stayed at 500 but gained a debounced
  search over email and first name, because the student an Owner is asked
  about on a support call is almost never in the first page.
- **Roster upload.** `commitRosterUpload` was one `upsert` per row — 2,000
  database round trips for a district, a few seconds on a local socket and
  well over a minute against a database in another region, so the upload timed
  out at exactly the size where it matters. Now one `createMany` (keeping
  Prisma's own cuid generation) plus one bulk `UPDATE ... FROM (VALUES ...)`
  per chunk of 500. Measured: 2,000 rows in 2.6s, and the same again on
  re-upload. The UPDATE has to be raw SQL because `updateMany` can only set
  one value across every matching row and every student has a different name.

### The outbound email queue

`src/lib/email-queue.ts` + migration
`20261022025547_add_email_queue_and_roster_invites`. Resend's batch endpoint
takes 100 addresses per call, so a 2,000-student announcement is twenty-odd
sequential calls — more than a serverless request gets. Sending straight from
the request that triggered it meant the function was killed partway through,
having delivered an unknowable subset, with no record of which addresses got
it and no way to retry.

- **Write the rows, then drain.** `queueRows` returns data rather than writing
  it, so a caller can insert inside its own transaction —
  `publishAnnouncement` now creates the announcement and queues its mail
  together, so there is no state where an announcement is live and nothing was
  ever going to be mailed for it.
- **The triggering request drains for `REQUEST_DRAIN_BUDGET_MS` (4s)**, which
  is why a 40-student campus still sees instant delivery; the rest is finished
  by `netlify/functions/email-queue-cron.mts` hitting
  `POST /api/cron/email-queue` every five minutes.
- **Claiming is one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
  LOCKED)`**, which is the one shape that makes the scheduled run and a
  request-time drain safe to overlap: each walks away with a disjoint set
  rather than both sending the same mail. `SKIP LOCKED` is why it is raw SQL.
  Verified with two concurrent drains over 12 rows: each sent exactly once.
- A failed batch releases its claim rather than marking sent, so the next run
  retries; `attempts` is incremented by the claim and `MAX_ATTEMPTS` (5)
  retires a permanently bad address. A partial provider failure retries the
  whole batch — a duplicate email is a far smaller problem than an
  announcement a student never receives.
- **The Owner status page shows queue depth and the age of the oldest waiting
  row.** "Pending" climbing and never falling is the one symptom that means
  the scheduled drain has stopped, which is otherwise completely silent:
  students simply never hear from their school.

### Roster invitations (closes a flyer promise)

`src/lib/owner/roster-invites.ts`. Roster upload and domain enrollment were
built, so a student who signs up is matched to their campus automatically —
but nothing ever told the student to sign up. A district handing over 2,000
addresses and hearing nothing back is the most expensive failure this product
has, and it is entirely an outreach problem.

- **No account is created and no password is ever generated.** The invitation
  asks the student to create their own account with their school email; the
  roster match does the rest. That is a deliberate choice over mailing
  generated credentials, which would put PrepHub in custody of passwords for
  minors, send a live password through a mailbox a parent may read, and leave
  every unclaimed account sitting there with a known password forever. **The
  general flyer's "we email students with private login credentials, an email
  and a password" was corrected to match** — see the materials folder's
  `PROMISED-NOT-BUILT.md`.
- Capped at `ROSTER_INVITE_SEND_LIMIT` (500) per click and resumable:
  `invitedAt`/`inviteCount` on `SchoolRosterEntry` mean the next click picks up
  exactly where the last stopped, and the UI reports what is left. The mail and
  the marking happen in one transaction — recording without sending means the
  student is never told, sending without recording means the whole district
  gets a second copy.
- `reminder: true` is the separate, explicit "chase the people who ignored the
  first one" action, not a silent re-send.
- Refuses an organization that isn't `ACTIVE`: inviting students to a school
  whose contract hasn't started would send them to a paywall with their own
  school's name on it.
- A School Administrator can send for their own campus
  (`/admin/students`' `CampusInvitePanel`). `inviteScopeForSchool` is the one
  place that maps a campus to the organization owning its roster
  (`parentDistrictId ?? schoolId`), so an administrator can never reach a
  sibling campus's students.

### Per-student engagement in the admin area (closes the other flyer promise)

The Student Directory now shows questions answered, sessions finished and study
time per student, alongside last-active. **Engagement, never performance**: an
Administrator sees *how much work* a student has done and never *how well*. No
correctness, ability, mastery or predicted-score field is selected out of the
database anywhere in `src/lib/admin/student-directory.ts`, which is a stronger
guarantee than filtering one out later (PRD-011 §21). PRD-011 §7 originally
excluded engagement too; it was added after an administrator asked for it
directly on 2026-10-21, because "has this student even started?" is the
question an intervention actually turns on. The page says the boundary out
loud in its description, because a student deserves to be able to read the same
sentence. **Per-student scores remain a separate decision and are not implied
by this one.**

### Rate limits had to fit a campus, not a household

`RATE_LIMITS` used one config for both the per-IP and per-identity dimension,
which made it unusable for a school: every student on a campus network shares
one public NAT address, so a homeroom of thirty signing up together was thirty
signups from one IP against a limit of five an hour. The sixth student — in the
room, with us standing there — would have been told to come back later, and a
computer lab logging in at the start of a period hit the same wall at ten.

The two dimensions are now separate entries with very different numbers.
`LOGIN_PER_EMAIL` (10/5min) and `PASSWORD_RESET_PER_EMAIL` (5/15min) stay tight
because that is where the actual protection lives; `LOGIN_PER_IP` (300/5min),
`ACCOUNT_CREATION_PER_IP` (200/hr) and `PASSWORD_RESET_PER_IP` (100/15min) are
flood guards sized so a whole campus fits underneath. Account creation has no
per-identity dimension to key on — an address can only hold one account, which
the unique constraint already enforces — so per-IP is the only tool there.
A unit test asserts the per-IP floors and the per-identity ceilings, so the
regression can't come back quietly. The module also now states plainly that
on serverless each warm instance keeps its own `Map`, so the effective limit is
per-instance and resets on a cold start; a shared store is the upgrade path and
`checkRateLimit`'s signature is the seam for it.

### The annual rollover finally exists

PRD-017 §10 describes "the automatic July 1 cutoff" and `markGraduated` was
written as the manual override that runs "ahead of" it — but the automatic half
was never built, so the only way a cohort left was the Owner clicking through
them one at a time. At a district where 500 seniors leave on the same day that
does not happen, and every one of them keeps district-funded access into a year
the district isn't paying for. `src/lib/owner/graduation.ts`'s
`runGraduationSweep` runs from the daily cron, is idempotent (the update is
guarded on `status: "ACTIVE"`), writes one `MembershipHistoryEvent` per
graduation in the same transaction, and chunks at 500. `graduationCutoffYear`
is pure and tested at the four boundaries that matter, because an off-by-one
here either cuts a senior off mid-year or lets a graduate keep access for
another.

**All five membership transitions are now atomic.** `manuallyActivateStudent`,
`removeMembership`, `restoreMembership`, `markGraduated` and
`resolveSchoolTransfer` each did their status change and their
`MembershipHistoryEvent` as two separate writes, so a failure between them left
a membership whose status change had no audit record — which is the entire
purpose of that table (PRD-017 §16) and exactly what CLAUDE.md's "membership
activation/removal/graduation are atomic" invariant is about.

### Owner funnel

`getFunnelReport` loaded every signup, every completed Diagnostic and every
subscription in the window to bucket them by day in JavaScript, and counted
paywall/checkout steps with `groupBy({ by: ["userId"] }).then(r => r.length)` —
one row per distinct user pulled back purely to take its length. Both now
happen in the database (`DATE_TRUNC` + one `UNION`, and `COUNT(DISTINCT)`).
This also fixed a real latent crash: the signup loop used
`series.get(...)!.signups++` where its two siblings guarded with `if (s)`, so
one row landing in a bucket outside the window — which the UTC day boundary
makes entirely possible — took the whole page down with a `TypeError`.

### Deploying this

**Two migrations must be applied to Neon before the code is pushed**, in
order: `20261022025547_add_email_queue_and_roster_invites` then
`20261022031507_add_hot_path_indexes`. The build is just `next build`, so
migrations do not run on deploy. Netlify also needs nothing new — the
email-queue schedule is a file in `netlify/functions`, and it reuses the
existing `CRON_SECRET`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## The staged Diagnostic (2026-10-24, from production data)

Production on 2026-10-24: 144 students had started the Diagnostic and 73
quit — 48 of them within the first three questions. After question four
almost nobody left: eighteen more questions, six of them Hard, lost 25
students between them. The opening was the problem, and the opening was an
accident.

- **A discarded shuffle, since the initial commit.** `shuffle` in
  `src/lib/adaptive/random.ts` returns a new array; it does not shuffle in
  place. `start-diagnostic.ts` called `shuffle(resolved, random)` and threw
  the result away, so every student got the category-then-difficulty loop:
  Reading Comprehension Easy, Medium, then Hard — the three longest
  questions, the third answered correctly 45% of the time — as questions one
  to three. **`generate-practice-set.ts` had the identical bug**, so every
  Practice Set was served grouped by category. Both are fixed;
  `generate-practice-set.test.ts` asserts the interleaving and was confirmed
  to fail against the old line. Anyone calling `shuffle` must use its return
  value.
- **`src/lib/diagnostic/sequence.ts` is the served order and the rule**, both
  pure and tested. Fourteen core questions — one Easy and one Medium per
  category — chosen from production accuracy and length: the first four are
  the likeliest wins (Advanced Math Easy, the shortest question in the test,
  first), Reading passages are never adjacent, each Easy precedes its Medium.
  Then a **bonus round**: a category's Hard question is served only if its
  Medium was answered right; otherwise it is waived (`waivedAt`) and scores
  as a wrong answer — which every scorer already does, because they all read
  `!!isCorrect`, so neither scoring table changed. Replaying all 71 real
  completed Diagnostics through this rule: students predicted below 1100 see
  about 17 questions and 3 Hard ones instead of 21 and 7; starting scores land
  in the same displayed range two-thirds of the time and average ~29 points
  lower (part of that is the full test crediting lucky guesses). Dropping the
  Hard tier outright was rejected — it scored everyone ~112 points low, which
  district gain reporting would have counted as improvement that never
  happened.
- **"These can only raise your predicted score"** on the bonus-round screen
  is a checked claim, not copy: with the Medium right, a right Hard raises the
  category in both tables (ability 65→90 or 45→80; score value 1300→1600 or
  800→1000), and a waived Hard is scored as a miss. Re-check it if either
  table changes.
- **`DiagnosticSession.format`** (`FULL_21` / `STAGED`) records which test a
  student took, because the two give slightly different starting scores and
  district gain reporting must never mix them unknowingly. The DB default is
  `FULL_21` so a session created by old code during a deploy is labelled
  truthfully; new code writes `STAGED`. An in-progress `FULL_21` session is
  converted the next time its student opens it (`convertLegacySession` —
  idempotent, keeps every answer, rewrites positions in two passes because
  `(diagnosticSessionId, position)` is unique), so the 73 who quit come back
  to the new opening.
- **The server decides the stage, never the client** (`advanceDiagnostic`,
  `currentStage` in `stages.ts`). The core runner's button says "Continue"
  and goes either to the bonus-round screen or straight to results; a student
  who earned no Hard questions finishes at fourteen and is never told they
  "unlocked zero". The runner indexes items by array position, so each stage
  is given its own list renumbered from zero. **Until a bonus question has
  been answered, the page ignores `currentPosition`** — a student who answered
  the fourteenth question and closed the tab never clicked Continue, so the
  stored position was still a core index, and the bonus round opened on its
  last question. Found by driving exactly that path in a browser.
- A waived question can't be answered even with its id: `finalizeDiagnosticAttempt`
  refuses it, and its update is conditioned on `waivedAt: null` too.
- Copy everywhere now says 14 questions / about 15 minutes; the "Finish your
  Diagnostic" email counts against the fourteen and says "Your bonus round is
  waiting" when that's where the student stopped.
- Deploying needs migration `20261024180224_staged_diagnostic` on Neon first.

## Session runner layout (2026-10-24)

The runner's column used to be `max-w-3xl` for every question — on a wide
monitor a passage and its question shared a third of the screen at ~350px
each. **Width now follows the content, like Bluebook's two module types**:
a passage question uses `max-w-screen-2xl` split in half; a single-column
question stays `max-w-4xl`, because one line stretched across a monitor is
harder to read. The footer (question pill, Back/Next) was **below the fold
on every laptop**: the runner was `min-h-screen` under the focus bar, and the
split pane was sized `100vh − 13rem` against ~19.5rem of real chrome. Now the
focus shell's `<main>` is a flex column, the runner is `flex-1`, the pane is
`100dvh − 20rem`, and the footer is `sticky bottom-0` — measured zero overflow
at 1920×1080, 1440×900 and 1366×768. Answer-choice buttons carry
`data-answer-choice` as the e2e hook (their accessible name is the choice
text, and `aria-pressed` also matches Mark for Review and the cross-outs).

**`devIndicators: false`** in `next.config.ts`: every corner of the screen
now holds a real control (sidebar Log out, the runner's pinned Next, the
focus bar's Exit and Log out), and the badge intercepted e2e clicks in two of
them. Next still raises its error overlay with the badge off.

## 1v1 Rush, game feel (2026-10-24)

- **Rush rendered `questionText` only**, never `passageText`, so every
  Reading & Writing question in a rush showed its stem with no text to answer
  from. `RushQuestion` now shows the passage beside the question (stacked on a
  phone).
- **Choosing no longer submits.** A choice is a draft until Submit; A–D (or
  1–4) and Enter do it in two keystrokes. When the clock runs out, the runners
  submit whatever is selected. No double-click-to-submit, deliberately — a
  habitual double-clicker would lock answers in by accident, which is the
  exact problem being removed.
- **Answer streaks score**: from the second correct, in-time answer in a row,
  +20 per step up to +100 (`streakBonus`, `scoreRushAnswerWithStreak`). A
  friend challenge is two runs played days apart, so **the rules are stored
  per challenge** (`RushChallenge.scoringVersion`, DB default 1 for the same
  deploy-window reason as the Diagnostic's format) and both players are always
  scored by the same ones. `maxRushScore(version, size)` replaces the fixed
  `RUSH_MAX_SCORE` on the results page (2700 under version 2).
- **`src/app/(app)/rush/game-fx.tsx`**: synthesized Web Audio effects (no
  files) with a per-device mute toggle on every Rush screen, read through
  `useSyncExternalStore` so a stored "off" can't cause a hydration mismatch;
  the gold streak flame (`achievement` is the token reserved for this);
  the floating points breakdown; a 3-2-1-GO before a recorded run's first
  question; ticks in the last five seconds; confetti and a fanfare for a win.
  All motion is behind `motion-safe:` and the confetti doesn't run under
  reduced motion. Results now say Victory / Defeat / Dead heat, with each
  player's best streak and fastest correct answer.
- Deploying needs migration `20261024190204_rush_scoring_version` on Neon
  first.


## 1v1 Rush: weekly school leaderboard and rematch (2026-10-24)

**Leaderboard** (`src/lib/rush/leaderboard.ts`, hub panel
`rush/leaderboard-panel.tsx`):

- **It ranks each student's best single rush this week, never their total.**
  A total rewards volume, and Rush volume can be bought by guessing: clicking
  A–D at random as fast as possible earns ~490 points in half a minute (a
  quarter right, each with nearly the full speed bonus), which outpaces
  honest work. Ten guessed questions almost never beat a real run, so a best
  score can't be farmed — and it still brings students back to beat their
  own mark. Don't switch this to a sum without solving that first.
- The week is Monday 00:00 → Monday 00:00 **Central** (`LEADERBOARD_TIME_ZONE`);
  a UTC week would reset on Sunday at 7pm in Texas. `weekBounds` is pure and
  tested on Sunday night, Monday 12:01am, and a week the clocks change in
  (which is an hour longer).
- Scope is ACTIVE `StudentMembership` at the school, like every school figure;
  an administrator can view their school's board and never appears on it.
  Solo runs count.
- **Privacy**: first name and class year only. `User.rushLeaderboardHidden`
  (Settings → Leaderboard) hides a student from everyone else while they
  still see where they'd stand. Ranks are computed among visible students
  only, so a hidden student never leaves a gap that reveals them.
  `Organization.rushLeaderboardEnabled` (Owner → school detail) turns it off
  for a school, or for a whole district — a school shows a board only if it
  and its district both allow it. It exists for the district whose data
  agreement doesn't permit students seeing each other's names and scores.
- The results page tells a student their place this week after every run.

**Rematch** (`src/lib/rush/rematch.ts`, results `rematch-panel.tsx`, hub
`rematch-invites.tsx`):

- A rematch is a new FRIEND challenge between the same two students, same
  section and same style (live or recorded), on fresh questions, with
  `rematchOfId` (the match it rematches) and `invitedStudentId` (the one
  student who may join — enforced in `joinLiveRoom` and `joinChallenge` too,
  since a typed code reaches both).
- **`rematchOfId` is unique, and that is the race handling.** Two players
  pressing Rematch at once: the second insert fails on the constraint and
  that player joins the first's room. The violation is caught *outside* the
  transaction — Postgres aborts a transaction on any unique violation, which
  is also why `createChallenge`'s retry-on-code-collision can't actually
  recover inside one (harmless at one-in-a-billion odds; not worth a
  savepoint).
- No push notifications exist, so the invitation shows on the results page
  (it polls every 3s and pings when one arrives) and on the hub. A live
  invitation only shows while its sender is still in the room; a stale room
  is cleared when the other player asks for their own rematch.
- Asking is Premium; accepting is free, matching the rest of Rush.
  `requestRematchAction` skips the paid check when the student is in fact
  accepting the opponent's request.
- Verified in two real browsers end to end: a live match, Rematch, the
  invitation arriving on the other player's results page by polling and on
  their hub, Accept, both in the same countdown.
- Deploying needs migration `20261024202658_rush_leaderboard_and_rematch` on
  Neon first. It was generated with `prisma migrate diff` and applied with
  `migrate deploy`, because `migrate dev` refuses to run non-interactively
  when it wants to confirm a new unique constraint (here on an all-null
  column, so the warning was moot).

## School-email access: the promise, the confirmation, the Premium moment (2026-10-24)

The Owner asked for one line on every sign-up and log-in surface: if your
school or district provides PrepHub, use your school email and Premium is
free, automatically. Making that line true took more than the line.

- **The line** is `src/components/school-access-note.tsx`, on `/signup`,
  `/login` and under the landing hero (static, so `/` stays prerendered — no
  price in it, per the landing rule). `/pricing` carries a "Connect school
  email" link to PRD-002's `/access/verify-school` for a student who signed
  up with a personal address.
- **Google sign-in enrolls on its own** (`emailVerified` is set on every
  Google sign-in by `events.signIn` in `src/auth.ts` — Auth.js itself never
  sets it for OAuth, which until 2026-10-26 meant it was null for every one of
  160 Google students in production; see "Platform audit" below).
  **A password signup does not**: it has only *typed* the address, and
  enrolling on that would let anyone claim a district seat. Such an account
  is sent one link to its own address (`src/lib/district/email-verification.ts`,
  `EmailVerificationToken`, hashed, a week long) — only when a district would
  actually act on it, decided by `ensureDistrictMembership` returning
  `NEEDS_EMAIL_VERIFICATION`, so an ordinary signup never gets the email.
- **`/verify-email/[token]` confirms on a button press, never on page view.**
  School mail systems (Defender Safe Links, Google) open every link in an
  inbox to scan it; if opening confirmed, a scanner would confirm an address
  for whoever typed it into a signup form. It works signed out (the school
  inbox is often a phone that has never signed in), offers a fresh link from
  an expired one (sent to the same address, never one the visitor gives), and
  is idempotent.
- `findDistrictMatch` (`lib/district/enrollment.ts`) is the one read of what a
  district says about an address: roster first (it names the campus), then
  the domain, ignoring archived campuses. `ensureDistrictMembership` checks
  `emailVerified` **before** the campus question, so an unverified
  multi-campus student is asked to confirm first and the confirm page asks the
  campus in the same step; a verified one picks at `/access/campus`.
- **The district bar** (`src/components/district-bar.tsx`) is the top strip of
  the app shell for a student one step from their school's access: confirm
  your email (with Resend), pick your campus, or "your school uses PrepHub but
  you're not on its list". It replaces the launch-pricing strip, and the
  sidebar Upgrade row is hidden for the first two — selling someone what
  their school pays for is the mistake it exists to prevent. It replaced
  `/home`'s old claim banner, which keyed on `isDistrictCandidateEmail` —
  true for *every* address once any roster exists, so the moment a district
  uploaded one, every password student would have been told their school
  provides PrepHub. That function is a cheap pre-check, never a verdict.
- **PRD-002's `/access/verify-school` now honours roster-only mode.** It used
  to check only the domain, which made "verify a school email" a way around
  a district's own list. It also uses the roster's campus and graduation year
  instead of asking.
- **The celebration** (`src/components/premium-unlocked.tsx`): the annual
  price struck through by hand, FREE stamped beside it, confetti — once per
  student, driven by `StudentMembership.celebratedAt` (backfilled to
  `activatedAt` for every membership that existed, so nobody already covered
  saw it out of the blue). Shown from the app layout only while the
  entitlement is genuinely live, never on a focus-mode route, and closing it
  records the date. The displayed price comes from
  `src/lib/billing/display.ts`, shared with `/pricing` so the two can't
  disagree. Keyframes `premium-strike`/`premium-stamp` are the one
  animation outside Rush; the confetti is `src/components/confetti.tsx`,
  shared with a Rush win. Because a student sees it once, `/preview/premium`
  (Owner and Administrators, linked from Admin Overview) replays it with a
  sample student's name and writes nothing — it's what a district is shown.
- **Reserved addresses never reach the mail provider.** `sendEmail` and
  `sendBulkEmail` drop `example.com/.net/.org` and `.test/.example/.invalid/
  .localhost` on the Resend path and report them handled (so the email queue
  doesn't retry them); the dev outbox still records them for e2e.
- Verified in a real browser: password signup on a partner domain → bar →
  Resend → link → confirm → `/home` → celebration → dismissed, gone on
  reload; the same link confirmed signed-out on a phone, then the
  celebration on the original device's next page; an ordinary signup gets
  neither bar nor email.

## Community goal with a prize (2026-10-24)

A school's goal can now be won. `Organization.communityGoalPrize`,
`communityGoalStartsAt` (counting starts here, so "5,000 questions" means
from today), `communityGoalEndsAt` (end of that day, Central — the same zone
as the Rush leaderboard) and `communityGoalReachedAt`.

- `src/lib/community/goal.ts`: `goalStatus` (pure, tested), `saveCommunityGoal`
  and `parseGoalForm`, shared by the Owner's school page and the
  **Administrator's own `/admin/goal`** — the school gives the prize, so it
  names it. Changing what's counted or the target starts a new race (count
  restarts, any win cleared); changing only the prize or deadline keeps the
  progress. A goal set before windows existed (`startsAt` null) still counts
  all-time.
- Progress inside a window comes from the same `student-activity` fragments
  as every school figure (with an upper bound at the deadline). **Reached is
  sticky**: the first time a render sees it reached, `communityGoalReachedAt`
  is written (guarded on the goal still being that goal), and the win
  survives the deadline.
- Students see it as the lead block on School Community
  (`src/components/community/goal-card.tsx`). Still aggregate-only: nothing
  on either page can name a student.

## Teachers, classes and homework (2026-10-24)

A `TEACHER` role, added by the Owner or by a school's Administrator (never
by signup), at one school (`TeacherAssignment`). Teachers make classes,
students join with a code, and teachers assign a fixed list of published
questions as homework with a due date. `src/lib/teacher/`,
`src/app/(app)/teacher/`, student side `src/app/(app)/homework/` and
`/join/[code]`.

- **Who sees what is the design.** A teacher sees results on the homework
  *they* assigned — status, score, which questions each student missed — and
  nothing else from a student's account: no predicted score, no practice.
  The join screen says exactly that before a student joins. An
  Administrator's Teachers page shows counts (classes, students) and never a
  result. This is the one place an adult sees an individual student's
  answers; don't widen it without the Owner.
- **Accounts**: `inviteTeacher` creates the account with no password and
  emails a set-password link (a week-long `PasswordResetToken`, landing on the
  existing `/reset-password` page) — the person adding a teacher never holds
  their credentials. Google sign-in with that address works too. A teacher
  has no student experience; `/home` sends them to `/teacher`. Removing one
  ends their access and archives their classes there; nothing is deleted, and
  adding them back restores access.
- **Classes**: six-character codes from an alphabet with no look-alikes
  (`join-code.ts`, tested). `/join/<code>` signed out goes to signup with the
  code in the `prephub_class_join` cookie (middleware, same hand-off as a
  Rush link) and `/home` brings them back. **Joining is a button press**, so a
  link previewed in a chat app never puts someone on a roster. The Homework
  nav item appears only for a student in at least one class (one indexed
  query in the layout); anyone can join from Settings → Classes.
- **Homework** is shaped exactly like the 800 Club: `AssignmentQuestion` pins
  each question's published revision at assignment time (an Owner edit never
  changes what a class was given); a student's `HomeworkSession` gets one
  `HomeworkSlot` per question when they start, unique per (assignment,
  student); answers finalize idempotently in a transaction; the shared
  `SessionRunner` drives it (`/homework/session/` is a focus-mode prefix).
  **Outside the adaptive engine** like every mode after it, and **never behind
  the paywall** — a class where half the students can't open the homework
  isn't a class. Homework is the seventh table in
  `lib/school/student-activity.ts`, so it counts toward school totals and
  goals.
- Closing stops new starts *and* new answers, including students partway
  through; deleting is only allowed before anyone starts. Due dates are the
  end of that day, Central; late work is accepted and marked late.
- Confirmations for every access-changing action go through
  `src/components/confirm-button.tsx`, which requires a description of
  effect, timing and reversibility.
- Verified in a real browser end to end: admin adds a teacher → invite email
  → set password → class → builder (filters, answer-key preview, add at
  random) → assign → a student joins by link → does it with scratch work and
  a highlight → turns it in → the teacher's results and class page.

## Scratch work and annotation (2026-10-24)

- **Scratch work** (`src/components/session/scratchpad.tsx`): a draggable,
  resizable whiteboard over the question, one page per question, in the
  session runner, every Rush runner and the Daily Challenge. Strokes are
  stored as points (not pixels), so the board redraws at any size and its
  ink follows the theme; the eraser is `destination-out`, so the dot grid
  (CSS, not canvas) survives it.
- **Annotate** (`annotator.tsx`): select text in the passage or question for a
  three-colour highlighter and notes; click a highlight to recolour, note or
  remove it; notes list under the question. Painted with the **CSS Custom
  Highlight API** — no `<mark>` elements, which React would wipe and which
  would split KaTeX's spans. Highlights are character offsets into each
  root's text.
- Both live in **localStorage only** (`local-store.ts`), like scrap paper:
  nobody else needs them, and a request per pen stroke would be absurd. Every
  access is wrapped (school Chromebooks may disable storage) and entries over
  a month old are swept.
- **Gotcha, confirmed in the dev server: Lightning CSS (Next's CSS pipeline)
  rejects `::highlight()`.** With those rules in `globals.css` every compile
  warned, and that dev server went on to 404 every nested dynamic route —
  `/owner/schools/[id]` included — until restarted with the rules moved out.
  The highlight colours are a `<style>` element the annotator renders. The
  annotator also mounts only after hydration (`useSyncExternalStore`, as in
  the theme toggle), because saved highlights exist only in the browser.

## Demonstration district (2026-10-24)

`scripts/demo-district.ts` builds "PrepHub Demo ISD" / "PrepHub Demo High
School" for showing a district the administrator's view: ~210 fictional
students with Diagnostics, Practice Sets and predictions that move
believably, four fictional teachers with classes and homework, a community
goal with a prize, two announcements, and a School Administrator account for
an email given on the command line (`--admin=`; sign in with Google). `check`
reports and writes nothing; `create` refuses if the demo exists or the email
belongs to a non-administrator; `remove` deletes every demo row.

It is built to sit inside production without touching anything real: all
fictional addresses are on `demo-isd.example.com` (undeliverable, and
excluded from analytics and lifecycle mail), no partner domain and **no
roster rows** (a roster's existence makes every signup pay for an eligibility
lookup), hidden from the directory, no Rush or Daily Challenge rows, and no
usable password on any fictional account. Its answer rows reference real
published questions, which is harmless because nothing reports per-question
statistics — and `remove` takes them with it. It creates no `CategoryState`
rows, so a fictional student's Practice gateway shows "couldn't prepare your
next practice set" if anyone signs in as one locally; nobody can in
production, so it was left alone.

`teacher --teacher=<email>` gives a real account the teacher's view: it takes
over fictional Maria Alvarez's two classes (her seat's assignment is ended,
the classes move to the real account) and is recorded in the district's
`internalNotes` so `remove` knows what to undo. An existing student account
needs `--convert-student` and is refused if it has a school membership, class
enrollments or an active subscription; `remove` turns a converted account
back into a student rather than deleting it. In production since 2026-10-25:
prithviraj.chauhan@utexas.edu (converted from an unused student account;
signs in with Google).

## Scale readiness for 20,000 students (2026-10-25)

The Owner asked whether PrepHub could carry 20,000 students and, on mobile,
work as well as on desktop. Everything that needed the Owner's accounts,
plans or decisions is in `Downloads\PrepHub\OWNER-TODO-SCALE.md`; the code
side is below. A WebKit sweep at iPhone 13 size over ~40 screens found no
page that scrolls sideways.

- **Connection pool** (`src/lib/prisma.ts`): `max` 5 per instance in
  production (pg's default 10 multiplied by dozens of serverless instances
  against the *direct* endpoint), a 10s connect timeout instead of waiting
  forever, `DATABASE_POOL_MAX` to override. pg's timeout wording is in the
  connectivity-failure log patterns.
- **Media** (`src/lib/content/media-response.ts`, both media routes): videos,
  and any file over 4MB, redirect to a signed R2 URL — R2 answers byte
  ranges (Safari won't play a video without a 206) and the file never passes
  through a function (Netlify refuses responses over ~6MB). URLs are signed
  as of the start of the hour for two hours, so they're identical within an
  hour and the browser can cache them; the redirect's own cache never
  outlives the URL. Small images are still proxied, now with `immutable`
  caching (a media id's file never changes) and Range support, which is also
  how local disk serves video. Uploads now store their `ContentType` in R2;
  older objects carry R2's generic default, which `<img>` ignores — and
  there were no uploaded videos in production when this shipped. **Not
  fixed: uploading a video over ~6MB through the CMS fails on Netlify**
  (server-action bodies cap at 12MB here and Netlify's request cap is lower).
  The fix is a browser-to-R2 presigned upload, which needs a CORS rule on the
  bucket from the Owner.
- **Lifecycle email is queued** (`src/lib/lifecycle/emails.ts`): nudges and
  daily reminders page through students 1,000 at a time, and each page's
  `EmailSend` claims (`createManyAndReturn` + `skipDuplicates` — only claims
  this run won come back) and `QueuedEmail` rows are written in one
  transaction. They used to be sent one call at a time and capped at 200/500
  a day. `sendEmailBatch` (`src/lib/email.ts`) sends a hundred *different*
  messages per Resend call, so the queue now sends each claimed batch as one
  call whatever the subjects; the scheduled drain's row limit is 5,000 so its
  20-second budget is what stops it. "Studied today" is
  `studentsActiveSince` (all seven answer tables), and "paid" is
  `decidePaidAccess` — a district-covered student used to be pointed at the
  free Daily Challenge.
- **Gotcha, found by running it: the local embedded Postgres is WIN1252, not
  UTF-8.** A queued body containing "→" failed to insert locally (production
  Neon is UTF8 and would have been fine). Copy that is *stored* — queued
  email bodies — should stay within characters WIN1252 has, or local dev and
  e2e break while production works.
- **Rate limits** (`src/lib/rate-limit.ts`): with `UPSTASH_REDIS_REST_URL` /
  `_TOKEN` set, counts live in Upstash Redis (one fixed-window `INCR` +
  `PEXPIRE` pipeline, keys SHA-256-hashed so no email or IP is stored
  readable, 1.5s timeout, falls back to the per-instance Map and logs).
  `checkRateLimitEnforced` is now async. Shared counts make the numbers real,
  so `LOGIN_PER_IP` went to 1,500/5min (a 2,000-student campus at the first
  bell), and a signup on a partner district's domain uses
  `ACCOUNT_CREATION_PER_IP_PARTNER` (3,000/hr) — the partner-domain set is
  already cached in memory, so choosing the bucket costs no query.
- **Shared cache** (`src/lib/shared-cache.ts`'s `cacheAcrossRequests`):
  `unstable_cache`, because `use cache` needs the app-wide Cache Components
  mode in this Next version. JSON round-trip, so numbers and strings only; it
  falls back to a plain call outside a Next request (tests, scripts). Used
  for `getSchoolAggregateStats` (60s), community goal progress (60s, keyed on
  the goal's own window as ISO strings so "now" doesn't defeat the key) and
  *last* week's Rush leaderboard (1h). This week's board is deliberately not
  cached: the results page tells a student their new place right after a run.
- **Live Rush polling** (`live-rush.tsx`'s `pollDelay`): one second while the
  room could change under the player, `LIVE_IDLE_POLL_MS` (2s) while a
  question is open and only this player's answer is outstanding, 3s in the
  lobby, and an immediate poll after submitting. Verified with two browsers
  over a full ten-question match: 3 server calls in 8 seconds while an answer
  was due, against ~8 before. **Fixed while there:** a poll that *threw* left
  `next` null, which means "no room", so one dropped request on a school
  network sent the player to the hub mid-match. The rematch panel's polling
  now slows to 15s in a background tab and stops after 15 minutes (a results
  tab left open used to poll every 3s indefinitely).
- **Phones**: an unlayered rule in `globals.css` sets text fields to at least
  16px below 768px — iPhone Safari zooms into anything smaller, and the 15px
  base made that every field. The admin Student Directory renders a stacked
  list below `sm` (the table's engagement columns were off-screen), sharing
  one edit form with the table rows; e2e's graduation-year assertion is
  scoped to the row because the hidden list carries the year too. The teacher
  results table drops its finish-date column and min-width on phones. Small
  in-session controls got bigger hit areas without changing their look:
  `-my-2 py-2` for "Mark for Review" and Exit, an `after:-inset-2` overlay
  for the bordered timer "Hide" pill.
- **`/api/health`**: 200 when a `SELECT 1` answers within 5s, 503 otherwise —
  for the Owner's uptime monitor. Public, says nothing beyond ok and a
  database round-trip time, never cached.
- **Load test** (`scripts/load-test/`): `seed.ts` creates a fictional school
  and N students on `loadtest.example.com` (refuses the production database
  host from `.env.neon`; the password is an argument, never committed), and
  `run.mjs` signs them all in at once through Auth.js's credentials
  endpoint, loads the student and admin pages at a chosen concurrency, and
  drives real browsers through Diagnostic answers (server actions can't be
  called from a plain HTTP client). It refuses prephubtp.com. Meant for a
  deploy preview pointed at a Neon branch; locally against `next start` with
  60 students and 30 concurrent, pages had a median around 1s on one process.

## The staff experience: administrators and teachers (2026-10-25)

The Owner's brief: the admin pages were "barebones", and the people using
them may be sixty — the area has to be easy to see, easy to use and easy to
learn, without being over the top. The teacher side is just as important.

- **One kit**: `src/components/staff/staff-ui.tsx` — `StaffPage`,
  `StaffHeader` (the `surface-tint` hero band, with an optional back link),
  `StaffSection`, `StatStrip` (rules inside one box, `gap-px bg-border`),
  `StaffSteps` (`01`/`02` ordinals and the word "Done", never a check alone),
  `StaffField` (a visible label above every input — no placeholder-only
  fields), `StatusChip` (tints with `dark:` variants, always a word). Every
  admin and teacher page is built from it, so they can't drift apart.
- **Bigger by default**: body copy is `text-base`/`text-lg`, and staff
  controls use the new `size="xl"` button (`h-11 text-base`); inputs are
  `h-11 text-base md:text-base`. **Gotcha**: the `Input` base class carries
  `md:text-sm`, which beats a plain `text-base` from 768px up — the
  `md:text-base` is not redundant.
- **An administrator signs in to `/admin`.** `/home` redirects a School
  Administrator there unless `?view=student`. The sidebar is "Your school"
  (Overview, Students, Teachers, Announcements, Community goal, Access &
  support, Account) and then a collapsible "Student experience" (`<details>`,
  open whenever one of its pages is the current one) whose first item,
  "Student dashboard", is `/home?view=student`. Nav matching ignores the
  query string.
- **Overview**: a four-step "Getting started" list (`getAdminSetupProgress`)
  that disappears once done, then four figures. Its student counts come from
  `getStudentDirectorySummary`, the same function as the Students page's
  summary, so the two pages can't disagree (they did, briefly, by 24
  students). Score growth and the TSI readiness bar follow; "Fell back" is
  `destructive`, because amber beside the gold "Crossed" read as the same.
- **Students**: four summary cells (signed up / active this week / haven't
  started / gone quiet — 7 and 14 days, via `studentsActiveSince`) that are
  links to the matching filter. An activity filter narrows the candidate ids
  *before* paging, so page 2 of "haven't started" is still all
  haven't-started. **Download as a spreadsheet** is
  `/admin/students/export` (a route handler, `private, no-store`): the same
  engagement-only columns as the page, CSV with a BOM and CRLF so Excel opens
  it cleanly, and any cell starting with `= + - @` or a tab is prefixed with
  `'` so a student's name can't become a spreadsheet formula
  (`student-export.ts`, tested).
- **Announcements**: "Preview before sending" shows both places it lands —
  the home-page banner and the email, subject included — and the send button
  names the count ("Send to 212 students") above a line that it can't be
  unsent. Remove goes through `ConfirmButton`.
- **Community goal**: four numbered questions ("1. What should the school
  count?" …) beside a live "What students see" card; the shared
  `GoalEditor` is the same on the Owner's school page.
- **Access & support** names `schools@prephubtp.com`
  (`SCHOOLS_CONTACT_EMAIL`); it used to say `support@prephub.app`, a domain
  PrepHub never had. No reply-time promise is made on the Owner's behalf.
- **Teachers**: class cards say what's due next and how many are done; a
  class page has a gradebook (students down, homework across, score where
  they meet, "Started"/"Missing" chips, names pinned while it scrolls
  sideways — `ClassroomDetail.submissions`); an assignment's results lead
  with finished / started / not started / class average.
- **The annotate tip** (`session-runner.tsx`): a one-line `surface-tint` row
  under the toolbar — "Tip: select any words in the passage or the question
  to highlight them or add a note." — until the student presses "Got it" or
  makes their first highlight (`hasSeenTip`/`markTipSeen` in
  `local-store.ts`, per browser). The server snapshot says "seen", so it never
  flashes on load. It shows in every `SessionRunner`, so a new student meets
  it on the Diagnostic's first question.
- **Rush music** (`src/app/(app)/rush/rush-music.ts`): an original
  synthesized loop — I–V–vi–IV at 128 BPM, 144 with doubled hi-hats in a
  question's last ten seconds — playing only while questions are on screen,
  never in a lobby or on results. A "Music" switch (labelled in words) sits
  beside the sound toggle on every Rush screen; muting all sound stops it
  too. Everything Rush plays goes through one shared `AudioContext` and a
  limiter (`game-fx.tsx`'s `audio()`), and the levels were measured offline,
  not guessed: music peaks ~0.23, effects 0.36–0.43. Keep the music under the
  effects. The "wrong" sound is two notes because the old single low sweep
  came out at 0.16 through the limiter — inaudible next to the music.
- Verified in a real browser: admin landing and nav, CSV download (212 rows),
  the "haven't started" filter, the music switch (about 21 notes every two
  seconds while on, none while off), the tip, the gradebook; and the admin,
  community, Owner-schools e2e specs.

## Platform audit (2026-10-26)

The Owner asked for a sweep of the whole platform: infrastructure and
performance, and anything hurting the student, admin or teacher experience.
Five read-only reviews (infrastructure, students, admins, teachers,
security), a read-only look at production, then fixes. What changed, and the
rules that keep each one from coming back:

**Security and data integrity**

- **Every draft save goes through `sanitizeDraftPatch`**
  (`src/lib/session/draft.ts`). The runners autosave through server actions
  taking a `patch` object, and a server action's argument is whatever the
  browser sends — its TypeScript type is never checked at runtime. Five
  actions passed it straight to Prisma as `data`, so a hand-made call could
  set `isCorrect`/`submittedAt`/`answer` (a forged Diagnostic score or
  homework grade) or move a practice slot into another student's set. A new
  runner mode must use it, and its write is `updateMany` guarded on the row
  still being open.
- **Answer keys wait for the answer.** Every `load*QuestionDetailAction`
  returns `feedback: null` until that question is answered or its session is
  finished (the Diagnostic: until it's complete). They used to hand back the
  correct choice for any slot the student owned.
- **The login rate limit lives in the Credentials `authorize`** (`src/auth.ts`),
  not in `loginAction`: Auth.js also serves `POST /api/auth/callback/credentials`,
  which reached `authorize` with no limit at all. `LoginRateLimited` (a
  `CredentialsSignin` subclass, which Auth.js passes through untouched) is how
  the form still says "slow down" rather than "wrong password".
- **Google sign-in and `emailVerified`**: Auth.js never sets it for OAuth, so
  it was null for every Google account in production — 160 students — and
  district enrollment, which acts only on a verified address, would have
  asked every Google student on a partner domain to confirm an address Google
  had already confirmed. `events.signIn` now sets it on each Google sign-in.
  `events.linkAccount`: when Google links to an existing account whose address
  was never confirmed and that has a password, the password is dropped and
  every session ended — a password signup proves nothing about the address,
  so anyone could have registered it first and waited for its owner.
  "Forgot password" restores one through the owner's own inbox.
- **Reset links are single-use under concurrency** (claimed with
  `updateMany … usedAt: null`), retire the account's other outstanding links
  (including a teacher invitation), and mark the address verified — the link
  arrived at it. The page says "Set your password", which reads right for a
  reset and for a teacher's first visit, and an expired link offers a new one.
- **Billing**: `createCheckoutSession` refuses anyone `hasPaidAccess` already
  covers (a second checkout was a second subscription the app couldn't see or
  cancel), never passes a comp's `manual_comp_…` id to Stripe, and puts
  `userId` in the subscription's metadata. `syncSubscriptionFromStripe` falls
  back to that metadata, **throws (→ webhook 500 → Stripe retries) for a live
  subscription it can't attribute** instead of returning silently, and won't
  let a different, ended subscription overwrite the live one. The
  `updated`/`deleted` handler re-fetches the subscription, because Stripe
  delivers out of order; `checkout.session.async_payment_succeeded` is
  handled.
- **Account deletion** (`deleteAccount`): Google-only accounts type DELETE
  (`src/lib/auth/delete-confirmation.ts`) instead of deleting on one click;
  the school membership is removed with a history event and its unique school
  address tombstoned (it kept "Deleted User" in school figures and blocked
  the student's own re-registration); class enrollments end; a teacher's
  classes are archived and staff assignments ended; then the Stripe
  subscription is cancelled (best-effort, after the transaction, logged on
  failure). Before this, a deleted account was billed forever.
- **School-email verification requires `role === "STUDENT"`**: a staff
  account with a membership would be counted in its school's figures.
- **Rush**: a recorded answer is claimed with `updateMany … answeredAt: null`
  and the loser replayed (four simultaneous A–D submits used to score the
  right one and count duplicates). `startRandomRush` finds a waiting
  challenge with `GROUP BY … HAVING COUNT(*) = 1`. The old "oldest twenty,
  then filter" stopped matching anyone once twenty finished matches existed.
- Cron routes compare the bearer secret in constant time
  (`src/lib/cron-auth.ts`); Settings caps a first name at 100 like signup.

**Email**

- **Daily reminders taper** (`reminderDue`, tested): daily while a student has
  studied in the last week, weekly after that, nothing after 30 days. It was
  every day for as long as the toggle was on: ~70 emails a day in October,
  and 162 of the 194 students with reminders on hadn't studied in two weeks.
  Mail nobody opens gets a domain filtered, and this domain carries password
  resets and school announcements too.
- **One-click unsubscribe** in every reminder: `/unsubscribe/<token>`, an
  HMAC of the account id under `AUTH_SECRET` (`src/lib/lifecycle/unsubscribe.ts`,
  no table, never expires), turned off on a button press — never on page view,
  for the same mail-scanner reason as `/verify-email`. Works signed out. No
  link is generated without a secret. A `List-Unsubscribe` header would need
  a column on `QueuedEmail`, so it isn't there yet.
- The **Diagnostic results email is queued** (claim + queue row in one
  transaction, then a request drain). Sent directly, a provider error after
  the claim lost it for good.
- **The daily cron** (`/api/cron/daily`) runs each job in its own try/catch
  (a failed graduation sweep no longer means no reminders), stops the
  lifecycle pass at an 18s budget, and answers 500 if any job failed.
  `netlify/functions/daily-cron.mts` fires at 22:00, 22:10 and 22:20 UTC, so
  a district too big for one run finishes in the next; the day's claims make
  reruns free. A third job, `purgeExpiredMail` (`src/lib/retention.ts`),
  deletes sent queue rows after 30 days and daily-reminder claims after 90.
  Every email used to keep its body and address forever. Once-per-account
  claims are kept for good; analytics events are left alone.

**Students**

- **Error, not-found and loading pages exist** (`(app)/error.tsx`,
  `(app)/not-found.tsx`, `(app)/loading.tsx`, `not-found.tsx`,
  `global-error.tsx`). There were none, so any thrown error was Next's bare
  white "Application error". Error pages in this Next version receive `retry`
  (not `reset`); server errors arrive with a generic message and a `digest`,
  which the page shows as a reference. A stale-build error offers a reload.
- **The runner never freezes**: every action call is caught, the flag reset,
  and a message with Try again (or Reload, for `isStaleServerActionError`)
  shown in the footer. Draft saves are debounced (500ms, latest wins, flushed
  before navigating). Actions return **`SessionBlocked`**
  (`src/lib/session/blocked.ts`) instead of throwing when the student must be
  told something (homework closed, Premium lapsed, Diagnostic finished
  elsewhere), because production replaces a thrown message with a generic
  one. Review rows on every results page use `useQuestionReview`/`ReviewDetail`
  from `session-results.tsx`, which retry instead of sitting on "Loading…".
- **Diagnostic results count only questions the student saw**: waived bonus
  questions are left out of the total, accuracy, time and review list (they
  still score as misses). It used to say "8/21" and list seven unseen Hard
  questions as Incorrect.
- **Completion is claimed, not checked** (`updateMany` on the open status) and
  prediction generation locks its source row, so a double submit can't
  double-count. A results page whose prediction step failed generates it
  instead of crashing on every visit. `finalizeAnswer` locks the category's
  `CategoryState` row, so two answers at once can't lose an ability update.
- Answer feedback carries words ("Your answer", "Correct answer"), and the
  result line is a live region that takes focus.
- **Any action that creates a membership calls `revalidatePath("/", "layout")`**
  before redirecting (school-email verification and the campus pick now do,
  as onboarding already did). A layout doesn't re-render on navigation, so a
  student whose school had just started covering them kept seeing "Upgrade ·
  50% off" in the sidebar until a full reload. Found by the e2e suite, which
  now asserts the Upgrade row is gone; with the shell refreshed, the Premium
  celebration opens on the success page itself.
- **Dashboard and Progress figures count all seven study modes** (one query
  over `answerActivity`) and study days are **Central**, like goals and the
  leaderboard; `streakFromDays` moved to `src/lib/dashboard/study-streak.ts`
  and the Daily Challenge (still UTC days, by design) imports it. The Daily
  Challenge answer action returns `rolled_over` instead of throwing when the
  day changes under a student.

**Administrators and the Owner's school tools**

- **An announcement's end date is the end of that day, Central**
  (`endOfLocalDay` in the new pure `src/lib/community/local-day.ts`, which
  `goal.ts` re-exports). `z.coerce.date()` had read it as midnight UTC, 7pm
  Central the evening before, so "today" published an already-expired banner
  and still emailed everyone. Dates are displayed in Central too.
- **What an admin is told about access comes from the paying organization**
  (`schoolAccessState` in `src/lib/admin/access-info.ts`, tested to agree
  with `hasActiveSchoolEntitlement`): the district when there is one, and
  "Ended" once the end date passes whatever `status` says. Campus rows copy
  the district's dates once and drift; no admin page reads them any more.
  Roster invitations use the same check.
- **Small-group privacy on the Overview** (PRD-011 §21): score growth and
  readiness are withheld until 10 students can be measured
  (`MIN_STUDENTS_FOR_SCORE_FIGURES`), any group of 1–4 shows as "Fewer than
  5", and "Biggest gain" waits for the same threshold. `getCampusImpact`
  returns the protected report; `measureCampusImpact` (raw) is read only by
  tests. Not done: complementary suppression.
- **"Class of" edits** are ACTIVE-only and limited to
  `graduationYearWindow()`; a year that would end access is refused, because
  the graduation sweep would make it permanent.
- Suspend, Archive, Remove administrator, Mark Graduated and Remove
  membership go through `ConfirmButton`. **Roster reminders** go only to
  students last emailed more than `REMINDER_GAP_DAYS` (3) ago, so repeated
  presses finish instead of re-mailing the same people; any membership
  status counts as claimed, and graduated roster rows are skipped.
- Student Directory summary cards link to `status=ACTIVE` lists; `status`
  and `graduationYear` params are validated; the summary is one
  school-scoped "last answered" query (`lastAnsweredAtForSchool`) cached 60s;
  the CSV export reads activity in chunks of 500 (it would have hit
  Postgres's bind-parameter limit at ~5,000 students).
- **Every Owner page calls `requireOwnerPage()`** (`src/lib/owner/guard.ts`)
  itself. Next's own auth guide says a layout check doesn't protect the
  segments under it.
- Not changed, an Owner decision: "all time" totals and score growth count
  ACTIVE students only, so they drop graduates every July 1.

**Teachers and homework**

- Answering the last question turns homework in, dated by that answer, so
  lateness reflects when the work was done. Closed homework, an archived class
  and a removed student all go through one `homeworkBlock()` and reach the
  runner as `SessionBlocked`.
- A student who joined after an assignment's due date (or close) is "Joined
  later", never "Missing" (`src/lib/teacher/deadline.ts`); "of N" figures
  count the current roster only.
- Re-adding a removed teacher reopens exactly the classes the removal
  archived (they share its timestamp).

**Infrastructure**

- `catchUpDistrictEnrollment` remembers, per instance, that an address matched
  no district, keyed to the partner-index load it was checked against. Once
  any roster exists, a free student's every render no longer repeats the
  roster and domain lookups.
- The analytics beacon awaits its write: a serverless function can be frozen
  the moment its response goes out.

**Still open, recorded rather than fixed**: a one-time backfill of
`emailVerified` for existing Google accounts (a production write, offered to
the Owner); thin content (Advanced Math easy 2 published, PSDA easy 3,
Vocabulary hard 3, Geometry easy 4, unchanged since September); practice-set
generation's per-slot queries; KaTeX shipping to every student client;
caching published question content.

## Importing practice tests through Claude (2026-10-26)

The Owner's request: upload a whole practice test (an 80-page PDF) to Claude
instead of the website's bulk upload, because the website's pipeline pays
DeepSeek/Anthropic per token. `scripts/question-import/` does the same job
with Claude reading the pages in a Claude Code session; **its README is the
procedure and the transcription standard**, written from the site's own
prompts (`transcribe.ts`, `classify-category.ts`, `classify-difficulty.ts`,
`determine-answer.ts`, `generate-explanation.ts`) so imported questions match
bulk-uploaded ones.

- `render-pages.mjs` renders every page with pdfjs-dist inside headless
  Chromium at the website's 2.5× scale (pdfjs needs a canvas; Chromium has one,
  so no native package was added). pdfjs 6 takes `getDocument({ url })`, not a
  bare string.
- Claude transcribes into `questions.json` (passage and stem separate, the
  test's answer key cross-checked, figures as 0–1000 boxes); `import.ts`
  validates, finds duplicates already in the bank (passage + stem, so the
  common Reading stems don't collide, and older bulk uploads that kept the
  passage inside the stem still match), crops figures with sharp for review,
  and with `--commit` creates them through `createQuestion` /
  `updateDraftContent` (and `publishQuestion` with `--publish`) as
  AI-generated Drafts, exactly what the website's bulk upload produces. Unlike
  the website, which sees one page at a time and skips any question that
  crosses a page, Claude reads the whole test.
- **Guards**: a non-local `DATABASE_URL` needs `--production`; a production
  batch with figures needs the four `R2_*` variables (the Owner's gitignored
  `.env.r2`, never printed), or images would land on this computer's disk.
  Test PDFs and transcriptions live in `Downloads\PrepHub\Question imports\`,
  never in this public repo. Production imports need the Owner's go-ahead per
  batch.
- **Money is `\$`** (`latex-text.tsx`, tested): `$` is the math delimiter, and
  the renderer used to break any price ("$\$49$" was a KaTeX error; the bank's
  two priced word problems had been rewritten around it). `\$` is now a dollar
  sign in text and in math.
- **Student Preview shows the passage.** The CMS drawer rendered only
  `questionText`, so every question with a separate passage (the field added
  for the two-pane Reading layout) previewed without the text it asks about.
- Verified end to end on a sample PDF: render, transcribe, check, crop (looked
  at), import into the local database, Student Preview of a passage with an
  underline, a graph, and a priced word problem; a re-run reported all five as
  already in the bank. Local imports must stay within WIN1252 (see "Scale
  readiness"): write math as LaTeX (`$-2$`, not a Unicode minus).

## Explanation walkthroughs (2026-10-27)

The Owner saw an interactive step-through in a Claude chat (a trie insertion
with Back / Next, the current line lit, a diagram changing per step) and
asked for that quality on every question's explanation, attached when the
question is uploaded. `src/lib/content/walkthrough.ts` (format, `stateAt`,
passage marking; pure, client-safe), `walkthrough-validate.ts` (the checks,
KaTeX included), `src/components/content/walkthrough/` (the stepper and its
panels), `QuestionRevision.walkthrough` (JSONB, migration
`20261027090000_question_walkthrough`).

- **Data, not generated code.** A walkthrough is panels (the question's own
  passage and choices, working, a plane, a diagram, a number line, a table,
  bars, value chips) plus, per explanation step, what changes on them. It is
  written once at import (by Claude, as part of the transcription, per
  `scripts/question-import/README.md`'s "Walkthroughs") and drawn by the
  site's components: no per-student generation, no model-written code in a
  student's browser, no API cost.
- **The step text is the narration**, so a walkthrough has exactly as many
  steps as the explanation, and `ExplanationSteps` falls back to the plain
  list when it doesn't, or when the stored walkthrough fails validation
  against the revision's current content (checked on every serve in
  `getStudentQuestionFeedback`, logged when it fails). The question editor
  says so to the Owner. "All steps" always offers the list.
- **Highlights are private-use markers** (`passage-marks.ts`) that
  `LatexText` turns into spans, so underlines, math and `\$` money keep
  working inside a highlighted passage. A quote must sit wholly in prose
  (`locateQuote`): never across an `[[underline]]` edge or into math. Money
  counts as prose, which a test caught.
- **SVG figure labels use a small typesetter** (`svg-label.tsx`), not KaTeX
  in a `foreignObject`, which older Safari positions wrongly in scaled SVG.
  Bar colours skip the gold chart token (gold is achievement's); a series can
  take a `shade` to match a source figure the explanation describes.
- **Attaching to questions already live** (`import.ts
  --attach-walkthroughs`) writes the walkthrough onto the live revision in
  place, deliberately: it is presentation of the explanation, never the
  question, and it is validated against exactly that revision's content.
  Editing a question copies it into the new draft with everything else.
- Verified in a real browser: eleven USV1 questions across every panel type,
  narrow / full-screen / dark / phone, the Owner's Student Preview, and a new
  student answering a Daily Challenge (server-validated walkthrough, arrow
  keys, "All steps").
- **Deploying needs migration `20261027090000_question_walkthrough` on Neon
  first.**

### On the question (the same day, second pass)

A review of all 65 steps in the real session runner found the first version
drawn as a separate box below the question: below the fold after Submit,
controls at its top and narration at its bottom (scroll down to read, up to
press Next, every step), the passage and choices drawn a second time, choices
crossed out with no reason, and a number line that drew "distance 38 from 0"
as the solution set of |x| <= 38. The Owner asked for every fix, taking the
better version of each.

- **It runs on the question itself.** A page wraps its question in
  `QuestionWalkthrough` (`walkthrough/context.tsx`) — the runner, the shared
  `QuestionDetail` (results reviews and the Daily Challenge), Student Preview,
  the teacher answer key. `PassageMarks` paints the step's highlights on the
  page's own passage with the CSS Custom Highlight API (the annotator's
  technique, and for its reason: a student's saved highlights are character
  offsets into that text, so nothing may change it), and a filled blank is a
  `data-wt-fill` attribute on the `.latex-blank` element LatexText now wraps
  every blank in, shown through `::after`. Answer choices are the page's own
  rows (`WithChoiceMarks` / `ChoiceNote`). The stage draws only what the
  question doesn't show; a Reading question usually has none. The provider
  is always mounted and switched on at Submit, so the question isn't rebuilt
  under it (that lost pane scroll and the passage pane's width). Without a
  host (the editor's preview, the full-screen dialog) the walkthrough draws
  the passage and choices itself, as before.
- **The dock** (`dock.tsx`) is the narration and Back/Next in one bar, the
  last child of the question's column, `position: sticky` at the bottom —
  over the runner's footer via `--wt-dock-offset`, which the runner writes
  from the footer's height. That is why `SplitPane`'s panes only scroll from
  `md:` up: a stacked pane that was a scroll box without a height trapped the
  sticky dock in a box that never moves.
- **Each step scrolls to what it changed** (`reveal.ts`): every scroll box on
  its own, only as far as needed, all of a step's changes together when they
  fit and by priority (passage, stage, choices) when they don't, never the
  first time it appears. Pinned bars (`data-wt-cover` on the app's top bars
  and the session footer, and the dock) don't count as visible space.
- **The reason a choice is wrong is on the choice.** The student's own wrong
  answer says why straight away, with or without a walkthrough (this
  replaced `DistractorNote`, now deleted); a choice the walkthrough rules out
  shows its distractor explanation on that step, then folds to "Why was this
  ruled out?". `QuestionDetail` now shows A–D letters and the passage, which
  reviews never had.
- **Learning**: `takeaway` (one transferable rule, "Remember", on the last
  step and in "All steps") and `prompts` ("Your turn": a question before a
  step, over the previous step's stage, a hint after a wrong try, "Show me"
  to skip; nothing is recorded). The narration's words are coloured to match
  the highlights they repeat (`markNarration`); highlights must be whole
  words (`onWordBoundaries`); `span` is a number line's distance and
  `interval` its sets. The 11 USV1 walkthroughs carry all of it.
- **Looks**: one stage box with rules between panels, a fading ring on what a
  step changed, highlights that sweep in, label halos on every figure,
  working aligned on its first relation (`splitAtRelation`) with the new line
  on a band and no inner scroll, bars that keep their colour and print their
  value when in focus, "All steps" remembered per browser.
- Verified in a real browser: all 11 in the runner at 1440×900 (light and
  dark, keyboard only) and 390×844, the Daily Challenge (keyboard, a wrong
  try on a prompt), Student Preview and its full-screen view, the editor.

### Third pass (2026-10-28): parts, formula cards, feedback

The Owner paused the bank backfill to get the format right first, since
changing it after ~380 walkthroughs would mean redoing them. Format
additions are optional fields, so every earlier walkthrough still validates.

- **`goals`** names the parts of a solution (2–5, `{ step, label }`):
  drawn over the dock's progress bar (`StepBar`), said in the dock's header
  on a phone, and as `01 · …` headings in "All steps". Labelling the purpose
  of each group of steps is the subgoal-labelling result from worked-example
  research: it's what transfers to a new problem.
- **Formula cards**: a `work` step's `formula: { name, tex }` is drawn as a
  card ("Formula · Volume of a cylinder") before that step's lines, and
  listed under "All steps" as "Formulas used". The Owner's never-skip-the-
  formula rule, made visible.
- **Working never shrinks to unreadable**: a line too wide for its panel
  breaks onto rows at its later `=` signs (`chainRows`), per line, measured
  in a layout effect that only flips `data-broken` attributes (no
  re-render); only then does the font shrink, to 0.85 at least. Aligned
  working is centred on its `=` column, so a formula card can't push the
  columns apart. A step scrolls to its *new lines* (`data-wt-new`, a Range),
  not the panel's top.
- **Inline maths never breaks mid-expression**: LatexText keeps anything up
  to 32 characters on one line (`.latex-nowrap`) and breaks longer ones only
  after a top-level relation (`tex-relations.ts`). `displayInline` sets a
  chip's or a button's fractions full size.
- **Figures**: plane labels are placed by `label-place.ts` clear of the axis
  numbers, the lines and each other; the y-axis margin grows for wide
  numbers; `\frac` in a figure label is a case fraction (³⁄₄); diagrams are
  framed on what's drawn (`diagramBounds`), not the canvas; bars rise and
  distances stretch when they appear; a dimmed cutout circle dims only its
  edge (it used to let the shape behind show through the hole).
- **Personal**: the result line says "You chose A. The answer is D." (or
  "You entered 5." beside a green `AcceptedAnswers` box, shared with reviews
  and the teacher answer key), and the dock says "This is where your answer,
  A, goes wrong" on the step that rules it out.
- **The original figure folds** to a thumbnail (`QuestionFigure`) while a
  walkthrough that redraws it (plane, diagram, bars, table) is running.
- **"Did this make sense?"** on the last step, where a student is answering
  (`collectFeedback`; never in previews or answer keys): `WalkthroughFeedback`
  (unique per student per revision), `/owner/content/walkthroughs` ranks the
  most confusing explanations and the step that lost students. Test accounts
  are left out. The action is mocked globally in `vitest.setup.ts`.
- **Phone**: the dock folds to its controls and two lines (remembered per
  browser), and a horizontal swipe steps through.
- **`lintWalkthrough`** is advice, never a refusal: no goals, no formula
  card, a figure that stops changing, a polygon angle under 12°, a slashed
  fraction in a label. `import.ts` and `bank.ts check` print it as `~` lines.
- Deploying needs migration `20261028120000_walkthrough_feedback` on Neon
  first.
