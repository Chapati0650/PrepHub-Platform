import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getRushOverview, type RushHistoryRow } from "@/lib/rush/runs";
import { RUSH_MODES, RUSH_PLAY_OPTIONS, RUSH_PLAY_OPTION_ORDER, RUSH_RUN_SIZE, RUSH_SECTIONS, RUSH_SECTION_ORDER, RUSH_TIME_LIMIT_MS } from "@/lib/rush/config";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Marker } from "@/components/ui/marker";
import { ShareChallenge } from "./share-challenge";
import { joinRushAction, startRushAction } from "./actions";

// 1v1 Rush — the reference's "Question Rush", made head-to-head. The hub:
// start a rush (Premium), join one by code (free), and the record so far.
// Outside the adaptive engine entirely: see the schema comment on RushSet.
export default async function RushPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const [{ pool, stats, history }, paidAccess, { error }] = await Promise.all([getRushOverview(studentId), hasPaidAccess(studentId), searchParams]);
  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const anyPool = RUSH_SECTION_ORDER.some((s) => pool[s] > 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Free to accept · Premium to start</p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">
          1v1 <Marker>Rush</Marker>
        </h1>
      </div>

      <section className="rounded-2xl border-2 border-marker/60 bg-surface-tint p-6">
        <h2 className="font-heading text-lg font-semibold tracking-tight">What is 1v1 Rush?</h2>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Ten questions, easy to hard, with a hard clock on each. Points for being right, more for being fast. Get matched
          live with another student, open a room and send a friend the link, or play solo — same questions, same clock,
          and the results show who won. Nothing here changes your Predicted SAT Score.
        </p>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
        {/* Start a rush. One form, three groups of pill radios, one CTA —
            the choices are the content, so they get real width instead of
            three dropdowns. */}
        <section className="rounded-3xl bg-surface-deep p-6 text-surface-deep-foreground">
          <p className="font-heading text-xl font-semibold tracking-tight">Start a rush</p>
          {paidAccess ? (
            anyPool ? (
              <form action={startRushAction} className="mt-5 flex flex-col gap-5">
                <Choice
                  legend="Section"
                  name="section"
                  options={RUSH_SECTION_ORDER.map((s) => ({ value: s, label: RUSH_SECTIONS[s].label, disabled: pool[s] === 0 }))}
                  defaultValue={RUSH_SECTION_ORDER.find((s) => pool[s] > 0) ?? RUSH_SECTION_ORDER[0]}
                />
                <fieldset>
                  <legend className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">Play</legend>
                  <div className="mt-2 flex flex-col divide-y divide-surface-deep-foreground/15 border-y border-surface-deep-foreground/15">
                    {RUSH_PLAY_OPTION_ORDER.map((m) => (
                      <label key={m} className="flex cursor-pointer items-start gap-3 py-3">
                        <input type="radio" name="option" value={m} defaultChecked={m === "RANDOM_LIVE"} className="peer sr-only" />
                        <span
                          aria-hidden
                          className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border border-surface-deep-foreground/40 peer-checked:border-surface-deep-foreground peer-checked:[&>span]:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-marker"
                        >
                          <span className="size-2 rounded-full bg-surface-deep-foreground opacity-0" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{RUSH_PLAY_OPTIONS[m].label}</span>
                          <span className="block text-sm text-surface-deep-foreground/70">{RUSH_PLAY_OPTIONS[m].blurb}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="text-sm text-surface-deep-foreground/70">
                  {RUSH_RUN_SIZE} questions, easy through hard · {Math.round(RUSH_TIME_LIMIT_MS.READING_WRITING / 1000)}s each for Reading &amp;
                  Writing, {Math.round(RUSH_TIME_LIMIT_MS.MATH / 1000)}s for Math.
                </p>
                <div>
                  <Button type="submit" size="cta" className="bg-surface-deep-foreground text-surface-deep hover:bg-surface-deep-foreground/90">
                    Start rush
                  </Button>
                </div>
              </form>
            ) : (
              <p className="mt-2 text-sm text-surface-deep-foreground/70">No questions are published yet. Check back soon.</p>
            )
          ) : (
            <div className="mt-2 flex flex-col gap-5">
              <p className="max-w-prose text-surface-deep-foreground/80">
                Starting a rush — solo, against a random opponent, or challenging a friend — is part of Premium. Accepting a
                friend&apos;s challenge is always free.
              </p>
              <ul className="flex flex-col divide-y divide-surface-deep-foreground/15 border-y border-surface-deep-foreground/15 text-sm">
                {RUSH_PLAY_OPTION_ORDER.map((m) => (
                  <li key={m} className="py-3">
                    <span className="font-medium">{RUSH_PLAY_OPTIONS[m].label}</span>
                    <span className="text-surface-deep-foreground/70"> — {RUSH_PLAY_OPTIONS[m].blurb}</span>
                  </li>
                ))}
              </ul>
              <div>
                <LinkButton href="/pricing" size="cta" className="bg-surface-deep-foreground text-surface-deep hover:bg-surface-deep-foreground/90">
                  <Lock className="size-4" aria-hidden />
                  Unlock with Premium
                </LinkButton>
              </div>
            </div>
          )}
        </section>

        {/* Join by code — the free door, on the tint so it reads as the
            pair of the deep block rather than an afterthought under it. */}
        <section className="flex flex-col gap-4 rounded-3xl bg-surface-tint p-6 lg:self-start">
          <div>
            <p className="font-heading text-xl font-semibold tracking-tight">Have a code?</p>
            <p className="mt-1 text-sm text-muted-foreground">A friend sent you a challenge. Enter their six-character code — a live room starts the countdown the moment you&apos;re in.</p>
          </div>
          <form action={joinRushAction} className="flex flex-col gap-3">
            <input
              name="code"
              required
              maxLength={8}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABC234"
              aria-label="Challenge code"
              className="h-12 w-full rounded-xl border border-border bg-background px-4 font-heading text-xl tracking-[0.2em] uppercase placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-muted-foreground/60"
            />
            <Button type="submit" variant="outline" className="rounded-full">
              Join challenge
            </Button>
          </form>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your record</h2>
        <div className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border [&>*:nth-child(n+3)]:border-t sm:grid-cols-4 sm:divide-x sm:[&>*:nth-child(n+3)]:border-t-0">
          <Stat label="Rushes played" value={String(stats.played)} />
          <Stat label="Best score" value={stats.best === null ? "—" : String(stats.best)} />
          <Stat label="Wins" value={String(stats.wins)} />
          <Stat label="Losses · Ties" value={`${stats.losses} · ${stats.ties}`} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your rushes</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Your rushes — solo, random and friend challenges — will show up here.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {history.map((h) => (
              <HistoryItem key={h.myRunId} row={h} joinUrl={`${origin}/rush/join/${h.code}`} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Choice({
  legend,
  name,
  options,
  defaultValue,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string; disabled?: boolean }[];
  defaultValue: string;
}) {
  return (
    <fieldset>
      <legend className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={o.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}>
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} disabled={o.disabled} className="peer sr-only" />
            <span className="block rounded-full border border-surface-deep-foreground/30 px-4 py-1.5 text-sm transition-colors peer-checked:border-surface-deep-foreground peer-checked:bg-surface-deep-foreground peer-checked:text-surface-deep peer-focus-visible:ring-2 peer-focus-visible:ring-marker">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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

function HistoryItem({ row, joinUrl }: { row: RushHistoryRow; joinUrl: string }) {
  const href = row.myStatus === "ACTIVE" ? (row.live ? `/rush/live/${row.challengeId}` : `/rush/play/${row.myRunId}`) : `/rush/results/${row.challengeId}`;
  const status =
    row.live && row.liveStatus === "WAITING"
      ? "Waiting in the room"
      : row.myStatus === "ACTIVE"
        ? row.live
          ? "Live now — rejoin"
          : "In progress"
      : row.outcome === "WON"
        ? "Won"
        : row.outcome === "LOST"
          ? "Lost"
          : row.outcome === "TIED"
            ? "Tie"
            : row.awaitingFriend
              ? "Waiting for a friend"
              : row.awaitingMatch
                ? "Waiting for a match"
                : row.mode === "SOLO"
                  ? "Solo"
                  : "Played";
  const tone = row.outcome === "WON" ? "text-green-700 dark:text-green-400" : row.outcome === "LOST" ? "text-destructive" : "text-muted-foreground";
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
          <span className="truncate">
            <span className="font-medium">{RUSH_MODES[row.mode].label}</span>
            <span className="text-muted-foreground">
              {" "}
              · {row.sectionLabel}
              {row.live ? " · Live" : ""}
            </span>
          </span>
        </Link>
        <span className="flex shrink-0 items-center gap-4 tabular-nums">
          {row.myStatus === "COMPLETED" && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{row.myScore}</span>
              {row.opponent?.finished && (
                <>
                  {" "}
                  – {row.opponent.score} <span className="text-xs">{row.opponent.name}</span>
                </>
              )}
            </span>
          )}
          <span className={`text-xs font-medium ${tone}`}>{status}</span>
        </span>
      </div>
      {row.awaitingFriend && <ShareChallenge code={row.code} joinUrl={joinUrl} compact />}
    </li>
  );
}
