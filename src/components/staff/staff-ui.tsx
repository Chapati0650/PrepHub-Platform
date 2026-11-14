import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";

// The building blocks of the staff pages — everything a School Administrator
// or a teacher works in (2026-10-25, redrawn 2026-11-14).
//
// Written for the person most likely to be using them: a school administrator
// who may be sixty, opens this twice a month, may find small text hard to
// read, and decides whether the school renews. So, against the rest of the
// app's deliberately compact interior:
//
// - 15px (`text-base`) is the smallest text on a staff page. Sentences are
//   `text-lg`. No `text-sm`/`text-xs` grey labels on anything that matters.
// - Every page starts with a plain header (where you are, what this page is,
//   the one or two things to do here) under a rule. The 2026-10-25 version
//   put every page's header in the same pastel rounded box, which made every
//   page open identically and pushed the content down; the tint is now kept
//   for the one block on a page that asks for something (`AttentionList`).
// - Pages say what to do next, not only what happened: an `AttentionList`
//   leads the Overview and the teacher's home, each item a count, a sentence
//   and the button that deals with it.
// - Rules rather than boxes inside a panel, two-digit ordinals rather than
//   icon tiles, a status in words with the tint only helping.

/** The page column. Wide enough for a table without wrapping its emails. */
export function StaffPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-12 px-4 pt-6 pb-24 sm:px-8 sm:pt-10 lg:px-12", className)}>
      {children}
    </div>
  );
}

/**
 * The top of every staff page: where you are, what this page is for, and the
 * one or two things you'd come here to do. Plain, under a rule.
 */
export function StaffHeader({
  eyebrow,
  title,
  description,
  back,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-border pb-8">
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-2 rounded-md text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && <p className="text-base font-medium text-muted-foreground">{eyebrow}</p>}
          <h1 className={cn("text-[2.125rem] leading-[1.15] sm:text-[2.625rem]", eyebrow && "mt-1.5")}>{title}</h1>
          {description && <div className="mt-3 text-lg leading-relaxed text-foreground/75">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3 print:hidden">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** A titled part of a staff page, with a sentence saying what's in it. */
export function StaffSection({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-8 flex-col gap-5">
      <div className="flex break-after-avoid flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id={headingId} className="text-2xl">
            {title}
          </h2>
          {description && <div className="mt-1.5 text-lg leading-relaxed text-muted-foreground">{description}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A bordered module: the border is its only chrome. */
export function StaffPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border bg-background", className)}>{children}</div>;
}

export type StaffStat = {
  label: string;
  value: string;
  /** What the number counts, in a few plain words. */
  hint?: string;
};

/**
 * A row of figures in one panel, divided by rules: one box, not one per
 * number. Each figure is large, its label says what it is, and an optional
 * line under it says what it counts.
 */
export function StatStrip({ stats, columns = 4 }: { stats: StaffStat[]; columns?: 2 | 3 | 4 }) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl border border-border bg-border break-inside-avoid",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col bg-background p-6">
          <dt className="text-base font-medium text-foreground/80">{s.label}</dt>
          <dd className="mt-2 font-heading text-4xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
          {s.hint && <dd className="mt-1.5 text-base leading-snug text-muted-foreground">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export type AttentionItem = {
  key: string;
  /** The number the item is about, set large at its left ("11"). */
  count?: number;
  title: ReactNode;
  detail?: ReactNode;
  /** The button (or two) that deals with it. */
  actions?: ReactNode;
};

/**
 * "Needs your attention": the lead block of a staff home page. Each item is a
 * count, one sentence saying what it means, and the action that deals with it
 * right there — the Overview used to report "Gone quiet: 11" and leave the
 * administrator to work out what to do about it. When nothing needs doing it
 * says so, rather than disappearing and leaving the page without a lead.
 */
export function AttentionList({
  title = "Needs your attention",
  items,
  empty,
}: {
  title?: string;
  items: AttentionItem[];
  empty: ReactNode;
}) {
  const hasCounts = items.some((i) => i.count !== undefined);
  return (
    <section aria-labelledby="attention-heading" className="rounded-3xl bg-surface-tint p-5 sm:p-7 print:hidden">
      <h2 id="attention-heading" className="text-2xl">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-lg text-foreground/75">{empty}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
              {hasCounts && (
                <span
                  className="font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums sm:w-20 sm:shrink-0"
                  aria-hidden={item.count === undefined}
                >
                  {item.count === undefined ? "" : item.count.toLocaleString()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg leading-snug font-medium">{item.title}</p>
                {item.detail && <p className="mt-1 text-base leading-relaxed text-muted-foreground">{item.detail}</p>}
              </div>
              {item.actions && <div className="flex shrink-0 flex-wrap gap-3">{item.actions}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type StaffStep = {
  title: string;
  body: ReactNode;
  done?: boolean;
  /** Where to go to do it, when that's another page. */
  href?: string;
  cta?: string;
};

/**
 * Numbered steps — "how this works" or "getting started". The ordinal is the
 * anchor (CLAUDE.md: a two-digit ordinal, never an icon tile); a finished
 * step says Done in words, not only in green.
 */
export function StaffSteps({ steps }: { steps: StaffStep[] }) {
  return (
    <ol className="divide-y divide-border rounded-2xl border border-border">
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <span
            className={cn(
              "font-heading text-xl font-semibold tabular-nums",
              step.done ? "text-muted-foreground" : "text-foreground",
            )}
            aria-hidden
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-lg font-medium", step.done && "text-muted-foreground")}>{step.title}</p>
            <div className="mt-1 text-base leading-relaxed text-muted-foreground">{step.body}</div>
          </div>
          {step.done ? (
            <span className="flex shrink-0 items-center gap-1.5 text-base font-medium text-green-700 dark:text-green-400">
              <Check className="size-5" aria-hidden />
              Done
            </span>
          ) : (
            step.href && (
              <LinkButton href={step.href} variant="outline" size="xl" className="shrink-0">
                {step.cta ?? "Start"}
              </LinkButton>
            )
          )}
        </li>
      ))}
    </ol>
  );
}

/** A sentence of guidance set off by the marker rule. */
export function StaffNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-l-2 border-marker pl-4 text-base leading-relaxed text-muted-foreground", className)}>{children}</div>;
}

/** A label, the control, and a line of help under it, at a size that reads. */
export function StaffField({
  label,
  htmlFor,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-base font-medium">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
      {hint && <div className="text-base leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

const CHIP_TONES = {
  good: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  info: "bg-primary/10 text-primary dark:bg-primary/20 dark:text-marker",
  muted: "bg-muted text-muted-foreground",
} as const;

/** A short status in words, tinted — the words carry it, the tint helps. */
export function StatusChip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-base font-medium whitespace-nowrap", CHIP_TONES[tone])}>
      {children}
    </span>
  );
}

/** The shared "this area isn't for this account" state. */
export function StaffUnavailable({ title }: { title: string }) {
  return (
    <StaffPage className="max-w-3xl">
      <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <h1 className="text-page-title">{title}</h1>
        <p className="mt-3 text-lg text-foreground/75">
          This area is for one school&apos;s administrator, and this account isn&apos;t linked to a school. If that&apos;s a
          mistake, email{" "}
          <a href={`mailto:${SCHOOLS_CONTACT_EMAIL}`} className="font-medium underline underline-offset-4">
            {SCHOOLS_CONTACT_EMAIL}
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
      </div>
    </StaffPage>
  );
}
