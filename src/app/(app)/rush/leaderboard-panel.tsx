import Link from "next/link";
import { Crown } from "lucide-react";
import type { LeaderboardEntry, WeeklyLeaderboard } from "@/lib/rush/leaderboard";

function classOf(year: number | null): string | null {
  return year ? `Class of '${String(year).slice(2)}` : null;
}

/**
 * The weekly school leaderboard on the Rush hub. Server-rendered: it's a
 * snapshot, refreshed whenever the hub is opened, and a student who finishes
 * a rush comes back to the hub anyway.
 *
 * One `divide-y` list, not a card per row (CLAUDE.md: prefer a rule to a
 * box). Two-digit places, the same ordinal treatment as the rest of the
 * product. Gold for first place only — `achievement` is the token reserved
 * for exactly this kind of moment — with a crown, because a leaderboard
 * without one reads as a table.
 */
export function LeaderboardPanel({ board }: { board: WeeklyLeaderboard }) {
  const { entries, me, players, lastWeek, scope } = board;
  const meListed = entries.some((e) => e.isMe);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="leaderboard-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="leaderboard-heading" className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          This week at {scope.schoolName}
        </h2>
        <p className="text-xs text-muted-foreground">Best single rush · resets Monday</p>
      </div>

      {entries.length === 0 ? (
        <p className="border-y border-border py-5 text-sm text-muted-foreground">
          {/* A hidden student has finished one, so "nobody has" would contradict
              the line under it that tells them where they'd stand. */}
          {me?.hidden
            ? "Nobody else is showing on the board this week."
            : `Nobody at ${scope.schoolName} has finished a rush this week. The first to finish one takes first place.`}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border border-y border-border">
          {entries.map((entry) => (
            <Row key={`${entry.rank}-${entry.firstName}-${entry.score}`} entry={entry} />
          ))}
        </ol>
      )}

      {me && !meListed && (
        <p className="text-sm tabular-nums text-muted-foreground">
          {me.hidden ? (
            <>
              You&apos;re hidden from this board — you&apos;d be{" "}
              <span className="font-medium text-foreground">#{me.rank}</span> with {me.score.toLocaleString()}.{" "}
              <Link href="/settings#leaderboard" className="underline underline-offset-2 hover:text-foreground">
                Change this in Settings
              </Link>
              .
            </>
          ) : (
            <>
              You&apos;re <span className="font-medium text-foreground">#{me.rank}</span> of {players} · best{" "}
              {me.score.toLocaleString()} · {me.runs} {me.runs === 1 ? "rush" : "rushes"} this week
            </>
          )}
        </p>
      )}
      {me && meListed && (
        <p className="text-sm tabular-nums text-muted-foreground">
          {me.runs} {me.runs === 1 ? "rush" : "rushes"} this week. Beat your best to climb.
        </p>
      )}

      {lastWeek.length > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">
          Last week:{" "}
          {lastWeek.map((e, i) => (
            <span key={`${e.rank}-${e.firstName}`}>
              {i > 0 && " · "}
              <span className="font-medium text-foreground">{e.firstName}</span> {e.score.toLocaleString()}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const first = entry.rank === 1;
  return (
    <li
      className={[
        "flex items-center justify-between gap-4 px-2 py-2.5 text-sm",
        entry.isMe && "bg-surface-tint font-medium",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={entry.isMe ? "true" : undefined}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={[
            "w-7 shrink-0 font-heading font-semibold tabular-nums",
            first ? "text-achievement-foreground dark:text-achievement" : "text-muted-foreground",
          ].join(" ")}
        >
          {String(entry.rank).padStart(2, "0")}
        </span>
        {first && <Crown className="size-4 shrink-0 fill-achievement text-achievement" aria-label="First place" />}
        <span className="truncate">
          {entry.firstName}
          {entry.isMe && <span className="text-muted-foreground"> (you)</span>}
        </span>
        {classOf(entry.classYear) && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{classOf(entry.classYear)}</span>
        )}
      </span>
      <span className="shrink-0 font-heading font-semibold tabular-nums">{entry.score.toLocaleString()}</span>
    </li>
  );
}
