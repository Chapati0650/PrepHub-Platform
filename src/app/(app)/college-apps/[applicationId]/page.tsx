import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getApplication } from "@/lib/college-apps/tracker";
import { TEST_POLICY_LABEL } from "@/lib/colleges/directory";
import { ScoreFitBar, FitBadge } from "@/components/score-fit-bar";
import { Button } from "@/components/ui/button";
import { KIND_LABEL, formatDeadline } from "../labels";
import { ApplicationForm, AddItemForm, RemoveCollegeButton } from "./application-forms";
import { deleteItemAction, toggleItemAction } from "../actions";

export default async function ApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  if (!(await hasPaidAccess(session.user.id))) redirect("/college-apps");

  const { applicationId } = await params;
  const app = await getApplication(session.user.id, applicationId);
  if (!app) notFound();
  const college = app.college;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <Link href="/college-apps" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All colleges
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page-title sm:text-page-title-lg">{app.collegeName}</h1>
            <FitBadge fit={app.fit.fit} />
          </div>
          {college && (
            <p className="mt-2 text-muted-foreground">
              {college.city}, {college.state}
              {college.admissionRate !== null && ` · ${Math.round(college.admissionRate * 100)}% admitted`}
              {college.size !== null && ` · ${college.size.toLocaleString()} undergrads`}
              {" · "}
              {TEST_POLICY_LABEL[app.testPolicy]}
              {college.url && (
                <>
                  {" · "}
                  <a href={college.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                    Website <ExternalLink className="size-3" aria-hidden />
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        <RemoveCollegeButton applicationId={app.id} collegeName={app.collegeName} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-8">
          {/* Checklist */}
          <section className="rounded-2xl border border-border">
            <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
              <h2 className="font-heading font-semibold">Checklist</h2>
              <p className="text-sm tabular-nums text-muted-foreground">
                {app.doneCount}/{app.itemCount} done
              </p>
            </div>
            {app.items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                PrepHub hasn&apos;t added {app.collegeName}&apos;s essay prompts for this cycle yet. They&apos;ll appear here
                when they&apos;re in; you can add recommendation letters and other to-dos below in the meantime.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {app.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                    <form action={toggleItemAction} className="pt-0.5">
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="applicationId" value={app.id} />
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
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className={item.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{item.title}</p>
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABEL[item.kind]}
                          {item.wordLimit && ` · ${item.wordLimit} words`}
                        </span>
                      </div>
                      {item.detail && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{item.detail}</p>}
                    </div>
                    {item.source === "STUDENT" && (
                      <form action={deleteItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="applicationId" value={app.id} />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Delete ${item.title}`} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border px-5 py-4">
              <AddItemForm applicationId={app.id} />
            </div>
          </section>

        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
          {/* Score fit — the reason this tracker lives inside PrepHub. */}
          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-heading font-semibold">Score fit</h2>
            {app.fit.aimFor !== null ? (
              <>
                <div className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Aim for</p>
                    <p className="mt-1 font-heading text-display-sm font-semibold tracking-tight tabular-nums">{app.fit.aimFor}</p>
                  </div>
                  {app.studentRange && (
                    <div className="text-right">
                      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your prediction</p>
                      <p className="mt-1 font-heading text-display-sm font-semibold tracking-tight tabular-nums">
                        {app.studentRange.min}–{app.studentRange.max}
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-5">
                  <ScoreFitBar student={app.studentRange} college={college ?? { sat25: null, sat75: null }} fit={app.fit.fit} />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Admitted students&apos; middle 50%: <span className="tabular-nums">{college?.sat25}–{college?.sat75}</span>. Aiming
                  for the 75th percentile puts you in the top quarter of the admitted class.
                  {app.fit.gap !== null && app.fit.gap > 0 && (
                    <>
                      {" "}
                      That&apos;s <span className="font-medium text-foreground tabular-nums">{app.fit.gap} points</span> above your current
                      upper bound.
                    </>
                  )}
                  {app.fit.gap === 0 && <> You&apos;re already there.</>}
                  {!app.studentRange && (
                    <>
                      {" "}
                      <Link href="/diagnostic" className="underline underline-offset-4">
                        Take the Diagnostic
                      </Link>{" "}
                      to see where you stand.
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {app.testPolicy === "not-considered"
                  ? `${app.collegeName} doesn't consider test scores, so there's no range to fit.`
                  : `${app.collegeName} doesn't report an SAT range to the Department of Education.`}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border p-6">
            <h2 className="font-heading font-semibold">Application</h2>
            {app.deadline && (
              <p className="mt-1 text-sm text-muted-foreground">Due {formatDeadline(app.deadline)}</p>
            )}
            <div className="mt-5">
              <ApplicationForm
                applicationId={app.id}
                initial={{ platform: app.platform, plan: app.plan, status: app.status, deadline: app.deadline, notes: app.notes }}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
