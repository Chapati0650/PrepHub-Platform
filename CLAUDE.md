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
identity. Don't reintroduce a warm hue on the neutral scale; if a component
needs a brand-colored surface, reach for `--accent` (a light teal wash) or
`--achievement`, not a tinted gray. The overall execution deliberately
targets a Linear/Stripe/Brilliant/Bluebook hybrid — serious and premium, not
a "friendly learning game" or a generic AI-SaaS dashboard — after an initial
pass (warm rounded display font on every heading, soft full-card color
washes, generous 0.75rem radius) read as "cartoonish kid app" in real user
feedback and was deliberately walked back. Intentional choices worth
preserving when touching either file:

- **Fredoka is brand-mark-only.** `--font-brand` (Fredoka, the channel's
  wordmark font) is used in exactly one place — the "PrepHub" text in
  `src/components/logo.tsx` — via the dedicated `font-brand` utility, never
  through `font-heading`. `--font-heading` resolves to Geist Sans (the same
  face as body/UI text); every semantic `h1`-`h6` gets `font-heading
  font-semibold tracking-tight` automatically via a `@layer base` rule in
  `globals.css`, so heading hierarchy comes from weight/size/spacing, not a
  separate display face. Do not repoint `--font-heading` at Fredoka again —
  that's the exact change that read as childish.
- **Radius is intentionally tight** (`--radius: 0.375rem`, landing cards
  around 8-9px and buttons around 6px) — Linear/Stripe reference, not the
  generous "friendly app" rounding this started at.
- **Color is applied precisely, not as soft full-card washes.** Score/stat
  cards are plain bordered cards with a small compact indicator (e.g.
  `bg-achievement/12` on a small `rounded-md` badge, or bare colored text),
  not a large `bg-primary/[0.06]` tint across the whole card — that
  "candy-colored SaaS" pattern was one of the concrete things that read as
  unserious. When adding a new celebratory/status element, default to
  restraint: a thin border, a small badge, or colored text alone before
  reaching for a background wash.
- **`achievement` is a fourth accent**, deliberately separate from
  `primary`/`secondary`/`accent`, reserved for score/mastery *improvement*
  moments (dashboard's "+N points since you started," the results screen's
  celebration badge and mastery deltas, a positive study streak) — never for
  answer-correctness, which stays on ordinary green/destructive so it reads
  as the universal right/wrong convention instead of a brand flourish.
  **Gotcha, confirmed by screenshot**: `--achievement-foreground` is tuned as
  the text color for a *solid* `bg-achievement` fill, not for text sitting on
  the translucent `bg-achievement/15` wash this app actually uses for pills —
  paired that way it's unreadable in dark mode (near-black text on a
  near-black tinted surface). The fix everywhere it's used is
  `text-achievement-foreground dark:text-achievement`, not
  `text-achievement-foreground` alone.

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
left sidebar on desktop (`sm:flex`, `w-60`) and a slide-out `Sheet` behind a
hamburger button on mobile — replacing an earlier top horizontal header, per
the Linear/Stripe reference. `children` renders exactly once in a single
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
