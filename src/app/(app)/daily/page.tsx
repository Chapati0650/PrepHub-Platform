import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getDailyChallengeView } from "@/lib/daily/challenge";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { QuestionDetail } from "@/components/session/session-results";
import { DailyQuestion } from "./daily-question";
import { answerDailyChallengeAction } from "./actions";

// The Daily Challenge: one hard question a day, free for every account.
// The free tier's reason to come back (5 of 105 students had returned
// after day one before this existed), and a daily taste of the 800 Club.
// The correct answer and explanation are only rendered after this
// student has answered — the unanswered state gets the question alone.
export default async function DailyChallengePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const [view, paidAccess] = await Promise.all([getDailyChallengeView(studentId), hasPaidAccess(studentId)]);

  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Daily Challenge · Free · {date}</p>
          <h1 className="mt-3 text-page-title sm:text-page-title-lg">
            One <Marker>hard</Marker> question a day.
          </h1>
        </div>
        <div className="text-right">
          <p className="font-heading text-display-sm font-semibold tabular-nums">{view?.streak ?? 0}</p>
          <p className="text-sm text-muted-foreground">day streak</p>
        </div>
      </div>

      {!view ? (
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <h2 className="text-page-title">No challenge today.</h2>
          <p className="mt-3 text-muted-foreground">There aren&apos;t any hard questions published yet. Check back soon.</p>
        </section>
      ) : view.attempt ? (
        <>
          <section className="rounded-3xl bg-surface-tint p-6 sm:p-8">
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{view.categoryLabel}</p>
            <h2 className={`mt-2 font-heading text-2xl font-semibold ${view.attempt.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
              {view.attempt.isCorrect ? "Correct — nice." : "Not this time."}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {view.today.answered === 1
                ? "You're the first to answer today."
                : `${view.today.answered} students have answered today; ${Math.round((view.today.correct / view.today.answered) * 100)}% got it right.`}{" "}
              Tomorrow&apos;s question arrives at midnight UTC.
            </p>
          </section>
          <section className="rounded-2xl border border-border p-5">
            <QuestionDetail loaded={{ content: view.content, feedback: view.attempt.feedback, studentAnswer: view.attempt.answer }} isCorrect={view.attempt.isCorrect} />
          </section>
          {!paidAccess && (
            <section className="rounded-2xl bg-surface-tint p-6">
              <p className="text-caption font-semibold tracking-[0.12em] text-primary uppercase">The 800 Club</p>
              <p className="mt-2 font-heading text-xl font-semibold tracking-tight">Want ten of these at a time?</p>
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                The 800 Club is every hard question in the bank, by section, with explanations — the questions that separate a
                1450 from a 1550+. Part of Premium.
              </p>
              <div className="mt-4">
                <LinkButton href="/pricing" className="rounded-full px-5">
                  <Lock className="size-4" aria-hidden />
                  See Premium
                </LinkButton>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{view.categoryLabel}</span> · No clock, one attempt. Choosing an answer locks it in.
          </p>
          <DailyQuestion challengeId={view.challengeId} content={view.content} submit={answerDailyChallengeAction} />
        </>
      )}
    </div>
  );
}
