import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Lock, Plus } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getTracker, type TrackerApplication } from "@/lib/college-apps/tracker";
import { YEAR_CHECKLIST } from "@/lib/college-apps/year-checklist";
import { PLAN_LABEL, STATUS_LABEL, formatDeadline } from "./labels";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { ScoreFitBar, FitBadge } from "@/components/score-fit-bar";
import { toggleItemAction } from "./actions";

// College Apps — the application tracker. Premium (included in the single
// rate), gated on hasPaidAccess here and in every action. The grade from
// the wizard decides the view: seniors and juniors get the tracker,
// deadline-first; freshmen and sophomores get "what this year is for" and
// can start a list.
export default async function CollegeAppsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  if (!(await hasPaidAccess(studentId))) return <Paywall />;

  const tracker = await getTracker(studentId);
  if (!tracker) redirect("/college-apps/onboarding");

  const year = YEAR_CHECKLIST[tracker.grade];
  const isUpperclass = tracker.grade >= 11;
  const submitted = tracker.applications.filter((a) => a.status === "SUBMITTED" || a.status === "ACCEPTED" || a.status === "WAITLISTED" || a.status === "DENIED").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            College Apps · {["", "", "", "", "", "", "", "", "", "Freshman", "Sophomore", "Junior", "Senior"][tracker.grade]}
          </p>
          <h1 className="mt-3 text-page-title sm:text-page-title-lg">
            {isUpperclass ? (
              <>
                {tracker.applications.length} college{tracker.applications.length === 1 ? "" : "s"}, {submitted} submitted
              </>
            ) : (
              year.heading
            )}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <LinkButton size="cta" href="/college-apps/add">
            <Plus className="size-4" aria-hidden />
            Add a college
          </LinkButton>
          <Link href="/college-apps/onboarding" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Change grade or platforms
          </Link>
        </div>
      </div>

      {/* Deadline countdown — the reference's SAT countdown, for the thing
          that actually keeps seniors up at night. */}
      {tracker.nextDeadline && (
        <section className="flex flex-col gap-4 rounded-3xl bg-surface-deep p-6 text-surface-deep-foreground sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">Next deadline</p>
            <p className="mt-2 font-heading text-2xl font-semibold tracking-tight">
              <Link href={`/college-apps/${tracker.nextDeadline.application.id}`} className="hover:underline">
                {tracker.nextDeadline.application.collegeName}
              </Link>
            </p>
            <p className="mt-1 text-surface-deep-foreground/75">
              {tracker.nextDeadline.application.plan ? `${PLAN_LABEL[tracker.nextDeadline.application.plan]} · ` : ""}
              {formatDeadline(tracker.nextDeadline.application.deadline!)}
            </p>
          </div>
          <p className="font-heading text-hero font-semibold tracking-tight tabular-nums">
            {tracker.nextDeadline.daysLeft}
            <span className="ml-2 text-lg font-normal text-surface-deep-foreground/70">day{tracker.nextDeadline.daysLeft === 1 ? "" : "s"}</span>
          </p>
        </section>
      )}

      {/* Freshman/sophomore: this year's checklist leads; the list is
          secondary. Junior/senior: the list leads; the checklist is a
          sidebar. */}
      <div className={isUpperclass ? "grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr]" : "flex flex-col gap-8"}>
        {!isUpperclass && <YearChecklist heading={null} items={year.items} />}

        <section className="flex flex-col gap-4">
          <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {isUpperclass ? "Your colleges" : "Your list"}
          </h2>
          {tracker.applications.length === 0 ? (
            <div className="rounded-2xl bg-surface-tint p-6">
              <p className="font-medium">No colleges yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add one and PrepHub fills in its prompts, its test policy, and how your predicted score fits.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
              {tracker.applications.map((a) => (
                <ApplicationRow key={a.id} app={a} studentRange={tracker.studentRange} />
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-8">
          {isUpperclass && <YearChecklist heading={year.heading} items={year.items} />}

          {tracker.sharedItems.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Shared across colleges</h2>
              <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
                {tracker.sharedItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <form action={toggleItemAction} className="pt-0.5">
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="done" value={item.done ? "false" : "true"} />
                      <button
                        type="submit"
                        aria-label={`${item.done ? "Mark not done" : "Mark done"}: ${item.title}`}
                        aria-pressed={item.done}
                        className={
                          item.done
                            ? "flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            : "flex size-5 items-center justify-center rounded-full border border-foreground/30 hover:border-primary"
                        }
                      >
                        {item.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className={item.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{item.title}</p>
                      {item.wordLimit && <p className="text-xs text-muted-foreground">{item.wordLimit} words</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!tracker.studentRange && (
            <div className="rounded-2xl bg-surface-tint p-5 text-sm">
              <p className="font-medium">Score fit needs your Predicted SAT Score.</p>
              <p className="mt-1 text-muted-foreground">
                Take the Diagnostic and every college on your list gets a likely / target / reach reading against your
                own range.
              </p>
              <LinkButton className="mt-3 rounded-full" variant="outline" href="/diagnostic">
                Take the Diagnostic
              </LinkButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ApplicationRow({ app, studentRange }: { app: TrackerApplication; studentRange: { min: number; max: number } | null }) {
  return (
    <li>
      <Link href={`/college-apps/${app.id}`} className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{app.collegeName}</p>
            <FitBadge fit={app.fit.fit} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {STATUS_LABEL[app.status]}
            {app.plan && ` · ${PLAN_LABEL[app.plan]}`}
            {app.deadline && ` · due ${formatDeadline(app.deadline)}`}
          </p>
        </div>
        {/* w-56, not w-full: the bar's spans are absolutely positioned, so
            this wrapper has no intrinsic width and collapsed to zero as a
            plain flex item — confirmed by screenshot. */}
        <div className="hidden w-56 shrink-0 sm:block">
          <ScoreFitBar student={studentRange} college={app.college ?? { sat25: null, sat75: null }} fit={app.fit.fit} compact />
        </div>
        <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {app.doneCount}/{app.itemCount} done
        </p>
      </Link>
    </li>
  );
}

function YearChecklist({ heading, items }: { heading: string | null; items: string[] }) {
  return (
    <section className="rounded-2xl border border-border p-6">
      {heading && <h2 className="font-heading text-lg font-semibold tracking-tight">{heading}</h2>}
      <ol className={heading ? "mt-4 flex flex-col gap-3" : "flex flex-col gap-3"}>
        {items.map((it, i) => (
          <li key={it} className="flex gap-4 text-sm">
            <span className="shrink-0 font-heading font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <span>{it}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Paywall() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6 sm:p-10">
      <div className="rounded-3xl bg-surface-tint p-8 sm:p-12">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <Lock className="mr-1.5 inline size-3.5 align-[-0.15em]" aria-hidden />
          Premium
        </p>
        <h1 className="mt-3 text-display-sm text-balance">
          Every college, every prompt, <Marker>one list</Marker>.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          The College Apps tracker fills in each college&apos;s essay prompts and deadlines, and reads your predicted
          score against its admitted class. It&apos;s part of PrepHub Premium.
        </p>
        <div className="mt-8">
          <LinkButton size="cta" href="/pricing">
            View plans
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
