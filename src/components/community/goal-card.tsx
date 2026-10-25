import type { CommunityGoal } from "@/lib/community/school-community-data";
import { formatGoalDate } from "@/lib/community/goal";

function formatValue(metric: CommunityGoal["metric"], value: number): string {
  return metric === "STUDY_HOURS" ? `${value.toLocaleString()} hours` : value.toLocaleString();
}

function unitLabel(goal: CommunityGoal): string {
  if (goal.metric === "STUDY_HOURS") return "study hours";
  if (goal.metric === "ADAPTIVE_SESSIONS") return "Practice Sets";
  return "questions";
}

/**
 * A school's community goal as its students see it: the count, the bar, the
 * deadline and the prize. Also shown to the Administrator on the goal page,
 * so what they set is exactly what students get.
 *
 * Every figure is a school total; the card has no way to name a student.
 */
export function GoalCard({ goal }: { goal: CommunityGoal }) {
  const { status } = goal;
  const reached = status.state === "REACHED";
  const ended = status.state === "ENDED";

  const when = reached
    ? goal.reachedAt
      ? `Reached ${formatGoalDate(goal.reachedAt)}`
      : "Reached"
    : ended && goal.endsAt
      ? `Ended ${formatGoalDate(goal.endsAt)}`
      : goal.endsAt
        ? `Ends ${formatGoalDate(goal.endsAt)} · ${status.daysLeft === 1 ? "last day" : `${status.daysLeft} days left`}`
        : goal.startsAt
          ? `Since ${formatGoalDate(goal.startsAt)}`
          : null;

  return (
    <section aria-labelledby="school-goal-heading" className="rounded-2xl bg-surface-tint p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="school-goal-heading"
          className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase"
        >
          School goal
        </h2>
        {when && <p className="text-sm text-muted-foreground">{when}</p>}
      </div>

      <p className="mt-3 font-heading text-3xl font-semibold tracking-tight tabular-nums">
        {goal.current.toLocaleString()}
        <span className="ml-2 text-lg font-normal text-muted-foreground">
          of {goal.target.toLocaleString()} {unitLabel(goal)}
        </span>
      </p>

      <div
        role="progressbar"
        aria-label="School goal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.percent}
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        {/* A sliver once anything has counted, so a school's first answers
            visibly move the bar rather than leaving it looking unstarted. */}
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700"
          style={{ width: `${goal.current > 0 ? Math.max(status.percent, 2) : 0}%` }}
        />
      </div>

      <p className="mt-2 text-sm">
        {reached
          ? "Your school did it, together."
          : ended
            ? `Time's up — the school finished at ${status.percent}%.`
            : `${formatValue(goal.metric, status.remaining)} to go. Every ${goal.metric === "STUDY_HOURS" ? "session" : goal.metric === "ADAPTIVE_SESSIONS" ? "set" : "question"} anyone finishes counts.`}
      </p>

      {goal.prize && (
        <div className="mt-5 border-l-2 border-marker pl-3">
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {reached ? "Prize won" : "The prize"}
          </p>
          <p className="mt-0.5 font-medium">{goal.prize}</p>
          {reached && <p className="mt-1 text-sm text-muted-foreground">Your school will share the details.</p>}
        </div>
      )}
    </section>
  );
}
