import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getProgressData, type ProgressHistoryPoint } from "@/lib/progress/progress-data";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/page-header";

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
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl sm:text-2xl">Your progress journey begins after you complete your diagnostic.</h1>
        <LinkButton size="lg" href="/diagnostic">
          {data.diagnosticStatus === "IN_PROGRESS" ? "Resume Diagnostic" : "Begin Diagnostic"}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <PageHeader title="Your Progress" description="Every prediction and milestone since you started." />

      {/* Your Journey */}
      <p className="rounded-lg border border-border p-4 text-sm leading-relaxed">{data.journeyNarrative}</p>

      {/* Target Score Progress */}
      {data.targetScore !== null && (
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Target</span>
            <span className="font-medium">{data.targetScore}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current Prediction</span>
            <span className="font-medium">
              {data.currentRange.min}–{data.currentRange.max}
            </span>
          </div>
          {data.targetProgressFraction !== null && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(data.targetProgressFraction * 100)}%` }} />
            </div>
          )}
          {data.remainingToTarget !== null && (
            <p className="mt-2 text-sm text-muted-foreground">
              {data.remainingToTarget === 0 ? "You've reached your target." : `About ${data.remainingToTarget} points remaining.`}
            </p>
          )}
        </div>
      )}

      {/* SAT Prediction History */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">SAT Prediction History</h2>
        {data.history.length > 1 && <PredictionTrend history={data.history} />}
        <div className="flex flex-col gap-1.5">
          {data.history.map((point, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span className="font-medium">{point.label}</span>
              <span className="text-muted-foreground">{formatDate(point.date)}</span>
              <span className="tabular-nums">
                {point.min}–{point.max}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Milestones */}
      {data.milestones.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Milestones</h2>
          <div className="flex flex-wrap gap-2">
            {data.milestones.map((m) => (
              <span key={m} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Study Statistics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Study Time" value={formatDuration(data.studyStats.totalStudyTimeSeconds)} />
        <Stat label="Avg. Session Length" value={formatDuration(data.studyStats.averageSessionLengthSeconds)} />
        <Stat label="Questions Answered" value={String(data.studyStats.totalQuestionsAnswered)} />
        <Stat label="Sessions Completed" value={String(data.studyStats.completedSessions)} />
      </div>

      {/* Weakest Skills */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Weakest Skills</h2>
        <ol className="flex flex-col gap-1.5">
          {data.weakestSkills.map((s, i) => (
            <li key={s.category} className="flex items-center gap-2.5 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                {i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// A lightweight custom bar-trend visual — no charting library added, per the
// existing constraint (see module comment), but still gives the Prediction
// History a real shape at a glance instead of only a stacked text list.
function PredictionTrend({ history }: { history: ProgressHistoryPoint[] }) {
  const midpoints = history.map((p) => (p.min + p.max) / 2);
  const min = Math.min(...midpoints);
  const max = Math.max(...midpoints);
  const range = Math.max(max - min, 1);

  return (
    <div className="flex h-20 items-end gap-1.5 rounded-lg border border-border bg-muted/30 p-3" aria-hidden>
      {history.map((point, i) => {
        const mid = (point.min + point.max) / 2;
        const heightPct = range === 1 && max === min ? 60 : 15 + ((mid - min) / range) * 85;
        return (
          <div
            key={i}
            className="w-full rounded-t-sm bg-primary transition-all"
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
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
