import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getRushResults, type RushParticipant } from "@/lib/rush/runs";
import { RUSH_MAX_SCORE } from "@/lib/rush/config";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { RushQuestionReview } from "./rush-results";
import { ShareChallenge } from "../../share-challenge";
import { loadRushQuestionDetailAction, startRushAction } from "../../actions";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

export default async function RushResultsPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const { challengeId } = await params;
  const [data, paidAccess] = await Promise.all([getRushResults(studentId, challengeId), hasPaidAccess(studentId)]);
  if (!data) redirect("/rush");

  const opponent = data.others.find((o) => o.status === "COMPLETED") ?? null;
  const joinUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/rush/join/${data.code}`;
  // Nobody else has played yet: a friend challenge still to be sent, or a
  // random run waiting for the next student.
  const awaitingFriend = data.mode === "FRIEND" && data.isCreator && data.others.length === 0;
  const awaitingMatch = data.mode === "RANDOM" && !opponent;

  const headline =
    data.outcome === "WON" ? "You won." : data.outcome === "LOST" ? "You lost." : data.outcome === "TIED" ? "It's a tie." : data.mode === "SOLO" ? "Rush complete." : "Your run is in.";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          1v1 Rush · {data.sectionLabel} · {data.difficultyLabel}
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{headline}</h1>

        {opponent ? (
          <div className="mt-6 grid grid-cols-2 divide-x divide-border">
            <Column participant={data.me} label="You" />
            <Column participant={opponent} label={opponent.name} />
          </div>
        ) : (
          <>
            <p className="mt-6 font-heading text-hero font-semibold tracking-tight tabular-nums">
              {data.me.score}
              <span className="text-muted-foreground">/{RUSH_MAX_SCORE}</span>
            </p>
            <p className="mt-2 text-muted-foreground">
              {data.me.correctCount}/{data.total} correct · {seconds(data.me.totalMs)} total.
            </p>
          </>
        )}

        {awaitingMatch && (
          <p className="mt-6 max-w-prose text-sm text-muted-foreground">
            You&apos;ll be matched with the next student who starts a {data.sectionLabel} · {data.difficultyLabel} rush. Their
            result shows up here when they finish.
          </p>
        )}

        {data.others.length > 1 && (
          <ol className="mt-6 flex flex-col divide-y divide-border border-y border-border text-sm">
            {[data.me, ...data.others]
              .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs)
              .map((p, i) => (
                <li key={p.runId} className="flex items-center justify-between gap-3 py-2 tabular-nums">
                  <span className="flex items-center gap-3">
                    <span className="w-5 text-muted-foreground">{i + 1}</span>
                    <span className={p.isMe ? "font-medium" : undefined}>{p.isMe ? "You" : p.name}</span>
                    {p.status !== "COMPLETED" && <span className="text-xs text-muted-foreground">still playing</span>}
                  </span>
                  <span>
                    {p.score} · {seconds(p.totalMs)}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </section>

      {awaitingFriend && (
        <section className="rounded-2xl border border-border p-5">
          <h2 className="font-medium">Send it to a friend</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            They&apos;ll play the same ten questions against your times. Any PrepHub account can accept — no Premium needed.
          </p>
          <div className="mt-4">
            <ShareChallenge code={data.code} joinUrl={joinUrl} />
          </div>
        </section>
      )}

      <RushQuestionReview data={data} loadQuestionDetail={loadRushQuestionDetailAction} />

      <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row-reverse sm:justify-end">
        {paidAccess ? (
          <form action={startRushAction}>
            <input type="hidden" name="section" value={data.section} />
            <input type="hidden" name="difficulty" value={data.difficulty} />
            <input type="hidden" name="mode" value={data.mode} />
            <Button type="submit" size="cta">
              {data.mode === "SOLO" ? "Run it again" : data.mode === "FRIEND" ? "New challenge" : "Find another opponent"}
            </Button>
          </form>
        ) : (
          <LinkButton size="cta" href="/pricing">
            <Lock className="size-4" aria-hidden />
            Start your own rush with Premium
          </LinkButton>
        )}
        <LinkButton size="cta" variant="outline" href="/rush">
          Back to 1v1 Rush
        </LinkButton>
      </div>
    </div>
  );
}

function Column({ participant, label }: { participant: RushParticipant; label: string }) {
  return (
    <div className={participant.isMe ? "pr-6" : "pl-6"}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-display font-semibold tracking-tight tabular-nums">{participant.score}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {participant.correctCount} correct · {seconds(participant.totalMs)}
      </p>
    </div>
  );
}
