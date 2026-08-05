import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getProgressData } from "@/lib/progress/progress-data";
import { Button } from "@/components/ui/button";

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
  if (!session?.user) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const data = await getProgressData(session.user.id);

  if (data.diagnosticStatus !== "COMPLETED") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Your progress journey begins after you complete your diagnostic.</h1>
        <Button
          size="lg"
          render={<Link href="/diagnostic">{data.diagnosticStatus === "IN_PROGRESS" ? "Resume Diagnostic" : "Begin Diagnostic"}</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Your Progress</h1>

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
        <div className="flex flex-col gap-1.5">
          {data.history.map((point, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span className="font-medium">{point.label}</span>
              <span className="text-muted-foreground">{formatDate(point.date)}</span>
              <span>
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
        <ol className="list-inside list-decimal text-sm">
          {data.weakestSkills.map((s) => (
            <li key={s.category}>{s.label}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
