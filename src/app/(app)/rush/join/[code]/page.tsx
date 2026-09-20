import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { normalizeRushCode } from "@/lib/rush/codes";
import { getChallengePreview } from "@/lib/rush/runs";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { joinRushAction } from "../../actions";

// Where a friend's link lands. Free to accept by design — this page is the
// hook, so there is no paid-access check anywhere on it or on the action
// behind its button. (A signed-out visitor never reaches it: middleware
// sends them to signup with the code kept in a cookie.)
export default async function RushJoinPage({ params }: { params: Promise<{ code: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const { code: raw } = await params;
  const code = normalizeRushCode(raw);
  const preview = code ? await getChallengePreview(studentId, code) : null;

  if (!preview) {
    return (
      <Shell eyebrow="1v1 Rush">
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">That link doesn&apos;t match a challenge.</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          Check the code with whoever sent it — it&apos;s six letters and numbers — or enter it by hand on the Rush page.
        </p>
        <div className="mt-8">
          <LinkButton size="cta" href="/rush">
            Go to 1v1 Rush
          </LinkButton>
        </div>
      </Shell>
    );
  }

  // Already in it: resume or review, no second run. A live room is played
  // in the room, whatever state it's in.
  if (preview.myRun) {
    if (preview.live) redirect(preview.myRun.status === "ACTIVE" ? `/rush/live/${preview.challengeId}` : `/rush/results/${preview.challengeId}`);
    redirect(preview.myRun.status === "ACTIVE" ? `/rush/play/${preview.myRun.id}` : `/rush/results/${preview.challengeId}`);
  }

  if (preview.mode !== "FRIEND") {
    return (
      <Shell eyebrow="1v1 Rush">
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">This rush isn&apos;t open to join.</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">Only challenges made with &ldquo;Challenge a friend&rdquo; can be accepted by link.</p>
        <div className="mt-8">
          <LinkButton size="cta" href="/rush">
            Go to 1v1 Rush
          </LinkButton>
        </div>
      </Shell>
    );
  }

  // A live room that has already started, or whose creator has left it,
  // can't be joined — say so instead of bouncing to a generic error.
  if (preview.live && (preview.liveStatus !== "WAITING" || !preview.creatorPresent)) {
    const started = preview.liveStatus !== "WAITING";
    return (
      <Shell eyebrow="1v1 Rush · Live">
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{started ? "That rush has already started." : `${preview.creatorName} isn't in the room right now.`}</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          {started
            ? "A live room takes exactly two players and closes once the countdown begins. Ask for a new link."
            : "A live room only runs while its host has it open. Ask them to open it again, then try the link."}
        </p>
        <div className="mt-8">
          <LinkButton size="cta" href="/rush">
            Go to 1v1 Rush
          </LinkButton>
        </div>
      </Shell>
    );
  }

  return (
    <Shell eyebrow={preview.live ? "1v1 Rush · Live challenge" : "1v1 Rush · Challenge"}>
      <h1 className="mt-3 text-display-sm sm:text-display">
        {preview.creatorName} {preview.live ? "is waiting for you in a" : "challenged you to a"} <Marker>{preview.sectionLabel}</Marker> rush.
      </h1>
      <dl className="mt-6 grid max-w-md grid-cols-3 divide-x divide-border text-sm">
        <Fact label="Questions" value={String(preview.questionCount)} first />
        <Fact label="Per question" value={`${Math.round(preview.limitMs / 1000)}s`} />
        <Fact label="Format" value={preview.live ? "Live" : "Anytime"} />
      </dl>
      <p className="mt-6 max-w-prose text-muted-foreground">
        {preview.live
          ? `${preview.creatorName} is in the room now. Join and a five-second countdown starts for both of you — same ten questions, same clock, and the results show who won.`
          : preview.creatorFinished
            ? `${preview.creatorName} has already played these ten. You'll see their time on each question as you go, and the results page shows who won.`
            : `${preview.creatorName} hasn't played yet. You'll each see the other's result once you've both finished.`}
        {!preview.live && preview.participants > 1 && ` ${preview.participants} people are in this one so far.`}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Accepting is free — no Premium needed.</p>
      <form action={joinRushAction} className="mt-8 flex flex-wrap gap-3">
        <input type="hidden" name="code" value={preview.code} />
        <Button type="submit" size="cta">
          {preview.live ? "Join now" : "Accept challenge"}
        </Button>
        <LinkButton size="cta" variant="ghost" href="/rush">
          Not now
        </LinkButton>
      </form>
    </Shell>
  );
}

function Shell({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
        {children}
      </section>
    </div>
  );
}

function Fact({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <div className={first ? "pr-4" : "px-4"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
