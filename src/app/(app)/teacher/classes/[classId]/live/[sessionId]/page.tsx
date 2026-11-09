import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getSessionReport } from "@/lib/guided/console";
import { GuidedError } from "@/lib/guided/errors";
import { formatGoalDate } from "@/lib/community/goal";
import { LinkButton } from "@/components/ui/link-button";
import { StaffHeader, StaffPage, StaffSection, StatStrip, StatusChip } from "@/components/staff/staff-ui";
import type { AnswerBreakdown } from "@/lib/teacher/answer-stats";
import { MODE_LABELS } from "@/lib/guided/modes";
import { StudentResults } from "./student-results";

export const metadata = { title: "Guided Session report" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function Spread({ breakdown }: { breakdown: AnswerBreakdown }) {
  if (breakdown.kind === "entries") {
    return (
      <span>
        {breakdown.correctCount} entered {breakdown.correctAnswer} (right)
        {breakdown.wrong.length > 0 && ` · ${breakdown.wrong.map((w) => `${w.value} ${w.count}`).join(" · ")}`}
      </span>
    );
  }
  return <span>{breakdown.choices.map((c) => `${c.label} ${c.count}${c.correct ? " (right)" : ""}`).join(" · ")}</span>;
}

/**
 * After the session, for the teacher. It leads with what students answered
 * alone (a second vote can overstate how much a room learned), then who to
 * check in with and who was absent. Results on work the teacher gave their
 * class, like homework; nothing else from any student's account.
 *
 * Owner-approved (2026-11-08): the teacher who ran the session sees each
 * student's individual results for it here, after it ends: answers, whether
 * they were right, confidence, own-question score and time on task. Only that
 * teacher (the session's own), and only for this session's questions.
 */
export default async function GuidedReportPage({ params }: { params: Promise<{ classId: string; sessionId: string }> }) {
  const context = await requireTeacher();
  const { classId, sessionId } = await params;
  let page;
  try {
    page = await getSessionReport(context, sessionId);
  } catch (err) {
    if (err instanceof GuidedError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  if (page.classroomId !== classId) notFound();
  const { report, summary } = page;
  const individual = page.mode === "INDIVIDUAL";
  const live = page.status === "OPEN";
  const typical = summary.medianTimeOnTaskMs === null ? "—" : `${Math.max(1, Math.round(summary.medianTimeOnTaskMs / 60000))} min`;
  const minutes =
    page.startedAt && page.endedAt ? Math.max(1, Math.round((page.endedAt.getTime() - page.startedAt.getTime()) / 60000)) : null;

  return (
    <StaffPage>
      <StaffHeader
        back={{ href: `/teacher/classes/${classId}`, label: page.className }}
        eyebrow={`${MODE_LABELS[page.mode]} · ${formatGoalDate(page.createdAt)}`}
        title={page.categoryLabel}
        description={
          live
            ? "This session is still running."
            : page.suggested
              ? `You chose this skill; PrepHub had suggested ${page.suggested}.`
              : individual
                ? "How each student did on their own questions."
                : "What the room did, what each student did on their own, and who to check in with."
        }
        actions={live && <LinkButton href={`/teacher/live/${sessionId}`} size="cta">Back to the session</LinkButton>}
      />

      <StatStrip
        stats={[
          {
            label: "Took part",
            value: `${report.joined} of ${page.rosterSize}`,
            hint: page.joinedLater > 0 ? `students in the class then · ${page.joinedLater} joined later` : "students in the class",
          },
          {
            label: "On their own",
            value: report.ownAverage === null ? "—" : `${Number.isInteger(report.ownAverage) ? report.ownAverage : report.ownAverage.toFixed(1)} of ${report.ownTotal}`,
            hint: "average right, answered alone",
          },
          { label: "Absent", value: String(report.absent.length), hint: `${report.absent.filter((a) => a.caughtUp).length} caught up since` },
          { label: "Length", value: minutes === null ? "—" : `${minutes} min`, hint: "from Start to the end" },
        ]}
      />

      <StaffSection
        title="Each student"
        description="One row per student in the class. First try is right on the first answer, before any talking. Final is right on the last answer given in the session. Open a row to see every question. Only you can see this."
      >
        <StatStrip
          stats={[
            { label: "First try right", value: pct(summary.avgFirstTryPct), hint: "average across students here" },
            { label: "Final right", value: pct(summary.avgFinalPct), hint: "average across students here" },
            { label: "Sure but wrong", value: String(summary.sureButWrong), hint: "students often sure of a wrong answer" },
            { label: "Typical time", value: typical, hint: "time on task, the middle student" },
          ]}
        />
        <div className="flex flex-wrap gap-3">
          <a
            href={`/teacher/classes/${classId}/live/${sessionId}/export`}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-base font-medium hover:bg-muted"
          >
            Download results (CSV)
          </a>
          <a
            href={`/teacher/classes/${classId}/live/${sessionId}/export?detail=questions`}
            className="inline-flex h-11 items-center rounded-md border border-border px-4 text-base font-medium hover:bg-muted"
          >
            Download every answer (CSV)
          </a>
        </div>
        <StudentResults rows={page.students} />
      </StaffSection>

      {!individual && (
      <StaffSection title="The questions" description="The first vote is what students knew alone. Where the room talked it over, the second vote is beside it.">
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {report.questions.map((q) => (
            <li key={q.itemId} className="flex flex-col gap-2 p-5 md:flex-row md:items-start md:gap-8">
              <span className="md:w-56">
                <span className="block text-lg font-medium">{q.label}</span>
                <span className="text-base text-muted-foreground">Answer {q.correctAnswer}</span>
              </span>
              <span className="flex-1 text-base">
                <span className="block">
                  <span className="font-semibold tabular-nums">{pct(q.firstRight)}</span> right on the first vote ({q.firstAnswered} answered)
                  {q.secondRight !== null && (
                    <>
                      {" "}
                      → <span className="font-semibold tabular-nums">{pct(q.secondRight)}</span> after talking
                    </>
                  )}
                </span>
                <span className="block text-muted-foreground">
                  <Spread breakdown={q.first} />
                </span>
                {q.first.kind === "choices" && q.first.commonWrong && (
                  <span className="mt-1 block">
                    <StatusChip tone="warn">Most who missed it chose {q.first.commonWrong}</StatusChip>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </StaffSection>
      )}

      {!individual && (
      <>
      <StaffSection
        title="Check in with"
        description="Students who missed a class question on their final answer and two or more of their own. Worth a word after class."
      >
        {report.checkIn.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-base text-muted-foreground">No one, by that measure.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {report.checkIn.map((s) => (
              <li key={s.studentId} className="p-4 text-lg">
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </StaffSection>

      <StaffSection
        title="Absent"
        description="Students in the class who didn't take part. Each has a catch-up on their PrepHub home page for two weeks: the same questions, at their own pace, with the explanations."
      >
        {report.absent.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-base text-muted-foreground">Everyone took part.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {report.absent.map((a) => (
              <li key={a.student.studentId} className="flex items-center justify-between gap-4 p-4 text-lg">
                {a.student.name}
                {a.caughtUp ? <StatusChip tone="good">Caught up</StatusChip> : <StatusChip tone="muted">Not yet</StatusChip>}
              </li>
            ))}
          </ul>
        )}
      </StaffSection>

      <StaffSection title="The pace, according to students" description="One tap at the end of the session. Anonymous to you: counts only.">
        <StatStrip
          columns={3}
          stats={[
            { label: "Too fast", value: String(report.pace.TOO_FAST) },
            { label: "About right", value: String(report.pace.ABOUT_RIGHT) },
            { label: "Too slow", value: String(report.pace.TOO_SLOW) },
          ]}
        />
      </StaffSection>
      </>
      )}

      <p className="text-base text-muted-foreground">
        <Link href={`/teacher/classes/${classId}/live/new`} className="font-medium text-foreground underline underline-offset-2">
          Start another session
        </Link>{" "}
        · PrepHub picks the skill again from the class&apos;s latest work.
      </p>
    </StaffPage>
  );
}
