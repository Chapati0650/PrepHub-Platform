import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getRushResults, type RushParticipant } from "@/lib/rush/runs";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { RushQuestionReview } from "./rush-results";
import { ResultsCelebration } from "./celebration";
import { RematchPanel } from "./rematch-panel";
import { getRematchState } from "@/lib/rush/rematch";
import { myWeeklyStanding } from "@/lib/rush/leaderboard";
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
  const [data, paidAccess, rematch, standing] = await Promise.all([
    getRushResults(studentId, challengeId),
    hasPaidAccess(studentId),
    getRematchState(studentId, challengeId),
    myWeeklyStanding(studentId),
  ]);
  if (!data) redirect("/rush");
  // One primary pill per screen (CLAUDE.md): when a rematch is on offer it is
  // the obvious next move, so the generic "start another" button steps down.
  const rematchLeads = rematch.kind === "NONE" || rematch.kind === "RECEIVED";

  const opponent = data.others.find((o) => o.status === "COMPLETED") ?? null;
  const joinUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/rush/join/${data.code}`;
  // Nobody else has played yet: a friend challenge still to be sent, or a
  // random run waiting for the next student.
  // A rematch is already addressed to one person, so it never asks to be shared.
  const awaitingFriend = data.mode === "FRIEND" && data.isCreator && data.others.length === 0 && !data.rematchFor;
  const awaitingRematch = data.isCreator && data.others.length === 0 && Boolean(data.rematchFor);
  const awaitingMatch = data.mode === "RANDOM" && !opponent;

  // A result should land like one. "Victory" and "Defeat" are the words every
  // game uses for this screen, and the plain sentence under each says what
  // happened without the flourish.
  const headline =
    data.outcome === "WON"
      ? "Victory."
      : data.outcome === "LOST"
        ? "Defeat."
        : data.outcome === "TIED"
          ? "Dead heat."
          : data.mode === "SOLO"
            ? "Rush complete."
            : "Your run is in.";
  const subline =
    data.outcome === "WON" && opponent
      ? `You beat ${opponent.name} by ${data.me.score - opponent.score > 0 ? `${data.me.score - opponent.score} points` : "time"}.`
      : data.outcome === "LOST" && opponent
        ? `${opponent.name} took it by ${opponent.score - data.me.score > 0 ? `${opponent.score - data.me.score} points` : "time"}. Run it back.`
        : data.outcome === "TIED"
          ? "Same score, same time. Nobody blinked."
          : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            1v1 Rush{data.live ? " · Live" : ""} · {data.sectionLabel}
          </p>
          <ResultsCelebration outcome={data.outcome} />
        </div>
        <h1
          className={[
            "mt-3 text-display-sm sm:text-display",
            data.outcome === "WON" && "text-achievement-foreground dark:text-achievement",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {headline}
        </h1>
        {subline && <p className="mt-2 text-muted-foreground">{subline}</p>}

        {opponent ? (
          <div className="mt-6 grid grid-cols-2 divide-x divide-border">
            <Column participant={data.me} label="You" streaks={data.scoringVersion >= 2} />
            <Column participant={opponent} label={opponent.name} streaks={data.scoringVersion >= 2} />
          </div>
        ) : (
          <>
            <p className="mt-6 font-heading text-hero font-semibold tracking-tight tabular-nums">
              {data.me.score}
              <span className="text-muted-foreground">/{data.maxScore}</span>
            </p>
            <p className="mt-2 text-muted-foreground">
              {data.me.correctCount}/{data.total} correct · {seconds(data.me.totalMs)} total.
            </p>
            <RunStats participant={data.me} streaks={data.scoringVersion >= 2} />
          </>
        )}

        {standing && (
          <p className="mt-6 text-sm tabular-nums text-muted-foreground">
            {standing.standing.hidden ? (
              <>
                You&apos;d be <span className="font-medium text-foreground">#{standing.standing.rank}</span> at{" "}
                {standing.schoolName} this week — you&apos;re hidden from the leaderboard.
              </>
            ) : (
              <>
                You&apos;re <span className="font-medium text-foreground">#{standing.standing.rank}</span> of{" "}
                {standing.players} at {standing.schoolName} this week, with a best of {standing.standing.score.toLocaleString()}.
              </>
            )}
          </p>
        )}

        <RematchPanel challengeId={data.challengeId} initial={rematch} paid={paidAccess} />

        {awaitingRematch && (
          <p className="mt-6 max-w-prose text-sm text-muted-foreground">
            This is a rematch. {data.rematchFor} will see it on their 1v1 Rush page, and their result shows up here
            when they finish.
          </p>
        )}

        {awaitingMatch && (
          <p className="mt-6 max-w-prose text-sm text-muted-foreground">
            You&apos;ll be matched with the next student who races a recorded {data.sectionLabel} rush. Their result shows up
            here when they finish.
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
            <input
              type="hidden"
              name="option"
              value={data.mode === "SOLO" ? "SOLO" : data.mode === "FRIEND" ? (data.live ? "FRIEND_LIVE" : "FRIEND_ASYNC") : data.live ? "RANDOM_LIVE" : "RANDOM_LIVE"}
            />
            <Button type="submit" size="cta" variant={rematchLeads ? "outline" : "default"}>
              {data.mode === "SOLO" ? "Run it again" : data.mode === "FRIEND" ? (data.live ? "New live room" : "New challenge") : "Find another opponent"}
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

function Column({ participant, label, streaks }: { participant: RushParticipant; label: string; streaks: boolean }) {
  return (
    <div className={participant.isMe ? "pr-6" : "pl-6"}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-display font-semibold tracking-tight tabular-nums">{participant.score}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {participant.correctCount} correct · {seconds(participant.totalMs)}
      </p>
      <RunStats participant={participant} streaks={streaks} />
    </div>
  );
}

/**
 * The two numbers a player brags about. Best streak only where streaks
 * score (a version-1 challenge never showed one); fastest correct answer
 * always. Plain text, not tiles — a stat row is a rule, not a box.
 */
function RunStats({ participant, streaks }: { participant: RushParticipant; streaks: boolean }) {
  const parts: string[] = [];
  if (streaks && participant.bestStreak >= 2) parts.push(`Best streak ${participant.bestStreak}`);
  if (participant.fastestCorrectMs !== null) parts.push(`Fastest ${seconds(participant.fastestCorrectMs)}`);
  if (parts.length === 0) return null;
  return <p className="mt-1 text-sm tabular-nums text-muted-foreground">{parts.join(" · ")}</p>;
}
