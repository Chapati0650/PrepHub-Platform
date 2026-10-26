import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";

// The building blocks of the staff pages — everything a School Administrator
// or a teacher works in (2026-10-25).
//
// Written for the person most likely to be using them: a school administrator
// who may be sixty, opens this twice a month, and has no reason to learn a
// dense interface. So, against the rest of the app's deliberately compact
// interior: body-size text as the floor for anything that matters (no 12px
// grey labels on a number someone needs), every page saying in one sentence
// what it is for, numbers labelled in plain words with what they count, and
// controls at the `xl` button size. The visual language is the product's own —
// the tinted header band, rules rather than boxes inside a panel, two-digit
// ordinals rather than icon tiles — so these pages read as PrepHub, just
// easier to use.

/** The page column. Wide enough for a table, narrow enough to read. */
export function StaffPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 pb-20 sm:p-8", className)}>{children}</div>;
}

/**
 * The top of every staff page: where you are, what this page is for, and the
 * one or two things you'd come here to do. Left-aligned on the tinted band,
 * like the product's other hero blocks.
 */
export function StaffHeader({
  eyebrow,
  title,
  description,
  back,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="rounded-3xl bg-surface-tint p-6 sm:p-8">
      {back && (
        <Link
          href={back.href}
          className="mb-4 inline-flex items-center gap-1.5 text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && (
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
          )}
          <h1 className={cn("text-page-title sm:text-page-title-lg", eyebrow && "mt-2")}>{title}</h1>
          {description && <div className="mt-3 text-lg leading-relaxed text-foreground/75">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
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
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-8 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id={headingId} className="text-xl">
            {title}
          </h2>
          {description && <div className="mt-1 text-base text-muted-foreground">{description}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export type StaffStat = {
  label: string;
  value: string;
  /** What the number counts, in a few plain words. */
  hint?: string;
};

/**
 * A row of figures in one panel, divided by rules: one box, not one per
 * number. Each figure is large, its label is body-size and says what it is,
 * and an optional line under it says what it counts.
 */
export function StatStrip({ stats, columns = 4 }: { stats: StaffStat[]; columns?: 2 | 3 | 4 }) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-2xl border border-border bg-border",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col bg-background p-5">
          <dt className="text-base font-medium">{s.label}</dt>
          <dd className="mt-2 font-heading text-4xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
          {s.hint && <dd className="mt-1 text-sm text-muted-foreground">{s.hint}</dd>}
        </div>
      ))}
    </dl>
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
        <li key={step.title} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span
            className={cn(
              "font-heading text-lg font-semibold tabular-nums",
              step.done ? "text-muted-foreground" : "text-foreground",
            )}
            aria-hidden
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-lg font-medium", step.done && "text-muted-foreground")}>{step.title}</p>
            <div className="mt-0.5 text-base text-muted-foreground">{step.body}</div>
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
  return <div className={cn("border-l-2 border-marker pl-4 text-base text-muted-foreground", className)}>{children}</div>;
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
      {hint && <div className="text-sm text-muted-foreground">{hint}</div>}
    </div>
  );
}

const CHIP_TONES = {
  good: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  muted: "bg-muted text-muted-foreground",
} as const;

/** A short status in words, tinted — the words carry it, the tint helps. */
export function StatusChip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-sm font-medium whitespace-nowrap", CHIP_TONES[tone])}>
      {children}
    </span>
  );
}

/** The shared "this area isn't for this account" state. */
export function StaffUnavailable({ title }: { title: string }) {
  return (
    <StaffPage className="max-w-2xl">
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
