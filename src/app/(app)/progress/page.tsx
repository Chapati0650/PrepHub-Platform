import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getProgressData, type ProgressHistoryPoint } from "@/lib/progress/progress-data";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/page-header";
import { Marker } from "@/components/ui/marker";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// PRD-008 — long-term progress view. The SAT Prediction History is rendered
// as an ordered list rather than an interactive SVG graph (no charting
// library in this stack yet) — it still surfaces every required data point
// (session, date, predicted range) per point, just without a plotted line.
export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const data = await getProgressData(session.user.id);

  if (data.diagnosticStatus !== "COMPLETED") {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 sm:p-10">
        <div className="rounded-3xl bg-surface-tint p-8 sm:p-12">
          <h1 className="text-display-sm text-balance">
            Your progress journey begins after your <Marker>Diagnostic</Marker>.
          </h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            There is nothing to plot yet. Once you finish the Diagnostic, every prediction and milestone from then on
            lands here.
          </p>
          <div className="mt-8">
            <LinkButton size="cta" href="/diagnostic">
              {data.diagnosticStatus === "IN_PROGRESS" ? "Resume Diagnostic" : "Begin Diagnostic"}
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const targetPct = data.targetProgressFraction !== null ? Math.round(data.targetProgressFraction * 100) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-12 p-4 pb-16 sm:p-8">
      <PageHeader title="Your Progress" description="Every prediction and milestone since you started." />

      {/* Target Score Progress — the lead, because it is the only thing on
          this page that answers "am I going to get there." It was previously
          the third of six identically-weighted bordered boxes. */}
      {data.targetScore !== null && (
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Current Prediction
              </p>
              <p className="mt-2 font-heading text-hero font-semibold tracking-tight tabular-nums">
                {data.currentRange.min}&ndash;{data.currentRange.max}
              </p>
            </div>
            <div className="text-right">
              <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Target</p>
              <p className="mt-2 font-heading text-display-sm font-semibold tracking-tight tabular-nums text-muted-foreground">
                {data.targetScore}
              </p>
            </div>
          </div>
          {targetPct !== null && (
            <div
              className="mt-8 h-2.5 w-full overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuenow={targetPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress toward target score"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${targetPct}%` }} />
            </div>
          )}
          {data.remainingToTarget !== null && (
            <p className="mt-3 text-sm text-muted-foreground">
              {data.remainingToTarget === 0 ? "You've reached your target." : `About ${data.remainingToTarget} points remaining.`}
            </p>
          )}
        </section>
      )}

      {/* Your Journey — a written summary deserves to read as a written
          summary, so it gets prose size and a marker rule rather than being
          boxed like a stat. */}
      <section className="border-l-2 border-marker pl-5">
        <p className="text-lg leading-relaxed text-balance">{data.journeyNarrative}</p>
      </section>

      {/* SAT Prediction History */}
      <section className="flex flex-col gap-5">
        <SectionTitle>SAT Prediction History</SectionTitle>
        {data.history.length > 1 && <PredictionTrend history={data.history} />}
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {data.history.map((point, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <span className="min-w-0 truncate font-medium">{point.label}</span>
              <span className="shrink-0 text-muted-foreground">{formatDate(point.date)}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {point.min}&ndash;{point.max}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Study Statistics */}
      <section className="grid grid-cols-2 gap-y-6 divide-border sm:grid-cols-4 sm:divide-x">
        <Stat label="Total Study Time" value={formatDuration(data.studyStats.totalStudyTimeSeconds)} />
        <Stat label="Avg. Session Length" value={formatDuration(data.studyStats.averageSessionLengthSeconds)} />
        <Stat label="Questions Answered" value={String(data.studyStats.totalQuestionsAnswered)} />
        <Stat label="Sessions Completed" value={String(data.studyStats.completedSessions)} />
      </section>

      <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
        {/* Weakest Skills */}
        <section className="flex flex-col gap-5">
          <SectionTitle>Weakest Skills</SectionTitle>
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {data.weakestSkills.map((s, i) => (
              <li key={s.category} className="flex items-baseline gap-4 py-3 text-sm">
                <span className="font-heading text-caption font-semibold tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        </section>

        {/* Milestones — outlined rather than filled. A row of solid teal pills
            reads as a set of tags to click; these are statements of fact. */}
        {data.milestones.length > 0 && (
          <section className="flex flex-col gap-5">
            <SectionTitle>Milestones</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {data.milestones.map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary"
                >
                  {m}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{children}</h2>
  );
}

// A lightweight custom bar-trend visual — no charting library added, per the
// existing constraint (see module comment), but still gives the Prediction
// History a real shape at a glance instead of only a stacked text list.
//
// Taller and unboxed now: at h-20 inside a bordered, tinted panel the bars
// were shorter than their own container's chrome, so the trend they exist to
// show was the least visible thing in the box.
function PredictionTrend({ history }: { history: ProgressHistoryPoint[] }) {
  const midpoints = history.map((p) => (p.min + p.max) / 2);
  const min = Math.min(...midpoints);
  const max = Math.max(...midpoints);
  const range = Math.max(max - min, 1);

  return (
    <div className="flex h-36 items-end gap-1.5" aria-hidden>
      {history.map((point, i) => {
        const mid = (point.min + point.max) / 2;
        const heightPct = range === 1 && max === min ? 60 : 15 + ((mid - min) / range) * 85;
        const isLatest = i === history.length - 1;
        return (
          <div
            key={i}
            className={`w-full rounded-t-md ${isLatest ? "bg-primary" : "bg-primary/25"}`}
            style={{ height: `${heightPct}%` }}
            title={`${point.label}: ${point.min}–${point.max}`}
          />
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
