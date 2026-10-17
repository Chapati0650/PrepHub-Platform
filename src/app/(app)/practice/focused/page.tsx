import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getFocusedOverview } from "@/lib/focused/sessions";
import {
  FOCUSED_CATEGORY_LABELS,
  FOCUSED_DIFFICULTY_BLURBS,
  FOCUSED_DIFFICULTY_LABELS,
  FOCUSED_DIFFICULTY_ORDER,
  FOCUSED_SESSION_SIZE,
} from "@/lib/focused/config";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Marker } from "@/components/ui/marker";
import { startFocusedSessionAction } from "./actions";

// Focused Practice — the student picks a category and a difficulty and
// drills it. Deliberately a picker rather than a browsable question bank:
// see the comment at the top of src/lib/focused/config.ts for why.
//
// The grid is one row per category, one button per difficulty. A difficulty
// with no published questions is disabled rather than hidden, so a thin part
// of the bank reads as "not ready yet" instead of silently not existing.
export default async function FocusedPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const [{ categories, analytics }, paidAccess, { empty }] = await Promise.all([
    getFocusedOverview(studentId),
    hasPaidAccess(studentId),
    searchParams,
  ]);

  const activeSession = categories.find((c) => c.activeSessionId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Premium
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">
          <Marker>Focused</Marker> Practice
        </h1>
        <p className="mt-4 max-w-prose text-muted-foreground">
          Your Practice Sets are built for you. This is the opposite: pick the category and the
          difficulty yourself and drill {FOCUSED_SESSION_SIZE} questions on exactly what you want
          to work on.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-surface-tint p-6">
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          Drills don&apos;t move your Predicted SAT Score
        </h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          You chose what to practice, so a drill isn&apos;t a fair read on where you stand — which
          is why it is kept out of the prediction. Your Practice Sets are what move it, and they
          still do.
        </p>
      </section>

      {empty && (
        <Alert>
          <AlertDescription>
            There aren&apos;t any published questions for that combination yet. Try another
            difficulty, or check back soon.
          </AlertDescription>
        </Alert>
      )}

      {!paidAccess && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <Lock className="size-4 shrink-0" aria-hidden />
            <span>Focused Practice is part of Premium.</span>
            <LinkButton href="/pricing" variant="outline" className="ml-auto">
              See pricing
            </LinkButton>
          </AlertDescription>
        </Alert>
      )}

      {activeSession && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              You have an unfinished {FOCUSED_CATEGORY_LABELS[activeSession.category]} drill.
            </span>
            <LinkButton
              href={`/practice/focused/session/${activeSession.activeSessionId}`}
              variant="outline"
              className="ml-auto"
            >
              Resume
            </LinkButton>
          </AlertDescription>
        </Alert>
      )}

      {/* One divide-y list rather than seven bordered cards — a row per
          category, matching the house pattern for long lists. */}
      <section className="flex flex-col">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Choose a category
        </h2>
        <div className="mt-4 flex flex-col divide-y divide-border border-y border-border">
          {categories.map((c) => (
            <div
              key={c.category}
              className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <p className="font-heading font-semibold tracking-tight">{c.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {c.counts.MIXED === 0
                    ? "No published questions yet"
                    : `${c.counts.MIXED} question${c.counts.MIXED === 1 ? "" : "s"} available`}
                  {c.attempted > 0 && ` · ${c.accuracy}% across ${c.attempted} drilled`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {FOCUSED_DIFFICULTY_ORDER.map((d) => (
                  <form key={d} action={startFocusedSessionAction}>
                    <input type="hidden" name="category" value={c.category} />
                    <input type="hidden" name="difficulty" value={d} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={d === "MIXED" ? "default" : "outline"}
                      disabled={!paidAccess || c.counts[d] === 0}
                      title={
                        c.counts[d] === 0
                          ? `No published ${FOCUSED_DIFFICULTY_LABELS[d]} questions in ${c.label} yet`
                          : FOCUSED_DIFFICULTY_BLURBS[d]
                      }
                    >
                      {FOCUSED_DIFFICULTY_LABELS[d]}
                    </Button>
                  </form>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {analytics.attempted > 0 && (
        <section className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
          <Stat label="Drills finished" value={String(analytics.sessionsCompleted)} />
          <Stat label="Questions drilled" value={String(analytics.attempted)} />
          <Stat label="Accuracy" value={analytics.accuracy === null ? "—" : `${analytics.accuracy}%`} />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
