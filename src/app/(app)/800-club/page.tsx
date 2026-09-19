import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getClubOverview } from "@/lib/club/sessions";
import { CLUB_SESSION_SIZE } from "@/lib/club/config";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Marker } from "@/components/ui/marker";
import { openClubSectionAction } from "./actions";

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// The 800 Club — the reference's "Challenge Questions". A section is a pool
// of published HARD questions; "Open" starts (or resumes) a session of up
// to CLUB_SESSION_SIZE of them. Outside the adaptive engine entirely: see
// the schema comment on ClubSession.
export default async function EightHundredClubPage({ searchParams }: { searchParams: Promise<{ empty?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const [{ sections, analytics }, paidAccess, { empty }] = await Promise.all([
    getClubOverview(studentId),
    hasPaidAccess(studentId),
    searchParams,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Premium</p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">
          The <Marker>800 Club</Marker>
        </h1>
      </div>

      {/* The reference's explainer box — the Owner's copy. */}
      <section className="rounded-2xl border-2 border-marker/60 bg-surface-tint p-6">
        <h2 className="font-heading text-lg font-semibold tracking-tight">What are PrepHub&apos;s 800 Club questions?</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          They are the extremely hard questions you see at the end of Module 2 Math and throughout Module 2 Reading &
          Writing. Mastering these can take you from a 1450 to the 1550+ range.
        </p>
      </section>

      {empty && (
        <Alert>
          <AlertDescription>That section doesn&apos;t have any 800 Club questions yet. Check back soon.</AlertDescription>
        </Alert>
      )}

      {/* Section cards. The reference paints these with illustrations; ours
          use the two brand surfaces so they read as a pair without stock
          art — Reading & Writing on the deep block, Math on the tint. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sections.map((s, i) => {
          const deep = i === 0;
          const openable = paidAccess && s.questionCount > 0;
          return (
            <section
              key={s.section}
              className={
                deep
                  ? "flex flex-col gap-6 rounded-3xl bg-surface-deep p-6 text-surface-deep-foreground"
                  : "flex flex-col gap-6 rounded-3xl bg-surface-tint p-6"
              }
            >
              <div>
                <p className="font-heading text-xl font-semibold tracking-tight">{s.label}</p>
                <p className={deep ? "mt-1 text-sm text-surface-deep-foreground/70" : "mt-1 text-sm text-muted-foreground"}>
                  <span className="tabular-nums">{s.questionCount}</span> question{s.questionCount === 1 ? "" : "s"}
                  {" · "}
                  {s.blurb}
                </p>
              </div>
              <div className="mt-auto">
                {openable ? (
                  <form action={openClubSectionAction}>
                    <input type="hidden" name="section" value={s.section} />
                    <Button
                      type="submit"
                      className={
                        deep
                          ? "rounded-full bg-surface-deep-foreground px-5 text-surface-deep hover:bg-surface-deep-foreground/90"
                          : "rounded-full px-5"
                      }
                    >
                      {s.activeSessionId ? "Resume" : "Open"}
                    </Button>
                  </form>
                ) : !paidAccess ? (
                  <LinkButton
                    href="/pricing"
                    className={
                      deep
                        ? "rounded-full bg-surface-deep-foreground px-5 text-surface-deep hover:bg-surface-deep-foreground/90"
                        : "rounded-full px-5"
                    }
                  >
                    <Lock className="size-4" aria-hidden />
                    Unlock with Premium
                  </LinkButton>
                ) : (
                  <p className={deep ? "text-sm text-surface-deep-foreground/70" : "text-sm text-muted-foreground"}>
                    No questions yet.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Analytics — the reference's strip, from real club attempts only. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">800 Club Analytics</h2>
        <div className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border [&>*:nth-child(n+3)]:border-t sm:grid-cols-4 sm:divide-x sm:[&>*:nth-child(n+3)]:border-t-0">
          <Stat label="Questions Attempted" value={String(analytics.attempted)} />
          <Stat label="Accuracy" value={analytics.accuracy === null ? "—" : `${analytics.accuracy}%`} />
          <Stat label="Correct Answers" value={String(analytics.correct)} />
          <Stat label="Avg. Time" value={analytics.averageSecondsPerQuestion === null ? "—" : formatSeconds(analytics.averageSecondsPerQuestion)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Sessions are {CLUB_SESSION_SIZE} questions. They never change your Predicted SAT Score — this is extra
          practice at the top of the scale, not a measurement.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-display-sm font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}
